'use strict';

/**
 * src/capability/delegate.js
 * AI-Delegation-Learning-Lab — AMO Research Series Lab 3
 *
 * Issues derived DelegatedGrantEvents with scope constraint enforcement.
 * Also provides cascadeRevoke() for recursive cascade revocation.
 *
 * Core thesis enforcement:
 *   (a) delegated grant must not exceed scope of parent grant
 *   (b) delegation_chain is built and embedded
 *   (c) delegated grant is independently revocable (revokeGrant handles this)
 *   (d) chain is verifiable via replayChain (chain.js + replayChain.js handle this)
 */

const { randomUUID }         = require('crypto');
const { VIOLATION_TYPES }    = require('../validator/rules');
const { buildChain,
        actionsAreSubset,
        isSubResource }      = require('./chain');
const { revokeGrant }        = require('./revoke');

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE CHECKER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * checkScope(parentEvent, params) → { ok: boolean, violation_type: string|null, detail: string|null }
 *
 * Validates that the requested delegation does not exceed the parent grant's scope.
 * Checks: actions subset, resource path, TTL, constraint strictness.
 */
function checkScope(parentEvent, { actions, resource, ttl_seconds, constraints = {} }) {
  const parent = parentEvent.capability;

  // 1. Actions must be subset of parent actions
  if (!actionsAreSubset(actions, parent.actions)) {
    const excess = actions.filter(a => !parent.actions.includes(a));
    return {
      ok:             false,
      violation_type: VIOLATION_TYPES.SCOPE_EXCEEDED,
      detail: `actions [${excess.join(', ')}] not present in parent grant [${parent.actions.join(', ')}]`,
    };
  }

  // 2. Resource must equal or be sub-path of parent resource
  if (!isSubResource(resource, parent.resource)) {
    return {
      ok:             false,
      violation_type: VIOLATION_TYPES.RESOURCE_MISMATCH,
      detail: `resource '${resource}' is not equal to or sub-path of parent '${parent.resource}'`,
    };
  }

  // 3. TTL must not exceed parent remaining TTL
  const parentExpiresAt   = new Date(parent.expires_at);
  const now               = new Date();
  const parentRemainingMs = parentExpiresAt - now;
  const requestedMs       = ttl_seconds * 1000;

  if (requestedMs > parentRemainingMs) {
    const parentRemainingS = Math.floor(parentRemainingMs / 1000);
    return {
      ok:             false,
      violation_type: VIOLATION_TYPES.TTL_EXCEEDED,
      detail: `requested ttl_seconds (${ttl_seconds}) exceeds parent remaining TTL (${parentRemainingS}s)`,
    };
  }

  // 4. Constraint values must be equal or stricter than parent
  //    Convention: for numeric constraints, delegate value must be ≤ parent value.
  //    Only checks keys present in parent constraints.
  const parentConstraints = parent.constraints || {};
  for (const [key, parentVal] of Object.entries(parentConstraints)) {
    if (key in constraints) {
      const childVal = constraints[key];
      if (typeof parentVal === 'number' && typeof childVal === 'number') {
        if (childVal > parentVal) {
          return {
            ok:             false,
            violation_type: VIOLATION_TYPES.CONSTRAINT_WEAKER,
            detail: `constraint '${key}': delegate value (${childVal}) exceeds parent value (${parentVal})`,
          };
        }
      }
    }
  }

  return { ok: true, violation_type: null, detail: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * delegateGrant(params) → DelegatedGrantEvent | DenialEvent
 *
 * Returns a DelegatedGrantEvent on success.
 * Returns a DenialEvent (state: 'denied') on scope violation — does NOT throw.
 * Does NOT write to ledger — caller appends.
 *
 * @param {object} params
 * @param {string} params.session_id
 * @param {string} params.parent_grant_id
 * @param {string} params.delegated_to
 * @param {string} params.resource
 * @param {string[]} params.actions
 * @param {number} params.ttl_seconds
 * @param {object} [params.constraints]
 * @param {string} params.justification
 * @param {Ledger} params.ledger             — needed to read parent grant
 */
function delegateGrant({
  session_id,
  parent_grant_id,
  delegated_to,
  resource,
  actions,
  ttl_seconds,
  constraints = {},
  justification,
  ledger,
}) {
  if (!session_id)       throw new TypeError('delegateGrant: session_id required');
  if (!parent_grant_id)  throw new TypeError('delegateGrant: parent_grant_id required');
  if (!delegated_to)     throw new TypeError('delegateGrant: delegated_to required');
  if (!resource)         throw new TypeError('delegateGrant: resource required');
  if (!Array.isArray(actions) || actions.length === 0)
    throw new TypeError('delegateGrant: actions must be non-empty array');
  if (!Number.isInteger(ttl_seconds) || ttl_seconds <= 0)
    throw new TypeError('delegateGrant: ttl_seconds must be positive integer');
  if (!justification)    throw new TypeError('delegateGrant: justification required');
  if (!ledger)           throw new TypeError('delegateGrant: ledger required');

  // Read parent grant from ledger
  const parentEvent = ledger.grantById(parent_grant_id);
  if (!parentEvent) {
    throw new Error(`delegateGrant: parent grant '${parent_grant_id}' not found in ledger`);
  }

  // Verify parent is not already revoked
  if (ledger.isRevoked(parent_grant_id)) {
    const now = new Date().toISOString();
    return _buildDenialEvent({
      session_id,
      attempted_capability: { resource, actions, ttl_seconds, constraints },
      denial_reason:        `parent grant '${parent_grant_id}' has been revoked`,
      violation_type:       VIOLATION_TYPES.SCOPE_EXCEEDED,
      parent_grant_id,
      timestamp: now,
    });
  }

  // Scope check
  const scopeCheck = checkScope(parentEvent, { actions, resource, ttl_seconds, constraints });

  if (!scopeCheck.ok) {
    return _buildDenialEvent({
      session_id,
      attempted_capability: { resource, actions, ttl_seconds, constraints },
      denial_reason:        scopeCheck.detail,
      violation_type:       scopeCheck.violation_type,
      parent_grant_id,
      timestamp:            new Date().toISOString(),
    });
  }

  // Build the new grant
  const now        = new Date();
  const expires_at = new Date(now.getTime() + ttl_seconds * 1000).toISOString();
  const newGrantId = randomUUID();

  const chain = buildChain({
    parent_event:  parentEvent,
    new_grant_id:  newGrantId,
    new_principal: delegated_to,
    new_actions:   actions,
    new_resource:  resource,
    issued_at:     now.toISOString(),
  });

  const depth = parentEvent.delegation_context
    ? parentEvent.delegation_context.depth + 1
    : 1;

  return {
    event_id:   randomUUID(),
    event_type: 'capability.delegated',
    session_id,
    timestamp:  now.toISOString(),
    state:      'delegated',
    capability: {
      id:          newGrantId,
      resource,
      actions:     [...actions],
      ttl_seconds,
      expires_at,
      constraints: { ...constraints },
    },
    provenance: {
      requestor_id:  parentEvent.provenance.requestor_id,
      justification,
      requested_at:  now.toISOString(),
    },
    delegation_context: {
      parent_grant_id,
      delegated_to,
      delegation_chain: chain,
      depth,
    },
  };
}

/**
 * cascadeRevoke(params) → RevocationEvent[]
 *
 * Finds all delegated grants derived from parent_grant_id.
 * Issues RevocationEvent for each with cascade_of set.
 * Recursive: if a revoked delegate was itself a delegator, cascades further.
 * Returns flat array of all RevocationEvents — caller appends to ledger.
 *
 * @param {object} params
 * @param {string} params.session_id
 * @param {string} params.parent_grant_id
 * @param {string} params.revoked_by
 * @param {string} params.reason
 * @param {Ledger} params.ledger
 * @returns {RevocationEvent[]}
 */
function cascadeRevoke({
  session_id,
  parent_grant_id,
  revoked_by,
  reason,
  ledger,
}) {
  const results = [];

  const directChildren = ledger.allDelegatesOf(parent_grant_id);

  for (const child of directChildren) {
    const childId = child.capability.id;

    // Skip already-revoked children (idempotent)
    if (ledger.isRevoked(childId)) continue;

    const revocationEvent = revokeGrant({
      session_id,
      capability_id: childId,
      revoked_by,
      reason:        `${reason} [cascade from ${parent_grant_id}]`,
      cascade_of:    parent_grant_id,
    });
    results.push(revocationEvent);

    // Recurse: if this child has its own delegates, cascade further
    const grandchildren = cascadeRevoke({
      session_id,
      parent_grant_id: childId,
      revoked_by,
      reason,
      ledger,
    });
    results.push(...grandchildren);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _buildDenialEvent({
  session_id,
  attempted_capability,
  denial_reason,
  violation_type,
  parent_grant_id,
  timestamp,
}) {
  return {
    event_id:             randomUUID(),
    event_type:           'capability.denied',
    session_id,
    timestamp,
    state:                'denied',
    attempted_capability,
    denial_reason,
    violation_type,
    parent_grant_id,
  };
}

module.exports = { delegateGrant, cascadeRevoke, checkScope };
