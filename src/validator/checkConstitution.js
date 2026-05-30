'use strict';

/**
 * src/validator/checkConstitution.js
 * AI-Delegation-Learning-Lab — AMO Research Series Lab 3
 *
 * Boot-time validator. Runs once before any runtime execution.
 * Validates the state machine definition itself — not event instances.
 * Throws if ok === false (halts boot).
 *
 * Checks:
 *   1. All STATES values are represented as keys in TRANSITIONS
 *   2. All TRANSITIONS keys are members of STATES values
 *   3. Terminal states have no outgoing transitions (empty Set)
 *   4. Non-terminal states have at least one valid outgoing transition
 *   5. No self-loops (from === to) in any transition set
 *   6. All transition targets are members of STATES values
 *   7. EVENT_STATE_MAP values are all members of STATES
 *   8. Every event_type in EVENT_STATE_MAP has a REQUIRED_FIELDS entry
 */

const {
  STATES,
  TRANSITIONS,
  TERMINAL_STATES,
  EVENT_STATE_MAP,
  REQUIRED_FIELDS,
} = require('./rules');

/**
 * checkConstitution() → { ok: boolean, violations: string[] }
 *
 * Returns { ok: true, violations: [] } if state machine is well-formed.
 * Returns { ok: false, violations: [...] } listing all structural defects.
 * Throws if ok === false — callers should treat this as a fatal boot error.
 */
function checkConstitution() {
  const violations = [];
  const stateValues = new Set(Object.values(STATES));

  // ── Check 1: STATES values ↔ TRANSITIONS keys are in 1:1 correspondence ──
  for (const state of stateValues) {
    if (!TRANSITIONS.has(state)) {
      violations.push(`TRANSITIONS: missing key for state '${state}'`);
    }
  }
  for (const [from] of TRANSITIONS) {
    if (!stateValues.has(from)) {
      violations.push(`TRANSITIONS: key '${from}' is not a member of STATES`);
    }
  }

  // ── Check 2 + 3 + 4 + 5 + 6 ─────────────────────────────────────────────
  for (const [from, targets] of TRANSITIONS) {
    const isTerminal = TERMINAL_STATES.has(from);

    // Check 3: terminal states have no outgoing transitions
    if (isTerminal && targets.size > 0) {
      const listed = Array.from(targets).join(', ');
      violations.push(
        `TRANSITIONS: terminal state '${from}' must have no transitions, found: [${listed}]`
      );
    }

    // Check 4: non-terminal states have at least one outgoing transition
    if (!isTerminal && targets.size === 0) {
      violations.push(
        `TRANSITIONS: non-terminal state '${from}' has no outgoing transitions`
      );
    }

    for (const to of targets) {
      // Check 5: no self-loops
      if (from === to) {
        violations.push(`TRANSITIONS: self-loop detected on state '${from}'`);
      }

      // Check 6: all transition targets are valid states
      if (!stateValues.has(to)) {
        violations.push(
          `TRANSITIONS: target '${to}' from '${from}' is not a member of STATES`
        );
      }
    }
  }

  // ── Check 7: EVENT_STATE_MAP values are all valid states ─────────────────
  for (const [eventType, state] of Object.entries(EVENT_STATE_MAP)) {
    if (!stateValues.has(state)) {
      violations.push(
        `EVENT_STATE_MAP: event_type '${eventType}' maps to unknown state '${state}'`
      );
    }
  }

  // ── Check 8: every event_type in EVENT_STATE_MAP has REQUIRED_FIELDS entry ─
  for (const eventType of Object.keys(EVENT_STATE_MAP)) {
    if (!(eventType in REQUIRED_FIELDS)) {
      violations.push(
        `REQUIRED_FIELDS: missing entry for event_type '${eventType}'`
      );
    }
  }

  const ok = violations.length === 0;

  if (!ok) {
    const msg = [
      '[checkConstitution] State machine constitution FAILED:',
      ...violations.map(v => `  - ${v}`),
    ].join('\n');
    throw new Error(msg);
  }

  return { ok: true, violations: [] };
}

module.exports = { checkConstitution };
