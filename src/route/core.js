import { SCENARIOS } from "./scenarios.js";

const statuses = new Set(["ready", "moving", "blocked", "complete"]);
const editModes = new Set(["obstacle", "restricted", "erase"]);
const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const maxEvents = 10_000;
const sameCell = (a, b) => a.x === b.x && a.y === b.y;
const cellKey = (cell) => `${cell.x},${cell.y}`;

export function createSimulation(scenarioId) {
  const scenario = getScenario(scenarioId);
  const state = {
    scenarioId,
    width: scenario.width, height: scenario.height,
    start: { ...scenario.start }, position: { ...scenario.start }, goal: { ...scenario.goal },
    walls: structuredClone(scenario.walls), restricted: structuredClone(scenario.restricted),
    obstacles: structuredClone(scenario.obstacles),
    status: "ready", moves: 0, replans: 0, constraintViolations: 0,
    route: [], events: []
  };
  addEvent(state, "initialized", "Started a deterministic 2D grid simulation.", { scenarioId });
  updateRoute(state, false);
  return freeze(state);
}

// A shortest four-neighbor route includes the current position and goal.
// The returned array is independent of state; no route is represented by null.
export function planRoute(state) {
  validateState(state);
  return findRoute(state);
}

export function stepSimulation(state) {
  validateState(state);
  if (state.status === "complete" || state.status === "blocked") return state;
  const next = state.route[1];
  // Validate the actual next movement even though planning also checks cells.
  if (!next || !isUnitMove(state.position, next) || !isOpen(state, next)) {
    throw new Error("The next move violates the route constraints");
  }
  const updated = structuredClone(state);
  const from = { ...updated.position };
  updated.position = { ...next };
  updated.route = updated.route.slice(1);
  updated.moves += 1;
  updated.status = sameCell(updated.position, updated.goal) ? "complete" : "moving";
  addEvent(updated, "moved", `Moved from (${from.x}, ${from.y}) to (${next.x}, ${next.y}).`, {
    from, to: { ...next }
  });
  if (updated.status === "complete") {
    addEvent(updated, "complete", `Reached the delivery goal in ${updated.moves} moves.`);
  }
  return freeze(updated);
}

export function editCell(state, cell, mode) {
  validateState(state);
  if (state.status === "complete") throw new Error("Reset before editing a completed mission");
  validateCell(cell, state, "Edited cell");
  if (!editModes.has(mode)) throw new TypeError("Edit mode must be obstacle, restricted, or erase");
  assertEditable(state, cell);
  const previousMode = cellMode(state, cell);
  if (previousMode === mode || (previousMode === "open" && mode === "erase")) return state;
  const updated = structuredClone(state);
  applyEdit(updated, cell, mode);
  addEvent(updated, "cell_edited", mode === "erase"
    ? `Cleared cell (${cell.x}, ${cell.y}).`
    : `Marked cell (${cell.x}, ${cell.y}) as ${mode}.`, {
    cell: { ...cell }, mode, previousMode
  });
  updateRoute(updated, true);
  return freeze(updated);
}

export function exportEvidence(state) {
  validateState(state);
  const traveledPath = auditHistory(state);
  const scenario = getScenario(state.scenarioId);
  return freeze({
    schemaVersion: 1,
    scenarioId: state.scenarioId,
    simulation: "deterministic-2d-grid",
    planner: "breadth-first-search",
    modelUsed: false,
    physicalHardware: false,
    physicsSimulated: false,
    initialMap: mapSnapshot(scenario),
    finalMap: mapSnapshot(state),
    complete: state.status === "complete" && sameCell(state.position, state.goal),
    status: state.status,
    moves: state.moves,
    replans: state.replans,
    constraintViolations: state.constraintViolations,
    historyValid: true,
    start: { ...state.start }, position: { ...state.position }, goal: { ...state.goal },
    traveledPath,
    remainingRoute: structuredClone(state.route),
    events: structuredClone(state.events)
  });
}

function mapSnapshot(source) {
  return {
    width: source.width,
    height: source.height,
    walls: structuredClone(source.walls),
    restricted: structuredClone(source.restricted),
    obstacles: structuredClone(source.obstacles)
  };
}

function updateRoute(state, isReplan) {
  state.route = findRoute(state) ?? [];
  if (isReplan) state.replans += 1;
  state.status = sameCell(state.position, state.goal) ? "complete" : state.route.length ? "ready" : "blocked";
  addEvent(state, isReplan ? "route_replanned" : "route_planned", state.route.length
    ? `${isReplan ? "Replanned" : "Planned"} a legal route with ${state.route.length - 1} remaining moves.`
    : "No legal route is available.", { route: structuredClone(state.route) });
  if (state.status === "blocked") {
    addEvent(state, "blocked_stop", "Stopped: every route to the goal is blocked or restricted.");
  }
}

function findRoute(state) {
  const index = (cell) => cell.y * state.width + cell.x;
  const forbidden = new Set([...state.walls, ...state.restricted, ...state.obstacles].map(index));
  const source = index(state.position);
  const goal = index(state.goal);
  if (forbidden.has(source) || forbidden.has(goal)) return null;
  const previous = new Int32Array(state.width * state.height).fill(-1);
  const queue = new Int32Array(previous.length);
  let head = 0;
  let tail = 1;
  queue[0] = source;
  previous[source] = source;
  while (head < tail && previous[goal] === -1) {
    const current = queue[head++];
    const x = current % state.width;
    const y = Math.floor(current / state.width);
    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      const candidate = ny * state.width + nx;
      if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height ||
          forbidden.has(candidate) || previous[candidate] !== -1) continue;
      previous[candidate] = current;
      queue[tail++] = candidate;
    }
  }
  if (previous[goal] === -1) return null;
  const route = [];
  for (let current = goal; ; current = previous[current]) {
    route.push({ x: current % state.width, y: Math.floor(current / state.width) });
    if (current === source) break;
  }
  return route.reverse();
}

function validateState(state) {
  if (!record(state)) throw new TypeError("Simulation state must be an object");
  const scenario = getScenario(state.scenarioId);
  if (state.width !== scenario.width || state.height !== scenario.height) {
    throw new Error("Grid dimensions do not match the scenario");
  }
  for (const name of ["start", "position", "goal"]) validateCell(state[name], state, name);
  if (!sameCell(state.start, scenario.start) || !sameCell(state.goal, scenario.goal)) {
    throw new Error("Start and goal do not match the scenario");
  }
  const occupied = new Set();
  for (const name of ["walls", "restricted", "obstacles"]) {
    if (!Array.isArray(state[name]) || state[name].length > state.width * state.height) {
      throw new TypeError(`${name} must be a bounded array of cells`);
    }
    for (const cell of state[name]) {
      validateCell(cell, state, name);
      if (occupied.has(cellKey(cell))) throw new Error("Blocked cell lists must be disjoint and contain no duplicates");
      occupied.add(cellKey(cell));
    }
  }
  if (!equalCells(state.walls, scenario.walls)) throw new Error("Scenario walls cannot be changed");
  if ([state.start, state.position, state.goal].some((cell) => occupied.has(cellKey(cell)))) {
    throw new Error("Start, robot position, and goal must remain traversable");
  }
  if (!statuses.has(state.status)) throw new TypeError("Unknown simulation status");
  for (const name of ["moves", "replans", "constraintViolations"]) {
    if (!Number.isSafeInteger(state[name]) || state[name] < 0) throw new TypeError(`${name} must be a nonnegative safe integer`);
  }
  if (!Array.isArray(state.route) || state.route.length > state.width * state.height) throw new TypeError("Invalid planned route");
  if (!Array.isArray(state.events) || state.events.length === 0 || state.events.length > maxEvents) {
    throw new TypeError(`Simulation requires between 1 and ${maxEvents} events`);
  }
  const atGoal = sameCell(state.position, state.goal);
  if ((state.status === "complete") !== atGoal) throw new Error("Completion status does not match the robot position");
  if (state.status === "blocked") {
    if (state.route.length !== 0 || findRoute(state) !== null) throw new Error("Blocked status requires no available legal route");
  } else {
    validateRoute(state, state.route);
  }
}

function validateRoute(state, route) {
  if (!Array.isArray(route) || route.length === 0 || route.length > state.width * state.height) {
    throw new Error("A planned route must include its current position and goal");
  }
  for (let index = 0; index < route.length; index++) {
    validateCell(route[index], state, "Route cell");
    if (!isOpen(state, route[index]) || (index > 0 && !isUnitMove(route[index - 1], route[index]))) {
      throw new Error("Planned route crosses a forbidden cell or contains a non-unit move");
    }
  }
  if (!sameCell(route[0], state.position) || !sameCell(route.at(-1), state.goal)) {
    throw new Error("Planned route endpoints do not match the robot and goal");
  }
}

// Reconstruct map edits and moves in order. A completion label, move counter,
// or legal final map alone does not prove the historical route was legal.
function auditHistory(state) {
  const initial = createSimulation(state.scenarioId);
  const replay = structuredClone(initial);
  replay.events = [];
  replay.route = [];
  let initialized = false;
  let initialPlan = false;
  let completionEvents = 0;
  let expectedNext = "initialized";
  const traveledPath = [{ ...replay.position }];
  for (const [index, event] of state.events.entries()) {
    if (!record(event) || event.sequence !== index + 1 || !record(event.details) ||
        typeof event.details.message !== "string" || !event.details.message.trim()) {
      throw new Error("Simulation event sequence or details are invalid");
    }
    if (expectedNext && event.type !== expectedNext) throw new Error(`Simulation history requires a ${expectedNext} event next`);
    expectedNext = null;
    validateCell(event.position, replay, "Event position");
    const details = event.details;
    if (event.type === "initialized") {
      if (index !== 0 || initialized || details.scenarioId !== state.scenarioId) throw new Error("Invalid initialization event");
      initialized = true;
      expectedNext = "route_planned";
    } else if (!initialized) {
      throw new Error("Simulation history must begin with initialization");
    } else if (event.type === "cell_edited") {
      if (replay.status === "complete") throw new Error("Simulation history contains an edit after mission completion");
      validateCell(details.cell, replay, "Edited event cell");
      if (!editModes.has(details.mode)) throw new Error("Invalid historical edit mode");
      assertEditable(replay, details.cell);
      if (details.previousMode !== cellMode(replay, details.cell)) throw new Error("Historical cell edit does not match its prior state");
      applyEdit(replay, details.cell, details.mode);
      expectedNext = "route_replanned";
    } else if (event.type === "route_planned" || event.type === "route_replanned") {
      if (event.type === "route_planned") {
        if (initialPlan || index !== 1) throw new Error("Invalid initial route plan event");
        initialPlan = true;
      } else {
        if (!initialPlan || state.events[index - 1]?.type !== "cell_edited") throw new Error("Replan must follow a map edit");
        replay.replans += 1;
      }
      const expected = findRoute(replay) ?? [];
      if (!Array.isArray(details.route) || !equalCells(details.route, expected, true)) throw new Error("Historical plan does not match the legal BFS route");
      replay.route = structuredClone(expected);
      replay.status = sameCell(replay.position, replay.goal) ? "complete" : expected.length ? "ready" : "blocked";
      if (replay.status === "blocked") expectedNext = "blocked_stop";
    } else if (event.type === "moved") {
      validateCell(details.from, replay, "Move origin");
      validateCell(details.to, replay, "Move destination");
      if (!initialPlan || replay.status === "complete" || replay.status === "blocked" ||
          !sameCell(details.from, replay.position) || !replay.route[1] ||
          !sameCell(details.to, replay.route[1]) || !isUnitMove(details.from, details.to) || !isOpen(replay, details.to)) {
        throw new Error("Historical move violates the planned route or cell constraints");
      }
      replay.position = { ...details.to };
      replay.route = replay.route.slice(1);
      replay.moves += 1;
      replay.status = sameCell(replay.position, replay.goal) ? "complete" : "moving";
      if (replay.status === "complete") expectedNext = "complete";
      traveledPath.push({ ...replay.position });
    } else if (event.type === "blocked_stop") {
      if (replay.status !== "blocked" || findRoute(replay) !== null) throw new Error("Historical stop has an available route");
    } else if (event.type === "complete") {
      completionEvents += 1;
      if (replay.status !== "complete" || completionEvents > 1 || state.events[index - 1]?.type !== "moved") {
        throw new Error("Completion event does not follow arrival at the goal");
      }
    } else {
      throw new Error("Unknown simulation event type");
    }
    if (!sameCell(event.position, replay.position)) throw new Error("Event position disagrees with the simulated history");
  }
  if (expectedNext || !initialPlan || replay.status !== state.status || !sameCell(replay.position, state.position) ||
      replay.moves !== state.moves || replay.replans !== state.replans || state.constraintViolations !== 0 ||
      !equalCells(replay.obstacles, state.obstacles) || !equalCells(replay.restricted, state.restricted) ||
      !equalCells(replay.route, state.route, true) || (state.status === "complete" && completionEvents !== 1)) {
    throw new Error("Final simulation state disagrees with the event history");
  }
  return traveledPath;
}

function addEvent(state, type, message, details = {}) {
  if (state.events.length >= maxEvents) throw new Error(`Simulation event limit of ${maxEvents} reached; reset to start a new run`);
  state.events.push({ sequence: state.events.length + 1, type, position: { ...state.position }, details: { message, ...details } });
}

function applyEdit(state, cell, mode) {
  state.obstacles = state.obstacles.filter((entry) => !sameCell(entry, cell));
  state.restricted = state.restricted.filter((entry) => !sameCell(entry, cell));
  if (mode !== "erase") state[mode === "obstacle" ? "obstacles" : "restricted"].push({ ...cell });
}

function assertEditable(state, cell) {
  if (state.walls.some((wall) => sameCell(wall, cell))) throw new Error("Permanent walls cannot be edited");
  if ([state.start, state.position, state.goal].some((protectedCell) => sameCell(protectedCell, cell))) {
    throw new Error("The start, goal, and robot's current cell are protected");
  }
}

function cellMode(state, cell) {
  if (state.obstacles.some((entry) => sameCell(entry, cell))) return "obstacle";
  if (state.restricted.some((entry) => sameCell(entry, cell))) return "restricted";
  return "open";
}

function isOpen(state, cell) {
  return ![...state.walls, ...state.restricted, ...state.obstacles].some((entry) => sameCell(entry, cell));
}

function isUnitMove(from, to) {
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y) === 1;
}

function validateCell(cell, state, label) {
  if (!record(cell) || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) ||
      cell.x < 0 || cell.y < 0 || cell.x >= state.width || cell.y >= state.height) {
    throw new TypeError(`${label} must have integer coordinates inside the grid`);
  }
}

function equalCells(left, right, ordered = false) {
  if (left.length !== right.length || left.some((cell) => !record(cell) || !Number.isInteger(cell.x) || !Number.isInteger(cell.y))) return false;
  return ordered ? left.every((cell, index) => sameCell(cell, right[index]))
    : [...left].map(cellKey).sort().join("|") === [...right].map(cellKey).sort().join("|");
}

function getScenario(id) {
  const scenario = SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) throw new RangeError(`Unknown route scenario: ${String(id)}`);
  return scenario;
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
