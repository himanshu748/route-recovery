import { createSimulation, stepSimulation, editCell, exportEvidence } from './core.js';
import { SCENARIOS } from './scenarios.js';
import { initializeRecovery } from './recovery.js';
import { animateChange, cancelMotion } from '/motion.js';

const $ = (id) => document.getElementById(id);
$('product-nav').hidden = window.location.pathname !== '/route/';
const same = (a, b) => a.x === b.x && a.y === b.y;
const coordinate = (cell) => `${String.fromCharCode(65 + cell.x)}${cell.y + 1}`;
let state;
let timer = null;
let mode = 'obstacle';
let focusedCell = { x: 0, y: 0 };
let uiError = false;
const cells = [];
let recovery;
let renderedState = null;
const robotMarker = document.createElement('span');
robotMarker.className = 'robot';
robotMarker.textContent = 'R';
const ease = 'cubic-bezier(0.16, 1, 0.3, 1)';
const points = (path) => path.map((cell) => `${cell.x + .5},${cell.y + .5}`).join(' ');

function cancelRobotMotion() {
  cancelMotion(robotMarker);
}

function feedback(message, error = false) {
  const changed = $('feedback').textContent !== message;
  $('feedback').textContent = message;
  $('feedback').dataset.error = String(error);
  if (changed) animateChange($('feedback'), [{ backgroundColor: error ? '#f7ddcf' : '#e4ece4' }, { backgroundColor: 'transparent' }], { duration: 360, easing: ease });
}

function stopTimer() {
  if (timer !== null) clearInterval(timer);
  timer = null;
  cancelRobotMotion();
}

function currentScenario() {
  return SCENARIOS.find((scenario) => scenario.id === state.scenarioId);
}

function buildFloor() {
  cancelRobotMotion();
  cancelMotion($('route-line'));
  cancelMotion($('status-label'));
  cancelMotion($('feedback'));
  for (const cell of cells) cancelMotion(cell);
  renderedState = null;
  cells.length = 0;
  $('floor').replaceChildren();
  $('column-labels').replaceChildren();
  $('row-labels').replaceChildren();
  for (let x = 0; x < state.width; x++) {
    const label = document.createElement('span');
    label.textContent = String.fromCharCode(65 + x);
    $('column-labels').append(label);
  }
  for (let y = 0; y < state.height; y++) {
    const label = document.createElement('span');
    label.textContent = String(y + 1);
    $('row-labels').append(label);
    for (let x = 0; x < state.width; x++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      cell.tabIndex = x === focusedCell.x && y === focusedCell.y ? 0 : -1;
      const content = document.createElement('span');
      content.className = 'cell-content';
      content.setAttribute('aria-hidden', 'true');
      cell.append(content);
      cell.addEventListener('click', () => applyEdit({ x, y }));
      cell.addEventListener('focus', () => setFloorFocus({ x, y }, false));
      cell.addEventListener('keydown', (event) => {
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!directions[event.key]) return;
        event.preventDefault();
        const [dx, dy] = directions[event.key];
        setFloorFocus({ x: Math.max(0, Math.min(state.width - 1, x + dx)), y: Math.max(0, Math.min(state.height - 1, y + dy)) }, true);
      });
      cells.push(cell);
      $('floor').append(cell);
    }
  }
  $('route-overlay').setAttribute('viewBox', `0 0 ${state.width} ${state.height}`);
}

function setFloorFocus(position, focus) {
  focusedCell = position;
  for (const cell of cells) cell.tabIndex = Number(cell.dataset.x) === position.x && Number(cell.dataset.y) === position.y ? 0 : -1;
  if (focus) cells[position.y * state.width + position.x].focus();
}

function renderFloor() {
  const moved = renderedState && renderedState.scenarioId === state.scenarioId && state.moves === renderedState.moves + 1
    && Math.abs(state.position.x - renderedState.position.x) + Math.abs(state.position.y - renderedState.position.y) === 1;
  // Rapid stepping finishes the prior visual move at its recorded cell first.
  // A new move must never interpolate diagonally across an intervening wall.
  if (moved || uiError || state.status === 'blocked') cancelRobotMotion();
  const fromRect = moved && robotMarker.isConnected ? robotMarker.getBoundingClientRect() : null;
  for (const cell of cells) {
    const position = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) };
    const kind = state.walls.some((item) => same(item, position)) ? 'wall'
      : state.obstacles.some((item) => same(item, position)) ? 'obstacle'
        : state.restricted.some((item) => same(item, position)) ? 'restricted' : 'open';
    const robot = same(position, state.position);
    const goal = same(position, state.goal);
    const start = same(position, state.start);
    cell.dataset.kind = kind;
    cell.dataset.robot = String(robot);
    cell.setAttribute('aria-label', `${coordinate(position)}: ${robot ? 'robot' + (goal ? ', goal reached' : '') : goal ? 'goal' : start ? 'start' : kind}`);
    cell.setAttribute('aria-disabled', String(kind === 'wall' || robot || goal || start || state.status === 'complete'));
    const content = cell.firstElementChild;
    if (robot) {
      if (content.firstElementChild !== robotMarker) content.replaceChildren(robotMarker);
      robotMarker.dataset.coordinate = coordinate(position);
    } else if (goal || start) {
      const marker = document.createElement('span');
      marker.className = goal ? 'goal' : 'start';
      marker.textContent = goal ? 'G' : 'S';
      content.replaceChildren(marker);
    } else content.textContent = kind === 'obstacle' ? '×' : kind === 'restricted' ? '/' : '';
    if (renderedState) {
      const previousKind = renderedState.kinds[position.y * state.width + position.x];
      if (previousKind !== kind) animateChange(cell, [{ boxShadow: 'inset 0 0 0 3px #b6441b' }, { boxShadow: 'inset 0 0 0 0px transparent' }], { duration: 380, easing: ease });
    }
  }
  $('route-line').setAttribute('points', points(state.route));
  const executed = [state.start, ...state.events.filter((event) => event.type === 'moved').map((event) => event.details.to)];
  $('executed-line').setAttribute('points', state.moves > 0 ? points(executed) : '');
  if (renderedState && state.replans > renderedState.replans && state.route.length) {
    animateChange($('route-line'), [{ opacity: .25, strokeWidth: .1 }, { opacity: 1, strokeWidth: .065 }], { duration: 380, easing: ease });
  }
  if (fromRect) {
    const targetRect = robotMarker.getBoundingClientRect();
    animateChange(robotMarker, [{ transform: `translate(${fromRect.left - targetRect.left}px, ${fromRect.top - targetRect.top}px)` }, { transform: 'translate(0, 0)' }], { duration: 280, easing: ease });
  }
  $('robot-coordinate').textContent = coordinate(state.position);
  $('next-coordinate').textContent = state.route[1] ? coordinate(state.route[1]) : state.status === 'complete' ? 'Arrived' : 'Hold';
  $('goal-coordinate').textContent = coordinate(state.goal);
  $('map-route-state').textContent = uiError ? 'Run stopped' : state.status === 'complete' ? 'Delivery recorded' : state.status === 'blocked' ? 'No permitted route' : `${state.replans ? 'Revised' : 'Permitted'} route · ${state.route.length - 1} moves`;
  $('map-route-state').dataset.status = uiError ? 'error' : state.status;
  $('floor').parentElement.dataset.status = uiError ? 'error' : state.status;
}

function render() {
  const running = timer !== null;
  const terminal = state.status === 'blocked' || state.status === 'complete';
  const labels = {
    ready: ['Ready', 'Ready for dispatch', 'The permitted route is marked on the floor. Start the delivery or change the map.'],
    moving: running
      ? ['Moving', 'Delivery in progress', 'Each move is checked against the current floor. Introduce a change while the robot is moving.']
      : ['Paused', 'Paused on the floor', 'The robot will stay here until you run the delivery or take another step.'],
    blocked: ['Help requested', 'No permitted route', 'The robot has stopped. Clear an obstacle or restriction to open a route, then restart the delivery.'],
    complete: ['Delivered', 'Destination reached', 'The robot reached the goal through permitted cells. Export the executed actions or reset for another run.'],
    error: ['Stopped', 'Run needs a reset', 'A simulation or evidence check failed. The robot has stopped; see the message below the map.'],
  };
  const displayStatus = uiError ? 'error' : running || (state.status === 'ready' && state.moves > 0) ? 'moving' : state.status;
  const [label, title, description] = labels[displayStatus];
  const statusChanged = renderedState && $('status-label').textContent !== label;
  $('mission-status').dataset.status = displayStatus;
  $('status-label').textContent = label;
  $('status-title').textContent = title;
  $('status-description').textContent = description;
  if (statusChanged) animateChange($('status-label'), [{ opacity: .45 }, { opacity: 1 }], { duration: 200, easing: ease });
  $('compact-status').textContent = `${label} · ${state.moves} moves executed${state.status === 'blocked' ? ' · Clear a crossing to continue.' : ''}`;
  $('compact-status').dataset.status = displayStatus;
  $('moves').textContent = String(state.moves);
  $('remaining').textContent = state.status === 'blocked' ? '—' : String(Math.max(0, state.route.length - 1));
  $('replans').textContent = String(state.replans);
  $('violations').textContent = String(state.constraintViolations);
  $('run').textContent = running ? 'Pause delivery' : state.moves > 0 && !terminal ? 'Resume delivery' : 'Run delivery';
  $('run').dataset.running = String(running);
  $('run').disabled = terminal || uiError;
  $('step').disabled = terminal || running || uiError;
  $('reset').disabled = false;
  $('export').disabled = uiError;
  $('suggested-edit').disabled = state.status === 'complete' || uiError;
  for (const radio of document.querySelectorAll('[name="edit-mode"]')) radio.disabled = state.status === 'complete' || uiError;
  $('event-count').textContent = state.events.length > 40 ? `Latest 40 of ${state.events.length}` : `${state.events.length} events`;
  $('event-log').replaceChildren(...state.events.slice(-40).reverse().map((event) => {
    const entry = document.createElement('li');
    const sequence = document.createElement('span');
    sequence.className = 'sequence';
    sequence.textContent = String(event.sequence).padStart(2, '0');
    const message = document.createElement('span');
    message.className = 'event-message';
    message.textContent = event.type === 'moved'
      ? `Moved ${coordinate(event.details.from)} → ${coordinate(event.details.to)}.`
      : event.type === 'cell_edited'
        ? `${event.details.mode === 'erase' ? 'Cleared' : event.details.mode === 'obstacle' ? 'Obstructed' : 'Restricted'} ${coordinate(event.details.cell)}.`
        : event.details.message;
    entry.append(sequence, message);
    return entry;
  }));
  const suggestion = currentScenario().suggestedEdit;
  const alreadyApplied = suggestion.mode === 'erase'
    ? !state.obstacles.some((cell) => same(cell, suggestion.cell)) && !state.restricted.some((cell) => same(cell, suggestion.cell))
    : state[suggestion.mode === 'obstacle' ? 'obstacles' : 'restricted'].some((cell) => same(cell, suggestion.cell));
  $('suggested-edit').disabled ||= alreadyApplied || same(state.position, suggestion.cell);
  $('suggested-edit').textContent = alreadyApplied ? 'Change applied' : `${suggestion.mode === 'erase' ? 'Clear obstruction' : 'Place obstacle'} at ${coordinate(suggestion.cell)}`;
  renderFloor();
  if (renderedState && state.events.length > renderedState.eventCount) animateChange($('event-log').firstElementChild, [{ backgroundColor: '#3c5559' }, { backgroundColor: 'transparent' }], { duration: 360, easing: ease });
  renderedState = { scenarioId: state.scenarioId, position: { ...state.position }, moves: state.moves, replans: state.replans, eventCount: state.events.length, kinds: cells.map((cell) => cell.dataset.kind) };
  recovery?.changed(state);
}

function fail(error) {
  stopTimer();
  cancelRobotMotion();
  uiError = true;
  feedback(`Simulation stopped: ${error.message}. Reset to start a new run.`, true);
  if (state) render();
}

function step() {
  try {
    state = stepSimulation(state);
    if (state.status === 'blocked' || state.status === 'complete') stopTimer();
    render();
  } catch (error) { fail(error); }
}

function applyEdit(position, selectedMode = mode) {
  cancelRobotMotion();
  if (uiError) return;
  if (state.status === 'complete') return feedback('Delivery finished. Reset before editing a new mission.', true);
  try {
    const next = editCell(state, position, selectedMode);
    const changed = next !== state;
    state = next;
    if (state.status === 'blocked') stopTimer();
    feedback(changed ? `${coordinate(position)} updated. ${state.status === 'blocked' ? 'No permitted route; help requested.' : 'Route checked against the new floor.'}` : `${coordinate(position)} already matches this tool.`);
    render();
  } catch (error) { feedback(error.message, true); }
}

function reset(id = state?.scenarioId ?? SCENARIOS[0].id) {
  stopTimer();
  uiError = false;
  try {
    state = createSimulation(id);
    focusedCell = { ...state.start };
    const scenario = currentScenario();
    $('scenario').value = id;
    $('mission-code').textContent = `MISSION ${String(SCENARIOS.indexOf(scenario) + 1).padStart(2, '0')}`;
    $('floor-title').textContent = scenario.name;
    $('scenario-description').textContent = scenario.description;
    $('grid-size').textContent = `${state.width} × ${state.height} cells`;
    $('suggestion-description').textContent = id === 'no-route'
      ? 'The only crossing is blocked. Clear it to make this delivery possible.'
      : id === 'restricted'
        ? 'The direct crossing is restricted. Block the lower crossing to test another detour.'
        : 'Block the direct crossing. The planner must find a longer, permitted route.';
    buildFloor();
    feedback(state.status === 'blocked' ? 'No permitted route. Clear the suggested obstruction to continue.' : 'Select any editable cell to change the mission.');
    render();
  } catch (error) { fail(error); }
}

try {
  $('scenario').replaceChildren(...SCENARIOS.map((scenario, index) => {
    const option = document.createElement('option');
    option.value = scenario.id;
    option.textContent = `${String(index + 1).padStart(2, '0')} / ${scenario.name}`;
    return option;
  }));
  $('scenario').disabled = false;
  $('scenario').addEventListener('change', (event) => reset(event.target.value));
  $('run').addEventListener('click', () => {
    if (recovery?.active()) { recovery.run(); return; }
    if (timer !== null) { stopTimer(); render(); return; }
    if (state.status === 'blocked' || state.status === 'complete' || uiError) return;
    timer = setInterval(step, 450);
    step();
  });
  $('step').addEventListener('click', step);
  $('reset').addEventListener('click', () => reset());
  $('suggested-edit').addEventListener('click', () => {
    const suggestion = currentScenario().suggestedEdit;
    applyEdit(suggestion.cell, suggestion.mode);
  });
  for (const radio of document.querySelectorAll('[name="edit-mode"]')) radio.addEventListener('change', (event) => {
    mode = event.target.value;
    feedback(`${mode === 'erase' ? 'Clear' : mode === 'restricted' ? 'Restrict' : 'Obstruct'} an editable floor cell.`);
  });
  $('export').addEventListener('click', () => {
    try {
      const evidence = exportEvidence(state);
      const blob = new Blob([JSON.stringify(evidence, null, 2) + '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `route-recovery-${state.scenarioId}-${new Date().toISOString().replaceAll(':', '-')}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      feedback('Run exported. The file records executed actions and local simulation limits.');
    } catch (error) { fail(error); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && timer !== null) { stopTimer(); render(); feedback('Paused because the page is in the background.'); }
  });
  window.addEventListener('pagehide', stopTimer);
  reset();
  recovery = initializeRecovery({ getState: () => state, setState: (next) => { state = next; render(); }, pause: stopTimer, refresh: render });
  render();
} catch (error) {
  stopTimer();
  $('status-label').textContent = 'Unavailable';
  $('status-title').textContent = 'Simulator could not load';
  $('status-description').textContent = 'Reload this page to retry. No delivery has been verified.';
  feedback(error.message, true);
}
