'use strict';

/**
 * src/validator/rules.js
 * AI-Delegation-Learning-Lab — AMO Research Series Lab 3
 *
 * State machine definition for the delegation lifecycle.
 * No runtime dependencies. Pure constants + pure functions.
 *
 * State machine:
 *   requested → evaluated → granted → delegated → active → completed
 *                         ↓          ↓                      (terminal)
 *                        denied     denied (scope violation)
 *                       (terminal)
 *   Any non-terminal state → revoked (terminal)
 */

// ─────────────────────────────────────────────────────────────────────────────
// STATES
// ─────────────────────────────────────────────────────────────────────────────

const STATES = Object.freeze({
  REQUESTED:  'requested',
  EVALUATED:  'evaluated',
  GRANTED:    'granted',
  DELEGATED:  'delegated',
  ACTIVE:     'active',
  COMPLETED:  'completed',
  REVOKED:    'revoked',
  DENIED:     'denied',
});

// Terminal states: no outgoing transitions permitted
const TERMINAL_STATES = Object.freeze(new Set([
  STATES.COMPLETED,
  STATES.REVOKED,
  STATES.DENIED,
]));

// ─────────────────────────────────────────────────────────────────────────────
// TRANSITIONS
// Map<fromState, Set<toState>>
// ─────────────────────────────────────────────────────────────────────────────

const TRANSITIONS = Object.freeze(new Map([
  [STATES.REQUESTED,  new Set([STATES.EVALUATED])],
  [STATES.EVALUATED,  new Set([STATES.GRANTED,   STATES.DENIED])],
  [STATES.GRANTED,    new Set([STATES.DELEGATED, STATES.ACTIVE,  STATES.REVOKED])],
  [STATES.DELEGATED,  new Set([STATES.ACTIVE,    STATES.DENIED,  STATES.REVOKED])],
  [STATES.ACTIVE,     new Set([STATES.COMPLETED, STATES.REVOKED])],
  // Terminal states: empty sets (no outgoing transitions)
  [STATES.COMPLETED,  new Set()],
  [STATES.REVOKED,    new Set()],
  [STATES.DENIED,     new Set()],
]));

// ─────────────────────────────────────────────────────────────────────────────
// EVENT TYPE → EXPECTED RESULTING STATE
// Canonical mapping: every event_type implies exactly one resulting state.
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_STATE_MAP = Object.freeze({
  'capability.granted':   STATES.GRANTED,
  'capability.delegated': STATES.DELEGATED,
  'capability.executed':  STATES.COMPLETED,
  'capability.revoked':   STATES.REVOKED,
  'capability.denied':    STATES.DENIED,
});

// ─────────────────────────────────────────────────────────────────────────────
// VIOLATION TYPES (scope check results from delegate.js)
// ─────────────────────────────────────────────────────────────────────────────

const VIOLATION_TYPES = Object.freeze({
  SCOPE_EXCEEDED:    'scope_exceeded',    // actions not subset of parent
  TTL_EXCEEDED:      'ttl_exceeded',      // ttl_seconds > parent remaining TTL
  RESOURCE_MISMATCH: 'resource_mismatch', // resource not equal/sub-path of parent
  CONSTRAINT_WEAKER: 'constraint_weaker', // constraints less restrictive than parent
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIRED FIELDS per event_type
// Used by validateCapability.js — centralized here to avoid duplication.
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_FIELDS = Object.freeze({
  common: [
    'event_id',
    'event_type',
    'session_id',
    'timestamp',
    'state',
  ],
  'capability.granted': [
    'capability',
    'provenance',
    'delegation_context',   // must be null
  ],
  'capability.delegated': [
    'capability',
    'provenance',
    'delegation_context',   // must be non-null object
  ],
  'capability.executed': [
    'capability_id',
    'executor_id',
    'tool_call',
    'delegation_context',
  ],
  'capability.revoked': [
    'capability_id',
    'revoked_by',
    'reason',
    'cascade_of',           // null or string
  ],
  'capability.denied': [
    'attempted_capability',
    'denial_reason',
    'violation_type',
    'parent_grant_id',
  ],
});

const REQUIRED_CAPABILITY_FIELDS = Object.freeze([
  'id',
  'resource',
  'actions',
  'ttl_seconds',
  'expires_at',
]);

const REQUIRED_DELEGATION_CONTEXT_FIELDS = Object.freeze([
  'parent_grant_id',
  'delegated_to',
  'delegation_chain',
  'depth',
]);

// ─────────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * isValidTransition(from, to) → boolean
 * Returns true iff the transition from→to is registered in TRANSITIONS.
 */
function isValidTransition(from, to) {
  const targets = TRANSITIONS.get(from);
  if (!targets) return false;
  return targets.has(to);
}

/**
 * isTerminalState(state) → boolean
 */
function isTerminalState(state) {
  return TERMINAL_STATES.has(state);
}

/**
 * stateForEventType(event_type) → string | undefined
 * Returns the expected state for a given event_type.
 */
function stateForEventType(eventType) {
  return EVENT_STATE_MAP[eventType];
}

/**
 * requiredFieldsFor(event_type) → string[]
 * Returns merged array of common + event-type-specific required fields.
 */
function requiredFieldsFor(eventType) {
  const specific = REQUIRED_FIELDS[eventType] || [];
  return [...REQUIRED_FIELDS.common, ...specific];
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  STATES,
  TERMINAL_STATES,
  TRANSITIONS,
  EVENT_STATE_MAP,
  VIOLATION_TYPES,
  REQUIRED_FIELDS,
  REQUIRED_CAPABILITY_FIELDS,
  REQUIRED_DELEGATION_CONTEXT_FIELDS,
  isValidTransition,
  isTerminalState,
  stateForEventType,
  requiredFieldsFor,
};
