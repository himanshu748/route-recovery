const openings = [0, 2, 4, 6].map((y) => ({ x: 4, y }));

export const SCENARIOS = freeze([
  {
    id: "detour",
    name: "Blocked delivery route",
    description: "Block the direct corridor and watch the robot plan a legal detour.",
    width: 9, height: 7,
    start: { x: 1, y: 3 }, goal: { x: 7, y: 3 },
    walls: openings, restricted: [], obstacles: [],
    suggestedBlockage: { x: 4, y: 3 },
    suggestedEdit: { cell: { x: 4, y: 3 }, mode: "obstacle" }
  },
  {
    id: "restricted",
    name: "Restricted shortcut",
    description: "The shortest corridor is restricted. Block one detour to force another legal route.",
    width: 9, height: 7,
    start: { x: 1, y: 3 }, goal: { x: 7, y: 3 },
    walls: openings, restricted: [{ x: 4, y: 3 }], obstacles: [],
    suggestedBlockage: { x: 4, y: 5 },
    suggestedEdit: { cell: { x: 4, y: 5 }, mode: "obstacle" }
  },
  {
    id: "no-route",
    name: "Stop until the corridor clears",
    description: "The only crossing is blocked. Clear it to let the stopped robot resume.",
    width: 9, height: 7,
    start: { x: 1, y: 3 }, goal: { x: 7, y: 3 },
    walls: [0, 1, 2, 4, 5, 6].map((y) => ({ x: 4, y })),
    restricted: [], obstacles: [{ x: 4, y: 3 }],
    suggestedClearance: { x: 4, y: 3 },
    suggestedEdit: { cell: { x: 4, y: 3 }, mode: "erase" }
  }
]);

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
