'use strict';

/**
 * src/runtime/delegation-bridge.js
 * AI-Delegation-Learning-Lab — AMO Research Series Lab 3
 *
 * ADR-005: Bridge is adapter, not governor.
 * The bridge enforces that a valid, non-revoked, non-expired delegated capability
 * exists before executing the tool. It does not make governance decisions —
 * governance was already decided at grant/delegate time.
 *
 * Throws CapabilityViolationError on any check failure (not a DenialEvent).
 * Returns ExecutionEvent — caller appends to ledger.
 */

const { randomUUID } = require('crypto');

class CapabilityViolationError extends Error {
  constructor(message, { capability_id, reason } = {}) {
    super(message);
    this.name         = 'CapabilityViolationError';
    this.capability_id = capability_id;
    this.reason       = reason;
  }
}

// Mock tool registry — in a real runtime, this would dispatch to MCP tools
const MOCK_TOOLS = {
  filesystem_write: ({ path, content }) => ({
    success: true,
    path,
    bytes_written: Buffer.byteLength(content || '', 'utf8'),
  }),
  filesystem_read: ({ path }) => ({
    success: true,
    path,
    content: `[mock content of ${path}]`,
    bytes_read: 42,
  }),
  filesystem_delete: ({ path }) => ({
    success: true,
    path,
    deleted: true,
  }),
};

/**
 * runDelegatedTool(params) → ExecutionEvent
 *
 * @param {object} params
 * @param {string} params.session_id
 * @param {string} params.capability_id    — the DELEGATED grant id (not root)
 * @param {string} params.executor_id
 * @param {string} params.tool_name
 * @param {object} params.arguments
 * @param {Ledger} params.ledger
 * @returns {ExecutionEvent}
 * @throws {CapabilityViolationError}
 */
function runDelegatedTool({
  session_id,
  capability_id,
  executor_id,
  tool_name,
  arguments: toolArgs,
  ledger,
}) {
  if (!session_id)    throw new TypeError('runDelegatedTool: session_id required');
  if (!capability_id) throw new TypeError('runDelegatedTool: capability_id required');
  if (!executor_id)   throw new TypeError('runDelegatedTool: executor_id required');
  if (!tool_name)     throw new TypeError('runDelegatedTool: tool_name required');
  if (!ledger)        throw new TypeError('runDelegatedTool: ledger required');

  // ── Check 1: capability must exist and be a delegated grant ─────────────
  const grantEvent = ledger.grantById(capability_id);
  if (!grantEvent) {
    throw new CapabilityViolationError(
      `capability '${capability_id}' not found in ledger`,
      { capability_id, reason: 'not_found' }
    );
  }
  if (grantEvent.event_type !== 'capability.delegated') {
    throw new CapabilityViolationError(
      `capability '${capability_id}' is not a delegated grant (found: ${grantEvent.event_type})`,
      { capability_id, reason: 'not_delegated' }
    );
  }

  // ── Check 2: capability must not be revoked ──────────────────────────────
  if (ledger.isRevoked(capability_id)) {
    throw new CapabilityViolationError(
      `capability '${capability_id}' has been revoked`,
      { capability_id, reason: 'revoked' }
    );
  }

  // ── Check 3: capability must not be expired ──────────────────────────────
  const expiresAt = new Date(grantEvent.capability.expires_at);
  if (new Date() > expiresAt) {
    throw new CapabilityViolationError(
      `capability '${capability_id}' expired at ${grantEvent.capability.expires_at}`,
      { capability_id, reason: 'expired' }
    );
  }

  // ── Check 4: tool_name must map to an action in the grant ────────────────
  // Convention: tool names follow the pattern <resource_type>_<action>
  // e.g. filesystem_write → action 'write'
  const toolAction = _resolveAction(tool_name, grantEvent.capability.resource);
  if (!grantEvent.capability.actions.includes(toolAction)) {
    throw new CapabilityViolationError(
      `tool '${tool_name}' requires action '${toolAction}' which is not in delegated grant [${grantEvent.capability.actions.join(', ')}]`,
      { capability_id, reason: 'action_not_permitted' }
    );
  }

  // ── Check 5: executor_id must match delegated_to ─────────────────────────
  const delegatedTo = grantEvent.delegation_context.delegated_to;
  if (executor_id !== delegatedTo) {
    throw new CapabilityViolationError(
      `executor '${executor_id}' is not the grantee of capability '${capability_id}' (expected '${delegatedTo}')`,
      { capability_id, reason: 'identity_mismatch' }
    );
  }

  // ── Execute tool (mock) ───────────────────────────────────────────────────
  const toolFn = MOCK_TOOLS[tool_name];
  const result = toolFn
    ? toolFn(toolArgs || {})
    : { success: true, mock: true, tool_name, arguments: toolArgs };

  // ── Build execution event ─────────────────────────────────────────────────
  return {
    event_id:   randomUUID(),
    event_type: 'capability.executed',
    session_id,
    timestamp:  new Date().toISOString(),
    state:      'completed',
    capability_id,
    executor_id,
    tool_call: {
      tool_name,
      arguments: toolArgs || {},
      result,
    },
    delegation_context: {
      parent_grant_id:  grantEvent.delegation_context.parent_grant_id,
      delegation_chain: grantEvent.delegation_context.delegation_chain,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _resolveAction(tool_name, resource) → string
 *
 * Derives the required action from the tool name.
 * Convention: <prefix>_<action> where prefix matches resource type.
 *
 * Examples:
 *   filesystem_write  → 'write'
 *   filesystem_read   → 'read'
 *   filesystem_delete → 'delete'
 *   github_push       → 'push'
 */
function _resolveAction(toolName, resource) {
  const parts = toolName.split('_');
  // Last segment is the action
  return parts[parts.length - 1];
}

module.exports = { runDelegatedTool, CapabilityViolationError };
