// This exact file is injected into the reviewed job bundle with the three
// sibling modules. It reads only its fixed input; there are no provider calls.
import { readFile } from 'node:fs/promises';
import { evaluateJob } from './recoveryPolicy.js';

try {
  const bytes = await readFile(new URL('./input.json', import.meta.url));
  if (bytes.length > 64 * 1024) throw new Error('Job input exceeds 64 KiB.');
  const report = evaluateJob(JSON.parse(bytes.toString('utf8')));
  process.stdout.write(`ROUTE_JOB_RESULT ${JSON.stringify(report)}\n`);
} catch (error) {
  process.stderr.write(`Route simulation failed: ${error.message}\n`);
  process.exitCode = 1;
}
