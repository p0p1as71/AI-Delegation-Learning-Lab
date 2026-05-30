'use strict';

/**
 * src/ledger/replay.js
 * Reused from AI-MCP-Learning-Lab — no modifications.
 *
 * Replays a single capability's events and verifies state machine transitions.
 * Used internally by replayChain.js for per-capability validation.
 */

const { isValidTransition } = require('../validator/rules');
const { byCapabilityId } = require('./query');

/**
 * replayCapability(store, sessionId, capabilityId) → {
 *   ok:            boolean,
 *   capability_id: string,
 *   transitions:   TransitionRecord[],
 *   violations:    string[],
 * }
 *
 * @typedef {Object} TransitionRecord
 * { from: string | null, to: string, event_id: string, event_type: string, valid: boolean }
 */
function replayCapability(store, sessionId, capabilityId) {
  const events = byCapabilityId(store, sessionId, capabilityId);
  const violations = [];
  const transitions = [];

  let currentState = null;

  for (const event of events) {
    const nextState = event.state;

    if (currentState === null) {
      // First event — no transition to validate, just record
      transitions.push({
        from:       null,
        to:         nextState,
        event_id:   event.event_id,
        event_type: event.event_type,
        valid:      true,
      });
    } else {
      const valid = isValidTransition(currentState, nextState);
      transitions.push({
        from:       currentState,
        to:         nextState,
        event_id:   event.event_id,
        event_type: event.event_type,
        valid,
      });
      if (!valid) {
        violations.push(
          `capability ${capabilityId}: invalid transition ${currentState} → ${nextState} (event ${event.event_id})`
        );
      }
    }

    currentState = nextState;
  }

  return {
    ok:            violations.length === 0,
    capability_id: capabilityId,
    transitions,
    violations,
  };
}

module.exports = { replayCapability };
