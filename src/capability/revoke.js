'use strict';

/**
 * src/capability/revoke.js
 * AI-Delegation-Learning-Lab — AMO Research Series Lab 3
 *
 * Issues RevocationEvents. Does NOT cascade — cascade is orchestrated by delegate.js.
 * Does NOT write to ledger — caller appends.
 * Pattern reused from AI-MCP-Learning-Lab.
 */

const { randomUUID } = require('crypto');

/**
 * revokeGrant(params) → RevocationEvent
 *
 * @param {object} params
 * @param {string} params.session_id
 * @param {string} params.capability_id
 * @param {string} params.revoked_by
 * @param {string} params.reason
 * @param {string|null} [params.cascade_of]  — parent capability_id if this is a cascade revoke
 * @returns {RevocationEvent}
 */
function revokeGrant({
  session_id,
  capability_id,
  revoked_by,
  reason,
  cascade_of = null,
}) {
  if (!session_id)    throw new TypeError('revokeGrant: session_id required');
  if (!capability_id) throw new TypeError('revokeGrant: capability_id required');
  if (!revoked_by)    throw new TypeError('revokeGrant: revoked_by required');
  if (!reason)        throw new TypeError('revokeGrant: reason required');

  return {
    event_id:      randomUUID(),
    event_type:    'capability.revoked',
    session_id,
    timestamp:     new Date().toISOString(),
    state:         'revoked',
    capability_id,
    revoked_by,
    reason,
    cascade_of:    cascade_of || null,
  };
}

module.exports = { revokeGrant };
