import { createHash } from 'node:crypto';
import { exportEvidence, stepSimulation } from './core.js';

export const ACTIONS = ['follow_validated_route', 'hold_position', 'request_operator_clearance'];
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = (value) => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');

export function auditedState(state) {
  if (Buffer.byteLength(JSON.stringify(state) ?? '') > 48 * 1024) throw new Error('State exceeds the 48 KiB recovery limit. Reset to start a shorter mission.');
  exportEvidence(state);
  return structuredClone(state);
}

export function validateDecision(value, state) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'action,reason,stateSha256' ||
      value.stateSha256 !== sha256(state) || !ACTIONS.includes(value.action) ||
      typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1200) {
    throw new Error('Recovery decision is invalid or does not match this exact state. Request a new decision.');
  }
  if (state.status === 'complete') throw new Error('This delivery is already complete.');
  if (value.action === 'follow_validated_route' && (state.status === 'blocked' || state.route.length < 2)) {
    throw new Error('Recovery decision requested movement without a permitted route.');
  }
  return structuredClone(value);
}

// The model chooses whether to advance, wait, or ask for clearance. It cannot
// supply coordinates, clear cells, alter BFS, or declare a delivery complete.
export function runRecovery(initial, decision) {
  let state = auditedState(initial);
  if (decision) validateDecision(decision, state);
  const action = decision?.action ?? 'follow_validated_route';
  if (action === 'follow_validated_route') {
    for (let step = 0; step < state.width * state.height; step++) {
      if (state.status === 'complete' || state.status === 'blocked') break;
      state = stepSimulation(state);
    }
    if (state.status !== 'complete' && state.status !== 'blocked') throw new Error('Bounded simulation did not terminate.');
  }
  return { state, evidence: exportEvidence(state), action, movesExecuted: state.moves - initial.moves };
}

export function evaluateJob(input) {
  const { bundleId, state, decision, inference } = input;
  if (typeof bundleId !== 'string') throw new Error('Job requires a bundle identity.');
  if (decision && inference?.outputSha256 !== sha256(decision)) throw new Error('Job decision differs from the recorded model output.');
  const baseline = runRecovery(state);
  const selected = runRecovery(state, decision);
  return {
    schemaVersion: 1, kind: 'route-job-result', bundleId, inputSha256: sha256(input),
    simulation: 'deterministic-2d-grid', physicalHardware: false, physicsSimulated: false,
    inferenceLocation: decision ? 'desk-runtime-before-job' : 'none',
    inference: decision ? inference : null,
    modelDecisionApplied: Boolean(decision), action: selected.action,
    baseline: baseline.evidence, selected: selected.evidence,
    finalState: selected.state,
  };
}
