import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startDeskServer } from '../src/desk/server.js';
import { createRouteService } from '../src/route/service.js';
import { hashStructuredOutput } from '../src/integrations/runtime.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'route-recovery-browser-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const control = { action: 'hold_position', fail: false, pause: false };
  const inferenceRuntime = { async generate({ input }) {
    if (control.pause) await new Promise((resolve) => { control.release = resolve; });
    if (control.fail) throw new Error('fixture provider unavailable');
    const value = { stateSha256: input.stateSha256, action: control.action, reason: 'Fixture: follow the operator objective; <script> is literal text.' };
    return { value, inference: { provider: 'fixture', model: 'nvidia/nemotron-fixture', transport: 'fixture', liveInferenceVerified: false, outputSha256: hashStructuredOutput(value) } };
  } };
  const server = await startDeskServer({ port: 0, workspaceRoot: root, dataRoot: path.join(root, 'data'), inferenceRuntime,
    factories: { route: (options) => createRouteService({ ...options, jobsRuntime: { status: () => ({ configured: false }) } }) } });
  t.after(() => server.close());
  const browser = await chromium.launch({ headless: true, timeout: 15000, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => { if (entry.type() === 'error' && !/Failed to load resource: the server responded with a status of 400/.test(entry.text())) errors.push(entry.text()); });
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(`${server.url}/route/`);
  await page.waitForFunction(() => document.querySelector('#recovery-availability').textContent.includes('Optional model inference'));
  return { page, control };
}
async function request(page) {
  await page.locator('#recovery-send-consent').check();
  await page.locator('#recovery-request').click();
  await page.waitForFunction(() => document.querySelector('#recovery-feedback').textContent.startsWith('Review the decision'));
}
async function downloaded(page, button) {
  const waiting = page.waitForEvent('download');
  await page.locator(button).click();
  const file = await waiting;
  return JSON.parse(await readFile(await file.path(), 'utf8'));
}

test('recovery consent controls real movement; bundle review and history persist without cloud submission', { timeout: 90000 }, async (t) => {
  const { page, control } = await fixture(t);
  await page.locator('#recovery-enabled').check();
  assert.equal(await page.locator('#run').isDisabled(), true);
  assert.equal(await page.locator('#recovery-request').isDisabled(), true);
  await request(page);
  assert.match(await page.locator('#recovery-decision').textContent(), /hold position.*literal text/);
  assert.equal(await page.locator('#recovery-decision script').count(), 0);
  assert.equal(await page.locator('#run').isDisabled(), true);
  await page.locator('#recovery-apply-consent').check();
  await page.locator('#run').click();
  await page.waitForFunction(() => document.querySelector('#recovery-feedback').textContent.includes('0 audited moves'));
  assert.equal(await page.locator('#moves').textContent(), '0');
  control.action = 'follow_validated_route';
  await page.locator('#recovery-goal').fill('The inspection is finished. Follow a permitted route.');
  await request(page);
  await page.locator('#recovery-apply-consent').check();
  await page.locator('#run').click();
  await page.waitForFunction(() => document.querySelector('#status-title').textContent === 'Destination reached');
  const receipt = await downloaded(page, '#recovery-export');
  assert.equal(receipt.movesExecuted, 6);
  assert.equal(receipt.inference.liveInferenceVerified, false);
  assert.equal(receipt.baselineEvidence.historyValid, true);
  assert.equal(receipt.baselineEvidence.modelUsed, false);
  await page.locator('#reset').click();
  await page.locator('#recovery-enabled').uncheck();
  await page.locator('.cloud-section summary').click();
  await page.locator('#job-project').fill('project-fixture');
  await page.locator('#job-subnet').fill('vpcsubnet-fixture');
  await page.locator('#job-platform').selectOption('cpu-d3');
  await page.locator('#job-prepare').click();
  await page.waitForFunction(() => document.querySelector('#job-feedback').textContent.startsWith('Bundle prepared locally'));
  const bundle = await downloaded(page, '#job-download');
  assert.equal(bundle.cloudExecutionVerified, false);
  assert.equal(bundle.request.spec.platform, 'cpu-d3');
  assert.equal(bundle.input.decision, null);
  assert.equal(await page.locator('#job-submit').isDisabled(), true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#job-bundle-history').options.length > 1);
  await page.locator('.cloud-section summary').click();
  await page.locator('#job-bundle-history').selectOption(bundle.id);
  await page.waitForFunction(() => document.querySelector('#job-feedback').textContent.startsWith('Saved bundle opened'));
  assert.equal((await downloaded(page, '#job-download')).id, bundle.id);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no horizontal overflow at ${width}`);
  }
});

test('changed-state and failed inference responses never authorize Run or silently prepare a model fallback', { timeout: 90000 }, async (t) => {
  const { page, control } = await fixture(t);
  await page.locator('#recovery-enabled').check();
  await page.locator('#recovery-send-consent').check();
  control.pause = true;
  await page.locator('#recovery-request').click();
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const poll = () => control.release ? resolve() : Date.now() > deadline ? reject(new Error('Fixture inference not requested')) : setTimeout(poll, 20);
    poll();
  });
  await page.locator('#suggested-edit').click();
  control.release(); control.pause = false;
  await page.waitForFunction(() => document.querySelector('#recovery-feedback').textContent.includes('State or objective changed'));
  assert.equal(await page.locator('#run').isDisabled(), true);
  assert.equal(await page.locator('#job-prepare').isDisabled(), true);
  assert.equal(await page.locator('#moves').textContent(), '0');
  control.fail = true;
  await page.locator('#recovery-request').click();
  await page.waitForFunction(() => document.querySelector('#recovery-feedback').textContent.includes('inference failed'));
  assert.equal(await page.locator('#run').isDisabled(), true);
  assert.equal(await page.locator('#moves').textContent(), '0');
});
