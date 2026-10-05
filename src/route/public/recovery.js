const $ = (id) => document.getElementById(id);
const snapshot = (state) => JSON.stringify(state);
const show = (id, value) => { $(id).hidden = !value; $(id).textContent = value ? JSON.stringify(value, null, 2) : ''; };
function message(id, text, error = false) { $(id).textContent = text; $(id).dataset.error = String(error); $(id).setAttribute('role', error ? 'alert' : 'status'); }
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function options(id, records, label) {
  const old = $(id).value;
  $(id).replaceChildren(new Option(records.length ? 'Choose a saved record' : 'No saved records', ''), ...records.map((item) => new Option(label(item), item.id)));
  if (records.some((item) => item.id === old)) $(id).value = old;
}

export function initializeRecovery({ getState, setState, pause, refresh }) {
  const desk = location.pathname.startsWith('/route/');
  let api; let busy = false; let generation = 0; let stateText;
  let decision = null; let decisionState = null; let receipt = null; let bundle = null;
  let cloudConfigured = false;
  const active = () => $('recovery-enabled').checked;
  const update = () => {
    const enabled = desk && Boolean(api) && !busy;
    $('recovery-panel')?.setAttribute('aria-busy', String(busy));
    $('recovery-request').disabled = !enabled || !$('recovery-send-consent').checked;
    $('recovery-export').disabled = !receipt;
    $('recovery-history').disabled = !enabled;
    $('job-prepare').disabled = !enabled || (active() && !decision);
    $('job-bundle-history').disabled = !enabled;
    $('job-download').disabled = !bundle;
    $('job-submit').disabled = !enabled || !bundle || !cloudConfigured || !$('job-consent').checked;
    $('job-poll').disabled = !enabled || !$('job-history').value || !$('job-read-consent').checked;
    $('job-logs').disabled = $('job-poll').disabled;
    if (active()) {
      $('step').disabled = true;
      $('run').textContent = 'Run selected decision';
      $('run').disabled = !enabled || !decision || decisionState !== snapshot(getState()) || !$('recovery-apply-consent').checked || getState().status === 'complete';
    }
    if (busy) $('run').disabled = true;
  };
  const changed = (state) => {
    const current = snapshot(state);
    if (stateText !== undefined && current !== stateText) {
      generation++; decision = null; decisionState = null; receipt = null; bundle = null;
      $('recovery-apply-consent').checked = false; $('job-consent').checked = false;
      $('recovery-decision').textContent = 'State changed. Request a new recovery decision before using model-controlled Run.';
      show('recovery-receipt', null); show('job-review', null);
    }
    stateText = current; update();
  };
  const task = async (target, work) => {
    if (busy || !api) return;
    busy = true; pause(); refresh();
    message(target, 'Working…');
    try { await work(); } catch (error) { message(target, error.message, true); }
    finally { busy = false; refresh(); }
  };
  async function history() {
    const data = await api('route', 'list');
    options('recovery-history', data.decisions, (item) => `${item.createdAt.slice(0, 19)} · ${item.decision.action}`);
    options('job-bundle-history', data.bundles, (item) => `${item.createdAt.slice(0, 19)} · ${item.scenarioId}`);
    options('job-history', data.jobs, (item) => `${item.name} · ${item.resourceId ?? item.state}`);
  }
  function displayDecision(value, observed) {
    decision = value; decisionState = observed;
    $('recovery-apply-consent').checked = false;
    $('recovery-decision').textContent = `${value.decision.action.replaceAll('_', ' ')} — ${value.decision.reason} (${value.inference.model}; ${value.inference.liveInferenceVerified ? 'live response recorded' : 'live inference unverified'})`;
    receipt = value; show('recovery-receipt', value);
  }
  function displayBundle(value) {
    bundle = value; $('job-consent').checked = false;
    show('job-review', { id: value.id, config: value.config, input: value.input, resourceSettings: { ...value.request.spec, injectedFiles: value.request.spec.injectedFiles.map(({ containerPath, content }) => ({ containerPath, encodedBytes: content.length })) }, fileHashes: value.fileHashes, resultSha256: value.resultSha256, note: value.note });
  }
  $('recovery-enabled').addEventListener('change', () => { pause(); refresh(); });
  for (const id of ['recovery-send-consent', 'recovery-apply-consent', 'job-consent', 'job-read-consent', 'job-history']) $(id).addEventListener('change', refresh);
  $('recovery-goal').addEventListener('input', () => {
    generation++; decision = null; decisionState = null; bundle = null; receipt = null;
    $('recovery-apply-consent').checked = false; $('job-consent').checked = false;
    $('recovery-decision').textContent = 'Objective changed. Request a new decision.';
    show('recovery-receipt', null); show('job-review', null); refresh();
  });
  $('recovery-request').addEventListener('click', () => task('recovery-feedback', async () => {
    const observed = snapshot(getState()); const version = generation;
    const value = await api('route', 'advise', { state: getState(), goal: $('recovery-goal').value, consent: $('recovery-send-consent').checked });
    if (version !== generation || observed !== snapshot(getState())) return message('recovery-feedback', 'State or objective changed during inference. The saved response was not selected; request a new decision.', true);
    displayDecision(value, observed); await history();
    message('recovery-feedback', 'Review the decision, enable Nemotron mode, and authorize Run to apply it. No movement has occurred.');
  }));
  $('recovery-history').addEventListener('change', () => task('recovery-feedback', async () => {
    if (!$('recovery-history').value) return;
    const version = generation; const observed = snapshot(getState());
    const value = await api('route', 'decision', { id: $('recovery-history').value });
    if (version !== generation || observed !== snapshot(getState())) return;
    displayDecision(value, observed);
    message('recovery-feedback', 'Saved decision opened. Run will reject it if its state hash differs from the current mission.');
  }));
  $('recovery-export').addEventListener('click', () => { if (receipt) download('route-recovery-receipt.json', receipt); });
  $('route-job-form').addEventListener('submit', (event) => {
    event.preventDefault();
    task('job-feedback', async () => {
      if (active() && !decision) throw new Error('Select a recovery decision first, or explicitly turn off Nemotron mode to prepare a baseline evaluation.');
      const version = generation;
      const value = await api('route', 'bundle', { state: getState(), ...(active() && decision ? { decisionId: decision.id } : {}), config: { projectId: $('job-project').value, subnetId: $('job-subnet').value, platform: $('job-platform').value, preset: $('job-preset').value }, consent: true });
      if (version !== generation) return message('job-feedback', 'State changed during preparation. Open the saved bundle to review its original state.', true);
      displayBundle(value); await history();
      message('job-feedback', 'Bundle prepared locally. Review or download it; no cloud resources were created.');
    });
  });
  for (const id of ['job-project', 'job-subnet', 'job-platform', 'job-preset']) $(id).addEventListener('input', () => {
    generation++; bundle = null; $('job-consent').checked = false; show('job-review', null); refresh();
  });
  $('job-bundle-history').addEventListener('change', () => task('job-feedback', async () => {
    if (!$('job-bundle-history').value) return;
    const version = generation; const value = await api('route', 'bundleinfo', { id: $('job-bundle-history').value });
    if (version !== generation) return;
    displayBundle(value); message('job-feedback', 'Saved bundle opened. It retains its original state and decision; review before submitting.');
  }));
  $('job-download').addEventListener('click', () => { if (bundle) download(`route-job-${bundle.id}.json`, bundle); });
  $('job-submit').addEventListener('click', () => task('job-feedback', async () => {
    const selected = bundle;
    if (!selected || !$('job-consent').checked) throw new Error('Review and authorize a bundle first.');
    let job;
    try { job = await api('route', 'submit', { bundleId: selected.id, consent: true }); }
    finally { $('job-consent').checked = false; await history(); }
    await history(); $('job-history').value = job.id; $('job-consent').checked = false;
    show('job-result', job); message('job-feedback', 'Submission recorded. Execution and result remain unverified until status and logs are checked.');
  }));
  for (const action of ['poll', 'logs']) $(`job-${action}`).addEventListener('click', () => task('job-feedback', async () => {
    const result = await api('route', action, { jobId: $('job-history').value, consent: $('job-read-consent').checked });
    show('job-result', result);
    message('job-feedback', result.resultVerified ? `${result.liveExecutionVerified ? 'Live completed job' : 'Fixture; live cloud execution unverified'}: report matches the reviewed simulation bundle.` : `Cloud state: ${result.state}. The simulation result remains unverified.`);
  }));
  if (desk) {
    import('/common.js').then(async (common) => {
      api = common.api; const status = await api('route', 'status'); cloudConfigured = status.cloud.configured;
      $('recovery-availability').textContent = `Optional model inference requires configured Nemotron credentials and consent. ${cloudConfigured ? 'AI Cloud credentials are configured; live access is unverified.' : 'AI Cloud access is not configured. Bundle preparation works locally.'}`;
      await history(); refresh();
    }).catch((error) => { message('recovery-feedback', `Sponsor controls unavailable: ${error.message}`, true); update(); });
  } else {
    $('recovery-availability').textContent = 'Nemotron and Nebius controls require Project desk at /route/. This standalone server supports the local simulation only.';
    $('recovery-enabled').disabled = true;
  }
  return {
    active, changed,
    async run() {
      await task('recovery-feedback', async () => {
        if (!decision || !$('recovery-apply-consent').checked) throw new Error('Request, review, and authorize a recovery decision first.');
        const observed = snapshot(getState()); const version = generation;
        const result = await api('route', 'execute', { state: getState(), decisionId: decision.id, consent: true });
        if (version !== generation || observed !== snapshot(getState())) return message('recovery-feedback', 'State changed during execution. The returned snapshot was not applied to this mission.', true);
        setState(result.state); receipt = result.receipt; decision = null;
        $('recovery-apply-consent').checked = false; show('recovery-receipt', receipt);
        $('recovery-decision').textContent = `Applied: ${receipt.action.replaceAll('_', ' ')}. Request a new decision for another run.`;
        message('recovery-feedback', `${receipt.action.replaceAll('_', ' ')}: ${receipt.movesExecuted} audited moves executed. ${receipt.movesExecuted ? 'Delivery result is recorded below.' : 'The robot remains stopped; no clearance was inferred.'}`);
      });
    },
  };
}
