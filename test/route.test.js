import test from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS } from "../src/route/scenarios.js";
import { createSimulation, planRoute, stepSimulation, editCell, exportEvidence } from "../src/route/core.js";

function complete(state) {
  for (let step = 0; step < state.width * state.height; step++) {
    if (state.status === "complete" || state.status === "blocked") return state;
    const before = state.position;
    state = stepSimulation(state);
    assert.equal(Math.abs(before.x - state.position.x) + Math.abs(before.y - state.position.y), 1);
  }
  assert.fail("Route did not terminate within its bounded grid");
}

test("three bounded scenarios and shortest direct BFS route are deterministic", () => {
  assert.deepEqual(SCENARIOS.map((scenario) => scenario.id), ["detour", "restricted", "no-route"]);
  const state = createSimulation("detour");
  assert.equal(state.status, "ready");
  assert.equal(state.route.length, 7);
  assert.deepEqual(planRoute(state), Array.from({ length: 7 }, (_, index) => ({ x: index + 1, y: 3 })));
  assert.deepEqual(createSimulation("detour"), state);
});

test("a newly blocked active route replans from the robot's current position", () => {
  const moving = stepSimulation(createSimulation("detour"));
  const state = editCell(moving, { x: 4, y: 3 }, "obstacle");
  assert.deepEqual(state.position, { x: 2, y: 3 });
  assert.equal(state.moves, 1);
  assert.equal(state.replans, 1);
  assert.ok(state.route.length > moving.route.length);
  assert.ok(state.route.every((cell) => cell.x !== 4 || cell.y !== 3));
  const finished = complete(state);
  const evidence = exportEvidence(finished);
  assert.equal(evidence.complete, true);
  assert.equal(evidence.moves, 10);
  assert.equal(evidence.constraintViolations, 0);
  assert.equal(evidence.modelUsed, false);
  assert.equal(evidence.physicalHardware, false);
  assert.equal(evidence.physicsSimulated, false);
  assert.deepEqual(evidence.initialMap, {
    width: 9, height: 7, walls: SCENARIOS[0].walls, restricted: [], obstacles: []
  });
  assert.deepEqual(evidence.finalMap, {
    width: 9, height: 7, walls: SCENARIOS[0].walls, restricted: [], obstacles: [{ x: 4, y: 3 }]
  });
  assert.notEqual(evidence.initialMap.walls, SCENARIOS[0].walls);
  assert.notEqual(evidence.finalMap.obstacles, finished.obstacles);
});

test("restricted shortcuts are never traversed, including after a second detour", () => {
  let state = createSimulation("restricted");
  assert.equal(state.route.length, 11);
  state = editCell(state, { x: 4, y: 5 }, "obstacle");
  assert.ok(state.route.some((cell) => cell.x === 4 && cell.y === 1));
  const evidence = exportEvidence(complete(state));
  assert.equal(evidence.complete, true);
  assert.ok(evidence.traveledPath.every((cell) => cell.x !== 4 || (cell.y !== 3 && cell.y !== 5)));
});

test("no-route stops without motion and clearing the obstacle resumes planning", () => {
  const blocked = createSimulation("no-route");
  assert.equal(blocked.status, "blocked");
  assert.equal(planRoute(blocked), null);
  assert.equal(stepSimulation(blocked), blocked);
  assert.equal(blocked.moves, 0);
  assert.ok(blocked.events.some((event) => event.type === "blocked_stop"));
  assert.equal(exportEvidence(blocked).complete, false);
  const resumed = editCell(blocked, { x: 4, y: 3 }, "erase");
  assert.equal(resumed.status, "ready");
  assert.deepEqual(resumed.position, blocked.position);
  assert.equal(resumed.replans, 1);
  assert.equal(exportEvidence(complete(resumed)).moves, 6);
});

test("goal completion occurs once and later steps cannot move the robot", () => {
  const finished = complete(createSimulation("detour"));
  assert.equal(finished.moves, 6);
  assert.deepEqual(finished.position, finished.goal);
  assert.deepEqual(finished.route, [finished.goal]);
  assert.equal(finished.events.filter((event) => event.type === "complete").length, 1);
  assert.equal(stepSimulation(finished), finished);
  assert.equal(exportEvidence(finished).complete, true);
});

test("completed missions reject all edits until reset and preserve their final evidence", () => {
  const finished = complete(createSimulation("detour"));
  const before = exportEvidence(finished);
  for (const mode of ["obstacle", "restricted", "erase"]) {
    assert.throws(() => editCell(finished, { x: 0, y: 0 }, mode), /Reset before editing a completed mission/);
  }
  assert.deepEqual(exportEvidence(finished), before);
  assert.equal(editCell(createSimulation("detour"), { x: 0, y: 0 }, "obstacle").obstacles.length, 1);
});

test("state, scenario metadata, and evidence are immutable; planning returns independent cells", () => {
  const initial = createSimulation("detour");
  const snapshot = JSON.stringify(initial);
  const planned = planRoute(initial);
  planned[0].x = 8;
  const moved = stepSimulation(initial);
  const edited = editCell(moved, { x: 4, y: 3 }, "restricted");
  assert.equal(JSON.stringify(initial), snapshot);
  assert.deepEqual(moved.position, { x: 2, y: 3 });
  assert.equal(moved.restricted.length, 0);
  assert.equal(edited.restricted.length, 1);
  assert.throws(() => { initial.position.x = 8; }, TypeError);
  assert.throws(() => { SCENARIOS[0].walls.push({ x: 0, y: 0 }); }, TypeError);
  const evidence = exportEvidence(edited);
  assert.throws(() => { evidence.events[0].details.message = "changed"; }, TypeError);
});

test("edits protect structural cells and reject invalid coordinates and modes", () => {
  const state = stepSimulation(createSimulation("detour"));
  for (const cell of [state.start, state.position, state.goal, state.walls[0]]) {
    for (const mode of ["obstacle", "restricted", "erase"]) assert.throws(() => editCell(state, cell, mode), /protected|walls/);
  }
  for (const cell of [null, [], {}, { x: -1, y: 0 }, { x: 9, y: 0 }, { x: 1.5, y: 2 }, { x: "1", y: 2 }]) {
    assert.throws(() => editCell(state, cell, "obstacle"), /coordinates/);
  }
  assert.throws(() => editCell(state, { x: 0, y: 0 }, "wall"), /Edit mode/);
  assert.throws(() => createSimulation("missing"), /Unknown route scenario/);
  assert.equal(editCell(state, { x: 0, y: 0 }, "erase"), state);
});

test("malformed state cannot bypass legal unit moves or completion constraints", () => {
  const state = createSimulation("detour");
  for (const invalid of [null, [], { ...state, width: 1000000 }, { ...state, moves: -1 },
    { ...state, status: "complete" }, { ...state, walls: [] },
    { ...state, route: [state.position, state.goal] },
    { ...state, obstacles: [{ x: 2, y: 3 }] },
    { ...state, restricted: [{ x: 0, y: 0 }], obstacles: [{ x: 0, y: 0 }] }]) {
    assert.throws(() => stepSimulation(invalid));
  }
});

test("evidence export detects tampered counts, completion labels, and historical routes", () => {
  const finished = complete(createSimulation("detour"));
  assert.throws(() => exportEvidence({ ...finished, moves: 1 }), /history/);
  assert.throws(() => exportEvidence({ ...finished, constraintViolations: 1 }), /history/);
  const illegalHistory = structuredClone(finished);
  const move = illegalHistory.events.find((event) => event.type === "moved");
  move.details.to = { x: 4, y: 4 };
  assert.throws(() => exportEvidence(illegalHistory), /Historical move/);
  const missingCompletion = structuredClone(finished);
  missingCompletion.events.pop();
  assert.throws(() => exportEvidence(missingCompletion), /history/);
  assert.throws(() => exportEvidence({ ...createSimulation("detour"), status: "complete" }), /Completion/);
});

test("evidence requires an explicit blocked stop and a replan immediately after an edit", () => {
  const missingStop = structuredClone(createSimulation("no-route"));
  missingStop.events.pop();
  assert.throws(() => exportEvidence(missingStop), /history/);
  const missingReplan = structuredClone(editCell(createSimulation("detour"), { x: 4, y: 3 }, "obstacle"));
  missingReplan.events.pop();
  assert.throws(() => exportEvidence(missingReplan), /history/);
});
