import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const JOB_ID = /^[a-zA-Z][a-zA-Z0-9-]{1,127}$/;
const LIMIT = 2 * 1024 * 1024;
const requireConsent = (value) => { if (value !== true) throw new Error('Explicit cloud consent is required.'); };

export function validateJobConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['projectId', 'subnetId', 'platform', 'preset'].includes(key))) throw new Error('Job configuration must include only project, subnet, platform, and preset.');
  for (const key of ['projectId', 'subnetId']) if (typeof value[key] !== 'string' || !JOB_ID.test(value[key])) throw new Error(`An explicit valid ${key} is required.`);
  if (!['cpu-d3', 'cpu-e2'].includes(value.platform) || value.preset !== '2vcpu-8gb') throw new Error('Only a CPU platform (cpu-d3 or cpu-e2) with the 2vcpu-8gb preset is allowed. Verify project availability before submitting.');
  return { ...value };
}

export function jobRequest({ id, config, files }) {
  validateJobConfig(config);
  return {
    metadata: { parentId: config.projectId, name: `route-${id}` },
    spec: {
      image: 'node:22-bookworm-slim', containerCommand: 'node', args: '/workspace/route_job_runner.mjs',
      workingDir: '/workspace', platform: config.platform, preset: config.preset,
      timeout: '3600s', subnetId: config.subnetId, preemptible: false,
      disk: { type: 'NETWORK_SSD', sizeBytes: 107374182400 }, shmSizeBytes: 67108864,
      injectedFiles: Object.entries(files).map(([name, content]) => {
        if (!/^[A-Za-z0-9_.-]+$/.test(name) || Buffer.byteLength(content) > 64 * 1024) throw new Error('Each injected file must have a safe name and be at most 64 KiB.');
        return { containerPath: `/workspace/${name}`, content: Buffer.from(content).toString('base64') };
      }),
    },
  };
}

// AI Cloud auth is deliberately separate from the Token Factory key. No
// request is sent during construction/status; only explicit service actions.
export function createServerlessJobs({ token = process.env.NEBIUS_CLOUD_ACCESS_TOKEN, profile = process.env.NEBIUS_CLOUD_PROFILE, fetchImpl = globalThis.fetch, execFileImpl = runFile } = {}) {
  const profileValid = typeof profile === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(profile);
  const liveTransport = fetchImpl === globalThis.fetch && execFileImpl === runFile;
  const transport = liveTransport ? 'nebius-ai-cloud-rest-and-cli' : 'fixture';
  async function request(method, route, consent, body) {
    requireConsent(consent);
    if (typeof token !== 'string' || !token.trim()) throw new Error('AI Cloud access token is not configured. Token Factory credentials cannot submit Jobs.');
    let response;
    try {
      response = await fetchImpl(`https://api.nebius.cloud/ai/v1/jobs${route}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new Error('AI Cloud request failed or timed out. Submission outcome may be unknown; do not retry blindly.'); }
    if (!response.ok) throw new Error(`AI Cloud returned HTTP ${response.status}. No successful execution was verified.`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('AI Cloud returned no response body.');
    const parts = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > LIMIT) throw new Error('AI Cloud response exceeded the limit.');
        parts.push(Buffer.from(value));
      }
    } catch { throw new Error('AI Cloud response could not be read within the response limit. No successful execution was verified.'); }
    finally { await reader.cancel().catch(() => {}); }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new Error('AI Cloud returned invalid JSON.'); }
  }
  function resource(value) {
    if (typeof value !== 'string' || !JOB_ID.test(value)) throw new Error('Invalid tracked cloud job ID.');
    return value;
  }
  return {
    status: () => ({ configured: Boolean(token?.trim()), logsConfigured: profileValid, transport, note: 'No live access verified. Logs require the Nebius CLI and an authenticated Cloud profile.' }),
    async submit(body, consent) {
      const result = await request('POST', '', consent, body);
      return { resourceId: resource(result.resourceId), submitted: true, executionVerified: false, liveExecutionVerified: false, transport, liveCloudContactVerified: liveTransport };
    },
    async poll(id, consent) {
      const result = await request('GET', `/${resource(id)}`, consent);
      if (result.metadata?.id !== id || typeof result.status?.state !== 'string') throw new Error('Cloud status did not identify the tracked job.');
      return { resourceId: id, state: result.status.state, executionVerified: false, liveExecutionVerified: false, transport, liveCloudContactVerified: liveTransport };
    },
    async logs(id, consent, since) {
      requireConsent(consent); resource(id);
      if (!profileValid) throw new Error('Configure NEBIUS_CLOUD_PROFILE and install/authenticate the Nebius CLI to retrieve logs.');
      if (typeof since !== 'string' || !Number.isFinite(Date.parse(since)) || new Date(since).toISOString() !== since) throw new Error('Log retrieval requires the tracked submission timestamp.');
      try {
        const { stdout } = await execFileImpl('nebius', ['--profile', profile, 'ai', 'job', 'logs', id, '--since', since], { timeout: 30000, maxBuffer: LIMIT, encoding: 'utf8' });
        if (Buffer.byteLength(stdout) > LIMIT) throw new Error('oversize');
        return { stdout, transport, liveLogsVerified: liveTransport };
      } catch { throw new Error('Job logs could not be read with the configured Nebius CLI profile. No result was verified.'); }
    },
  };
}
