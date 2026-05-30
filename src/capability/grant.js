'use strict';

/**
 * src/capability/grant.js
 * AI-Delegation-Learning-Lab — AMO Research Series Lab 3
 *
 * Issues root GrantEvents with delegation_context = null.
 * Does NOT write to ledger — caller appends.
 * Pattern reused from AI-MCP-Learning-Lab.
 */

const { randomUUID } = require('crypto');

/**
 * issueGrant(params) → GrantEvent
 *
 * @param {object} params
 * @param {string} params.session_id
 * @param {string} params.requestor_id
 * @param {string} params.resource
 * @param {string[]} params.actions
 * @param {number} params.ttl_seconds
 * @param {object} [params.constraints]
 * @param {string} params.justification
 * @returns {GrantEvent}
 */
function issueGrant({
  session_id,
  requestor_id,
  resource,
  actions,
  ttl_seconds,
  constraints = {},
  justification,
}) {
  if (!session_id)    throw new TypeError('issueGrant: session_id required');
  if (!requestor_id)  throw new TypeError('issueGrant: requestor_id required');
  if (!resource)      throw new TypeError('issueGrant: resource required');
  if (!Array.isArray(actions) || actions.length === 0)
    throw new TypeError('issueGrant: actions must be non-empty array');
  if (!Number.isInteger(ttl_seconds) || ttl_seconds <= 0)
    throw new TypeError('issueGrant: ttl_seconds must be positive integer');
  if (!justification) throw new TypeError('issueGrant: justification required');

  const now        = new Date();
  const expires_at = new Date(now.getTime() + ttl_seconds * 1000).toISOString();

  return {
    event_id:   randomUUID(),
    event_type: 'capability.granted',
    session_id,
    timestamp:  now.toISOString(),
    state:      'granted',
    capability: {
      id:          randomUUID(),
      resource,
      actions:     [...actions],
      ttl_seconds,
      expires_at,
      constraints: { ...constraints },
    },
    provenance: {
      requestor_id,
      justification,
      requested_at: now.toISOString(),
    },
    delegation_context: null,
  };
}

module.exports = { issueGrant };
