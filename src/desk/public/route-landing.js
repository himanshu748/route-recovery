import { createSimulation, stepSimulation, editCell, exportEvidence } from '/route/core.js';
import { animateChange, cancelMotion } from '/motion.js';

const $ = (id) => document.getElementById(id);
const same = (a, b) => a.x === b.x && a.y === b.y;
let state = createSimulation('detour');
let timer = null;
let renderedState = null;
let uiError = false;
const squares = [];
const robotMarker = document.createElement('span');
robotMarker.className = 'map-marker'; robotMarker.textContent = 'R';
const ease = 'cubic-bezier(0.16, 1, 0.3, 1)';
const points = (path) => path.map(({ x, y }) => `${x + .5},${y + .5}`).join(' ');
const crossing = { x: 4, y: 3 };
const coordinate = ({ x, y }) => `${String.fromCharCode(65 + x)}${y + 1}`;
function stop() { if (timer !== null) clearInterval(timer); timer = null; cancelMotion(robotMarker); }
function feedback(text, error = false) {
  const changed = $('demo-feedback').textContent !== text;
  $('demo-feedback').textContent = text; $('demo-feedback').dataset.error = String(error);
  if (changed) animateChange($('demo-feedback'), [{ backgroundColor: error ? '#f7ddcf' : '#e4ece4' }, { backgroundColor: '#fafaf6' }], { duration: 360, easing: ease });
}
function render() {
  const moved = renderedState && renderedState.scenarioId === state.scenarioId && state.moves === renderedState.moves + 1
    && Math.abs(state.position.x - renderedState.position.x) + Math.abs(state.position.y - renderedState.position.y) === 1;
  if (moved || uiError || state.status === 'blocked') cancelMotion(robotMarker);
  const fromRect = moved && robotMarker.isConnected ? robotMarker.getBoundingClientRect() : null;
  if (!squares.length) {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < state.width * state.height; index++) {
      const square = document.createElement('div'); square.className = 'demo-cell';
      squares.push(square); fragment.append(square);
    }
    $('demo-grid').replaceChildren(fragment);
  }
  for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) {
    const cell = { x, y }; const square = squares[y * state.width + x];
    const kind = state.walls.some((item) => same(item, cell)) ? 'wall' : state.obstacles.some((item) => same(item, cell)) ? 'obstacle' : 'open';
    square.dataset.kind = kind;
    square.dataset.robot = String(same(cell, state.position));
    if (same(cell, state.position)) {
      if (square.firstElementChild !== robotMarker) square.replaceChildren(robotMarker);
      robotMarker.dataset.coordinate = coordinate(cell);
    } else if (same(cell, state.goal)) {
      const marker = document.createElement('span');
      marker.className = 'map-marker goal-marker'; marker.textContent = 'G'; square.replaceChildren(marker);
    } else square.replaceChildren();
    if (renderedState && renderedState.kinds[y * state.width + x] !== kind) animateChange(square, [{ boxShadow: 'inset 0 0 0 3px #b6441b' }, { boxShadow: 'inset 0 0 0 0px transparent' }], { duration: 380, easing: ease });
  }
  $('demo-path').setAttribute('points', points(state.route));
  const executed = [state.start, ...state.events.filter((event) => event.type === 'moved').map((event) => event.details.to)];
  $('demo-executed').setAttribute('points', state.moves > 0 ? points(executed) : '');
  if (renderedState && state.replans > renderedState.replans && state.route.length) animateChange($('demo-path'), [{ opacity: .25, strokeWidth: .1 }, { opacity: 1, strokeWidth: .065 }], { duration: 380, easing: ease });
  if (fromRect) {
    const targetRect = robotMarker.getBoundingClientRect();
    animateChange(robotMarker, [{ transform: `translate(${fromRect.left - targetRect.left}px, ${fromRect.top - targetRect.top}px)` }, { transform: 'translate(0, 0)' }], { duration: 260, easing: ease });
  }
  const status = uiError ? 'Stopped' : state.status === 'complete' ? 'Delivered' : state.status === 'blocked' ? 'Stopped' : timer !== null ? 'Moving' : state.moves ? 'Paused' : state.replans ? 'Route updated' : 'Ready';
  const statusChanged = renderedState && $('demo-status').textContent !== status;
  $('demo-status').textContent = status; $('demo-status').dataset.status = uiError ? 'error' : state.status;
  if (statusChanged) animateChange($('demo-status'), [{ opacity: .5 }, { opacity: 1 }], { duration: 180, easing: ease });
  $('demo-map').dataset.status = uiError ? 'error' : state.status;
  $('demo-position').textContent = coordinate(state.position);
  $('demo-next').textContent = state.route[1] ? coordinate(state.route[1]) : state.status === 'complete' ? 'Arrived' : 'Hold';
  $('demo-goal').textContent = coordinate(state.goal);
  $('demo-map').setAttribute('aria-label', `Synthetic 9 by 7 delivery floor. Robot at ${coordinate(state.position)}, goal at ${coordinate(state.goal)}. ${status}. ${state.obstacles.length} obstacle. ${state.status === 'blocked' ? 'No legal route.' : `${Math.max(0, state.route.length - 1)} permitted moves remain.`}`);
  $('demo-remaining').textContent = state.status === 'blocked' ? '—' : String(Math.max(0, state.route.length - 1));
  $('demo-moves').textContent = String(state.moves);
  $('demo-violations').textContent = `${state.constraintViolations} constraint violations`;
  $('demo-run').disabled = state.status === 'blocked' || state.status === 'complete' || uiError;
  $('demo-run').textContent = timer === null ? 'Run delivery' : 'Pause delivery';
  $('demo-run').dataset.running = String(timer !== null);
  const blocked = state.obstacles.some((cell) => same(cell, crossing));
  $('demo-block').textContent = blocked ? 'Clear crossing' : 'Block crossing';
  $('demo-block').disabled = state.status === 'complete' || same(state.position, crossing) || uiError;
  $('demo-reset').disabled = false; $('demo-scenario').disabled = false;
  renderedState = { scenarioId: state.scenarioId, position: { ...state.position }, moves: state.moves, replans: state.replans, kinds: squares.map((square) => square.dataset.kind) };
}
function fail(error) { stop(); cancelMotion(robotMarker); uiError = true; feedback(`Simulation stopped: ${error.message}. Reset to try again.`, true); render(); }
function step() {
  try {
    state = stepSimulation(state);
    if (state.status === 'complete') { stop(); exportEvidence(state); feedback(`Arrived in ${state.moves} permitted moves. Reset to try a different floor.`); }
    render();
  } catch (error) { fail(error); }
}
$('demo-run').addEventListener('click', () => {
  if (timer !== null) { stop(); feedback('Paused. The robot stays at its current cell.'); render(); return; }
  if (state.status === 'blocked' || state.status === 'complete' || uiError) return;
  feedback('Following the permitted route. Each move is checked against the current floor.');
  timer = setInterval(step, 380); step();
});
$('demo-block').addEventListener('click', () => {
  try {
    stop();
    const blocked = state.obstacles.some((cell) => same(cell, crossing));
    state = editCell(state, crossing, blocked ? 'erase' : 'obstacle');
    feedback(state.status === 'blocked' ? 'No permitted route. Clear the crossing before restarting.' : blocked ? 'Crossing cleared. Press Run delivery to continue.' : `Crossing blocked. A permitted detour is ready: ${state.route.length - 1} moves.`);
    render();
  } catch (error) { fail(error); }
});
function reset() {
  stop(); cancelMotion(robotMarker);
  cancelMotion($('demo-path')); cancelMotion($('demo-status')); cancelMotion($('demo-feedback'));
  for (const square of squares) cancelMotion(square);
  renderedState = null; uiError = false; state = createSimulation($('demo-scenario').value);
  feedback(state.status === 'blocked' ? 'The only crossing is blocked. The robot must wait for clearance.' : 'Block the crossing at E4 to see the route change.'); render();
}
$('demo-reset').addEventListener('click', reset);
$('demo-scenario').addEventListener('change', reset);
document.addEventListener('visibilitychange', () => { if (document.hidden && timer !== null) { stop(); render(); feedback('Paused while this page is in the background.'); } });
window.addEventListener('pagehide', stop);
reset();
$('demo-unavailable').hidden = true;

const capture = $('route-record-image');
function showCaptureFallback() { capture.closest('picture').hidden = true; $('route-capture-fallback').hidden = false; }
capture.addEventListener('error', showCaptureFallback);
if (capture.complete && capture.naturalWidth === 0) showCaptureFallback();
