import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startRouteServer } from '../src/route/server.js';

async function fixture(t, options = {}) {
  const running = await startRouteServer({ port: 0 });
  t.after(running.close);
  const browser = await chromium.launch({ headless: true, timeout: 20000, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, ...options });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  t.after(() => assert.deepEqual(errors, [], 'browser script and resource errors'));
  const clockTime = new Date('2026-09-12T09:00:00Z');
  await page.clock.install({ time: clockTime });
  await page.clock.pauseAt(new Date(clockTime.getTime() + 60000));
  await page.goto(running.url);
  await page.waitForFunction(() => document.querySelectorAll('.cell').length === 63);
  return page;
}

async function evidence(page) {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export run' }).click();
  const download = await downloaded;
  assert.equal(await download.failure(), null);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

test('browser executes a live detour, pauses exactly, arrives, and exports audited actions', { timeout: 60000 }, async (t) => {
  const page = await fixture(t);
  assert.equal(await page.locator('#status-title').textContent(), 'Ready for dispatch');
  assert.equal(await page.locator('#remaining').textContent(), '6');
  await page.locator('#run').click();
  assert.equal(await page.locator('#moves').textContent(), '1');
  await page.locator('#suggested-edit').click();
  assert.equal(await page.locator('#replans').textContent(), '1');
  assert.equal(await page.locator('#status-title').textContent(), 'Delivery in progress');
  assert.equal(await page.locator('#remaining').textContent(), '9');
  await page.locator('#run').click();
  await page.clock.runFor(2000);
  assert.equal(await page.locator('#moves').textContent(), '1');
  assert.equal(await page.locator('#status-title').textContent(), 'Paused on the floor');
  await page.locator('#run').click();
  await page.clock.runFor(6000);
  assert.equal(await page.locator('#status-title').textContent(), 'Destination reached');
  assert.equal(await page.locator('#moves').textContent(), '10');
  assert.equal(await page.locator('#violations').textContent(), '0');
  assert.equal(await page.locator('#run').isDisabled(), true);
  const run = await evidence(page);
  assert.equal(run.complete, true);
  assert.equal(run.historyValid, true);
  assert.equal(run.modelUsed, false);
  assert.equal(run.moves, 10);
  assert.equal(run.events.filter((event) => event.type === 'complete').length, 1);
  assert.ok(run.traveledPath.every((cell) => cell.x !== 4 || cell.y !== 3));
  assert.deepEqual(run.position, run.goal);
  assert.deepEqual(run.finalMap.obstacles, [{ x: 4, y: 3 }]);
  await page.locator('#reset').click();
  assert.equal(await page.locator('#moves').textContent(), '0');
  assert.equal(await page.locator('#remaining').textContent(), '6');
  assert.equal((await evidence(page)).complete, false);
});

test('an unreachable mission requests help without motion and resumes only after clearance', { timeout: 60000 }, async (t) => {
  const page = await fixture(t);
  await page.locator('#scenario').selectOption('no-route');
  assert.equal(await page.locator('#status-label').textContent(), 'Help requested');
  assert.match(await page.locator('#compact-status').textContent(), /Help requested.*Clear a crossing/);
  assert.equal(await page.locator('#run').isDisabled(), true);
  assert.equal(await page.locator('#step').isDisabled(), true);
  await page.clock.runFor(5000);
  const stopped = await evidence(page);
  assert.equal(stopped.complete, false);
  assert.equal(stopped.moves, 0);
  assert.deepEqual(stopped.position, stopped.start);
  await page.locator('#suggested-edit').click();
  assert.equal(await page.locator('#run').isEnabled(), true);
  await page.clock.runFor(2000);
  assert.equal(await page.locator('#moves').textContent(), '0', 'clearing does not silently restart');
  await page.locator('#run').click();
  await page.clock.runFor(4000);
  const delivered = await evidence(page);
  assert.equal(delivered.complete, true);
  assert.equal(delivered.moves, 6);
  assert.equal(delivered.initialMap.obstacles.length, 1);
  assert.equal(delivered.finalMap.obstacles.length, 0);
});

test('keyboard edits preserve protected cells and restricted routes in the browser', { timeout: 60000 }, async (t) => {
  const page = await fixture(t);
  const start = page.locator('.cell[data-x="1"][data-y="3"]');
  await start.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.cell[data-x="1"][data-y="2"]').getAttribute('data-kind'), 'obstacle');
  await page.getByText('Restrict cell', { exact: true }).click();
  await page.locator('.cell[data-x="2"][data-y="2"]').click();
  assert.equal(await page.locator('.cell[data-x="2"][data-y="2"]').getAttribute('data-kind'), 'restricted');
  await page.getByText('Clear cell', { exact: true }).click();
  await page.locator('.cell[data-x="2"][data-y="2"]').click();
  assert.equal(await page.locator('.cell[data-x="2"][data-y="2"]').getAttribute('data-kind'), 'open');
  await page.locator('.cell[data-x="4"][data-y="0"]').focus();
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#feedback').textContent(), /Permanent walls cannot be edited/);
  await page.locator('#scenario').selectOption('restricted');
  await page.locator('#suggested-edit').click();
  await page.locator('#run').click();
  await page.clock.runFor(6000);
  const run = await evidence(page);
  assert.equal(run.complete, true);
  assert.ok(run.traveledPath.every((cell) => cell.x !== 4 || (cell.y !== 3 && cell.y !== 5)));
  assert.equal(run.constraintViolations, 0);
  assert.equal(run.physicsSimulated, false);
});

test('blocking all crossings during motion stops the robot and requires an explicit restart', { timeout: 60000 }, async (t) => {
  const page = await fixture(t);
  await page.locator('#run').click();
  for (const y of [3, 5, 1]) await page.locator(`.cell[data-x="4"][data-y="${y}"]`).click();
  assert.equal(await page.locator('#status-label').textContent(), 'Help requested');
  await page.clock.runFor(5000);
  assert.equal(await page.locator('#moves').textContent(), '1');
  const blocked = await evidence(page);
  assert.equal(blocked.complete, false);
  assert.equal(blocked.status, 'blocked');
  await page.getByText('Clear cell', { exact: true }).click();
  await page.locator('.cell[data-x="4"][data-y="1"]').click();
  await page.clock.runFor(5000);
  assert.equal(await page.locator('#moves').textContent(), '1');
  await page.locator('#run').click();
  await page.clock.runFor(6000);
  const completed = await evidence(page);
  assert.equal(completed.complete, true);
  assert.equal(completed.constraintViolations, 0);
});

test('desktop and mobile surfaces fit, remain operable, and retain screenshots', { timeout: 60000 }, async (t) => {
  const page = await fixture(t);
  const captures = new URL('../.impeccable/review/', import.meta.url);
  await mkdir(captures, { recursive: true });
  for (const [name, width] of [['desktop', 1440], ['mobile', 390]]) {
    await page.setViewportSize({ width, height: 1080 });
    await page.locator('#reset').click();
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      content: document.documentElement.scrollWidth,
      cells: [...document.querySelectorAll('.cell')].map((cell) => ({ width: cell.getBoundingClientRect().width, height: cell.getBoundingClientRect().height })),
    }));
    assert.ok(dimensions.content <= dimensions.width, `${name} page should not overflow horizontally`);
    assert.ok(dimensions.cells.every((cell) => cell.width >= 24 && cell.height >= 24), `${name} floor cells remain usable targets`);
    await page.screenshot({ path: new URL(`${name}.png`, captures).pathname, fullPage: true, animations: 'disabled' });
  }
  await page.locator('#suggested-edit').click();
  await page.locator('#run').click();
  await page.clock.runFor(6000);
  assert.equal(await page.locator('#status-label').textContent(), 'Delivered');
});
