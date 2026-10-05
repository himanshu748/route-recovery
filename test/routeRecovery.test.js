import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createRouteService } from '../src/route/service.js';
import { createSimulation, editCell, exportEvidence } from '../src/route/core.js';
import { sha256 } from '../src/route/recoveryPolicy.js';
import { createServerlessJobs, jobRequest } from '../src/integrations/serverlessJobs.js';
import { hashStructuredOutput } from '../src/integrations/runtime.js';

const config = { projectId: 'project-fixture', subnetId: 'vpcsubnet-fixture', platform: 'cpu-d3', preset: '2vcpu-8gb' };
const inference = { provider: 'nebius-token-factory', model: 'nvidia/nemotron-fixture', liveInferenceVerified: false, transport: 'fixture', requestSha256: 'a'.repeat(64), responseSha256: 'b'.repeat(64) };
function runtime(action = 'follow_validated_route') {
  return { async generate({ input }) {
    const value = { stateSha256: input.stateSha256, action, reason: 'Fixture decision for the stated objective.' };
    return { value, inference: { ...inference, outputSha256: hashStructuredOutput(value) } };
  } };
}
async function fixture(t, options = {}) {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'route-recovery-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const service = await createRouteService({ dataRoot, inferenceRuntime: runtime(), jobsRuntime: createServerlessJobs({ token: '', profile: '' }), ...options });
  return { service, dataRoot };
}
async function advise(service, state, goal = 'Deliver if the route is legal.') {
  return service.handle('advise', { state, goal, consent: true });
}

test('a persisted exact-state model decision gates an audited run and keeps baseline provenance honest', async (t) => {
  const { service, dataRoot } = await fixture(t);
  const state = editCell(createSimulation('detour'), { x: 4, y: 3 }, 'obstacle');
  const decision = await advise(service, state);
  const restarted = await createRouteService({ dataRoot });
  const result = await restarted.handle('execute', { state, decisionId: decision.id, consent: true });
  assert.equal(result.state.status, 'complete');
  assert.equal(result.receipt.movesExecuted, 10);
  assert.equal(result.receipt.baselineEvidence.modelUsed, false);
  assert.equal(result.receipt.modelDecisionApplied, true);
  assert.equal(result.receipt.inference.liveInferenceVerified, false);
  assert.equal(result.receipt.baselineEvidence.constraintViolations, 0);
  assert.deepEqual(exportEvidence(result.state), result.receipt.baselineEvidence);
  await assert.rejects(restarted.handle('execute', { state: createSimulation('detour'), decisionId: decision.id, consent: true }), /exact state/);
  await assert.rejects(service.handle('execute', { state, decisionId: decision.id }), /consent/);
});

test('hold and operator-clearance decisions do not move or modify the map', async (t) => {
  for (const action of ['hold_position', 'request_operator_clearance']) {
    const { service } = await fixture(t, { inferenceRuntime: runtime(action) });
    const state = createSimulation('no-route');
    const decision = await advise(service, state, 'Wait for an operator to inspect the crossing.');
    const result = await service.handle('execute', { state, decisionId: decision.id, consent: true });
    assert.deepEqual(result.state, state);
    assert.equal(result.receipt.movesExecuted, 0);
    assert.equal(result.receipt.baselineEvidence.complete, false);
  }
});

test('missing consent, provider failure, invalid output, wrong model and illegal movement never create executions', async (t) => {
  const state = createSimulation('no-route');
  const bad = [runtime(), { generate: async () => { throw new Error('provider details secret'); } },
    { generate: async () => ({ value: { stateSha256: 'bad', action: 'hold_position', reason: 'x' }, inference }) },
    { generate: async ({ input }) => ({ value: { stateSha256: input.stateSha256, action: 'hold_position', reason: 'x' }, inference: { ...inference, model: 'other-model' } }) }];
  for (const inferenceRuntime of bad) {
    const { service, dataRoot } = await fixture(t, { inferenceRuntime });
    await assert.rejects(advise(service, state));
    assert.deepEqual(await readdir(path.join(dataRoot, 'executions')), []);
    assert.deepEqual(await readdir(path.join(dataRoot, 'decisions')), []);
  }
  const { service } = await fixture(t);
  await assert.rejects(service.handle('advise', { state, goal: 'deliver' }), /consent/);
  const forged = structuredClone(createSimulation('detour')); forged.moves = 7;
  await assert.rejects(advise(service, forged), /history/);
});

test('changing a saved model action is rejected on read, execute, and bundle preparation', async (t) => {
  const { service, dataRoot } = await fixture(t, { inferenceRuntime: runtime('hold_position') });
  const state = createSimulation('detour');
  const saved = await advise(service, state, 'Wait for inspection.');
  const recordPath = path.join(dataRoot, 'decisions', `${saved.id}.json`);
  const changed = JSON.parse(await readFile(recordPath, 'utf8'));
  changed.decision.action = 'follow_validated_route';
  await writeFile(recordPath, JSON.stringify(changed));
  await assert.rejects(service.handle('decision', { id: saved.id }), /recorded model output/);
  await assert.rejects(service.handle('execute', { state, decisionId: saved.id, consent: true }), /recorded model output/);
  await assert.rejects(service.handle('bundle', { state, decisionId: saved.id, config, consent: true }), /recorded model output/);
  assert.deepEqual(await readdir(path.join(dataRoot, 'executions')), []);
});

test('the exact prepared runner reproduces the reviewed report locally without inference or cloud access', async (t) => {
  const { service, dataRoot } = await fixture(t, { inferenceRuntime: runtime('hold_position') });
  const state = createSimulation('restricted');
  const decision = await advise(service, state, 'Hold while an operator inspects the floor.');
  const bundle = await service.handle('bundle', { state, decisionId: decision.id, config, consent: true });
  assert.equal(bundle.request.spec.platform, 'cpu-d3');
  assert.equal(bundle.request.spec.preset, '2vcpu-8gb');
  assert.equal(bundle.request.spec.timeout, '3600s');
  assert.equal(bundle.request.spec.preemptible, false);
  const result = await promisify(execFile)(process.execPath, [path.join(dataRoot, 'bundles', bundle.id, 'route_job_runner.mjs')], { timeout: 5000, maxBuffer: 1024 * 1024 });
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout.slice('ROUTE_JOB_RESULT '.length));
  assert.equal(sha256(report), bundle.resultSha256);
  assert.equal(report.baseline.complete, true);
  assert.equal(report.selected.complete, false);
  assert.equal(report.selected.moves, 0);
  assert.equal(report.modelDecisionApplied, true);
  assert.equal(report.inferenceLocation, 'desk-runtime-before-job');
  assert.equal(report.physicalHardware, false);
  const restarted = await createRouteService({ dataRoot });
  assert.equal((await restarted.handle('bundleinfo', { id: bundle.id })).resultSha256, bundle.resultSha256);
  await writeFile(path.join(dataRoot, 'bundles', bundle.id, 'core.js'), 'tampered');
  await assert.rejects(restarted.handle('bundleinfo', { id: bundle.id }), /changed after review/);
});

test('cloud configuration is explicit and bounded; bundle preparation never submits', async (t) => {
  const { service, dataRoot } = await fixture(t);
  const state = createSimulation('detour');
  for (const invalid of [{ ...config, projectId: '../escape' }, { ...config, preset: '8gpu-128vcpu-1600gb' }, { ...config, command: 'echo unsafe' }, { ...config, platform: 'gpu-h100' }]) {
    await assert.rejects(service.handle('bundle', { state, config: invalid, consent: true }));
  }
  assert.deepEqual(await readdir(path.join(dataRoot, 'bundles')), []);
  const bundle = await service.handle('bundle', { state, config, consent: true });
  await assert.rejects(service.handle('submit', { bundleId: bundle.id, consent: true }), /not configured/);
  assert.deepEqual(await readdir(path.join(dataRoot, 'claims')), []);
});

test('bundle upload bytes, fixed file set, input, and trusted harness are all checked before any submission', async (t) => {
  let calls = 0;
  const jobsRuntime = { status: () => ({ configured: true }), submit: async () => { calls++; throw new Error('must never run'); } };
  const { service, dataRoot } = await fixture(t, { jobsRuntime });
  const bundle = await service.handle('bundle', { state: createSimulation('detour'), config, consent: true });
  const recordPath = path.join(dataRoot, 'bundles', `${bundle.id}.json`);
  const original = JSON.parse(await readFile(recordPath, 'utf8'));
  const runnerPath = path.join(dataRoot, 'bundles', bundle.id, 'route_job_runner.mjs');
  const cases = [
    (value) => { value.files['route_job_runner.mjs'] = 'console.log("unreviewed")'; value.request = jobRequest(value); },
    (value) => { value.files['route_job_runner.mjs'] = 'console.log("unreviewed")'; value.fileHashes['route_job_runner.mjs'] = sha256(value.files['route_job_runner.mjs']); value.request = jobRequest(value); },
    (value) => { value.files['extra.js'] = 'console.log("extra")'; value.fileHashes['extra.js'] = sha256(value.files['extra.js']); value.request = jobRequest(value); },
    (value) => { value.input.state = createSimulation('restricted'); },
  ];
  for (const mutate of cases) {
    const edited = structuredClone(original); mutate(edited);
    await writeFile(recordPath, JSON.stringify(edited));
    await assert.rejects(service.handle('submit', { bundleId: bundle.id, consent: true }), /changed after review|unexpected file|input differs/);
  }
  const replaced = structuredClone(original);
  replaced.files['route_job_runner.mjs'] = 'console.log("all persisted copies replaced")';
  replaced.fileHashes['route_job_runner.mjs'] = sha256(replaced.files['route_job_runner.mjs']);
  replaced.request = jobRequest(replaced);
  await writeFile(runnerPath, replaced.files['route_job_runner.mjs']);
  await writeFile(recordPath, JSON.stringify(replaced));
  await assert.rejects(service.handle('submit', { bundleId: bundle.id, consent: true }), /trusted harness/);
  assert.equal(calls, 0);
  assert.deepEqual(await readdir(path.join(dataRoot, 'claims')), []);
});

test('one durable submission claim survives concurrency and status never masquerades as a verified result', async (t) => {
  let submits = 0; let report; let status = 'RUNNING'; let requestedSince;
  const jobsRuntime = { status: () => ({ configured: true }), submit: async () => { submits++; return { resourceId: 'job-fixture', submitted: true }; },
    poll: async () => ({ state: status, transport: 'fixture' }), logs: async (_id, _consent, since) => { requestedSince = since; return { stdout: `ROUTE_JOB_RESULT ${JSON.stringify(report)}\n`, transport: 'fixture', liveLogsVerified: false }; } };
  const { service, dataRoot } = await fixture(t, { jobsRuntime });
  const bundle = await service.handle('bundle', { state: createSimulation('detour'), config, consent: true });
  report = bundle.expectedReport;
  const results = await Promise.allSettled([1, 2].map(() => service.handle('submit', { bundleId: bundle.id, consent: true })));
  assert.equal(submits, 1); assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const job = results.find((r) => r.status === 'fulfilled').value;
  assert.equal((await service.handle('poll', { jobId: job.id, consent: true })).resultVerified, false);
  await assert.rejects(service.handle('logs', { jobId: job.id, consent: true }), /not completed/);
  assert.equal(requestedSince, job.submittedAt);
  status = 'COMPLETED';
  assert.equal((await service.handle('poll', { jobId: job.id, consent: true })).resultVerified, false);
  report = { ...report, selected: { ...report.selected, moves: 999 } };
  await assert.rejects(service.handle('logs', { jobId: job.id, consent: true }), /differs/);
  report = bundle.expectedReport;
  const verified = await service.handle('logs', { jobId: job.id, consent: true });
  assert.equal(verified.resultVerified, true);
  assert.equal(verified.liveExecutionVerified, false);
  assert.equal(verified.transport, 'fixture');
  const restarted = await createRouteService({ dataRoot, jobsRuntime });
  await assert.rejects(restarted.handle('submit', { bundleId: bundle.id, consent: true }), /already has a submission/);
});

test('uncertain submission is persisted and cannot be repeated', async (t) => {
  const jobsRuntime = { status: () => ({ configured: true }), submit: async () => { throw new Error('timeout'); } };
  const { service } = await fixture(t, { jobsRuntime });
  const bundle = await service.handle('bundle', { state: createSimulation('detour'), config, consent: true });
  await assert.rejects(service.handle('submit', { bundleId: bundle.id, consent: true }), /confirmed job ID/);
  const { jobs } = await service.handle('list');
  assert.equal(jobs[0].state, 'SUBMISSION_UNKNOWN');
  await assert.rejects(service.handle('submit', { bundleId: bundle.id, consent: true }), /already has/);
});

test('the cloud adapter uses only documented REST paths, separate auth and bounded CLI logs', async () => {
  const calls = []; const cli = [];
  const client = createServerlessJobs({ token: 'cloud-fixture-token', profile: 'test-profile',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(options.method === 'POST' ? { resourceId: 'job-fixture' } : { metadata: { id: 'job-fixture' }, status: { state: 'COMPLETED' } })); },
    execFileImpl: async (...args) => { cli.push(args); return { stdout: 'fixture logs' }; } });
  assert.equal(calls.length, 0);
  await assert.rejects(client.submit({}, false), /consent/);
  await client.submit({}, true);
  await client.poll('job-fixture', true);
  const since = '2026-09-20T11:00:00.000Z';
  const logs = await client.logs('job-fixture', true, since);
  assert.equal(logs.stdout, 'fixture logs');
  assert.equal(logs.liveLogsVerified, false);
  assert.equal(client.status().transport, 'fixture');
  assert.deepEqual(calls.map((c) => c.url), ['https://api.nebius.cloud/ai/v1/jobs', 'https://api.nebius.cloud/ai/v1/jobs/job-fixture']);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer cloud-fixture-token');
  assert.deepEqual(cli[0].slice(0, 2), ['nebius', ['--profile', 'test-profile', 'ai', 'job', 'logs', 'job-fixture', '--since', since]]);
  await assert.rejects(client.logs('job-fixture', true, '1h'), /tracked submission timestamp/);
  await assert.rejects(client.poll('../escape', true), /Invalid tracked/);
  assert.equal(calls.length, 2);
});

test('provider stream exceptions are redacted', async () => {
  const client = createServerlessJobs({ token: 'fixture', fetchImpl: async () => ({ ok: true, body: { getReader: () => ({ read: async () => { throw new Error('secret-access-token'); }, cancel: async () => {} }) } }) });
  await assert.rejects(client.poll('job-fixture', true), (error) => /could not be read/.test(error.message) && !error.message.includes('secret-access-token'));
});
