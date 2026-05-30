'use strict';

/**
 * src/validator/validateCapability.js
 * AI-Delegation-Learning-Lab — AMO Research Series Lab 3
 *
 * Validates structure and state machine compliance of any capability event.
 * Does NOT enforce scope constraints against parent — that is chain.js concern.
 * Does NOT write to ledger — pure validation function.
 */

const {
  STATES,
  EVENT_STATE_MAP,
  REQUIRED_CAPABILITY_FIELDS,
  REQUIRED_DELEGATION_CONTEXT_FIELDS,
  isValidTransition,
  stateForEventType,
  requiredFieldsFor,
} = require('./rules');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isISOTimestamp(v) {
  if (!isNonEmptyString(v)) return false;
  const d = new Date(v);
  return !isNaN(d.getTime());
}

function isFutureTimestamp(v) {
  if (!isISOTimestamp(v)) return false;
  return new Date(v) > new Date();
}

function isNonEmptyArray(v) {
  return Array.isArray(v) && v.length > 0;
}

function isPositiveInteger(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-VALIDATORS
// ─────────────────────────────────────────────────────────────────────────────

function validateCommonFields(event, errors) {
  const required = requiredFieldsFor(event.event_type);

  // Common fields always present
  if (!isNonEmptyString(event.event_id))
    errors.push('event_id: must be non-empty string');

  if (!isNonEmptyString(event.event_type) || !(event.event_type in EVENT_STATE_MAP))
    errors.push(`event_type: unknown value '${event.event_type}'`);

  if (!isNonEmptyString(event.session_id))
    errors.push('session_id: must be non-empty string');

  if (!isISOTimestamp(event.timestamp))
    errors.push('timestamp: must be valid ISO-8601 string');

  if (!isNonEmptyString(event.state) || !Object.values(STATES).includes(event.state))
    errors.push(`state: unknown value '${event.state}'`);

  // event_type → state consistency
  const expectedState = stateForEventType(event.event_type);
  if (expectedState && event.state !== expectedState)
    errors.push(`state: event_type '${event.event_type}' requires state '${expectedState}', got '${event.state}'`);

  // Check all required fields exist (structural presence)
  for (const field of required) {
    if (!(field in event))
      errors.push(`${field}: required field missing`);
  }
}

function validateCapabilityObject(cap, errors) {
  if (!cap || typeof cap !== 'object') {
    errors.push('capability: must be an object');
    return;
  }

  for (const field of REQUIRED_CAPABILITY_FIELDS) {
    if (!(field in cap))
      errors.push(`capability.${field}: required field missing`);
  }

  if (!isNonEmptyString(cap.id))
    errors.push('capability.id: must be non-empty string');

  if (!isNonEmptyString(cap.resource))
    errors.push('capability.resource: must be non-empty string');

  if (!isNonEmptyArray(cap.actions))
    errors.push('capability.actions: must be non-empty array');
  else if (!cap.actions.every(isNonEmptyString))
    errors.push('capability.actions: all elements must be non-empty strings');

  if (!isPositiveInteger(cap.ttl_seconds))
    errors.push('capability.ttl_seconds: must be positive integer');

  if (!isISOTimestamp(cap.expires_at))
    errors.push('capability.expires_at: must be valid ISO-8601 string');
  else if (!isFutureTimestamp(cap.expires_at))
    errors.push('capability.expires_at: grant is already expired');
}

function validateProvenance(prov, errors) {
  if (!prov || typeof prov !== 'object') {
    errors.push('provenance: must be an object');
    return;
  }
  if (!isNonEmptyString(prov.requestor_id))
    errors.push('provenance.requestor_id: must be non-empty string');
  if (!isNonEmptyString(prov.justification))
    errors.push('provenance.justification: must be non-empty string');
  if (!isISOTimestamp(prov.requested_at))
    errors.push('provenance.requested_at: must be valid ISO-8601 string');
}

function validateDelegationContext(ctx, eventType, errors) {
  // Root grants: delegation_context MUST be null
  if (eventType === 'capability.granted') {
    if (ctx !== null)
      errors.push('delegation_context: must be null for root grant (capability.granted)');
    return;
  }

  // Delegated grants: delegation_context MUST be a non-null object
  if (!ctx || typeof ctx !== 'object') {
    errors.push('delegation_context: must be non-null object for delegated grant');
    return;
  }

  for (const field of REQUIRED_DELEGATION_CONTEXT_FIELDS) {
    if (!(field in ctx))
      errors.push(`delegation_context.${field}: required field missing`);
  }

  if (!isNonEmptyString(ctx.parent_grant_id))
    errors.push('delegation_context.parent_grant_id: must be non-empty string');

  if (!isNonEmptyString(ctx.delegated_to))
    errors.push('delegation_context.delegated_to: must be non-empty string');

  if (!Array.isArray(ctx.delegation_chain))
    errors.push('delegation_context.delegation_chain: must be an array');

  if (typeof ctx.depth !== 'number' || ctx.depth < 1)
    errors.push('delegation_context.depth: must be integer ≥ 1');

  // Chain length must equal depth
  if (Array.isArray(ctx.delegation_chain) && typeof ctx.depth === 'number') {
    if (ctx.delegation_chain.length !== ctx.depth)
      errors.push(
        `delegation_context: chain length (${ctx.delegation_chain.length}) must equal depth (${ctx.depth})`
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT-TYPE SPECIFIC VALIDATORS
// ─────────────────────────────────────────────────────────────────────────────

function validateGranted(event, errors) {
  validateCapabilityObject(event.capability, errors);
  validateProvenance(event.provenance, errors);
  validateDelegationContext(event.delegation_context, event.event_type, errors);
}

function validateDelegated(event, errors) {
  validateCapabilityObject(event.capability, errors);
  validateProvenance(event.provenance, errors);
  validateDelegationContext(event.delegation_context, event.event_type, errors);
}

function validateExecuted(event, errors) {
  if (!isNonEmptyString(event.capability_id))
    errors.push('capability_id: must be non-empty string');
  if (!isNonEmptyString(event.executor_id))
    errors.push('executor_id: must be non-empty string');

  if (!event.tool_call || typeof event.tool_call !== 'object') {
    errors.push('tool_call: must be an object');
  } else {
    if (!isNonEmptyString(event.tool_call.tool_name))
      errors.push('tool_call.tool_name: must be non-empty string');
    if (!event.tool_call.arguments || typeof event.tool_call.arguments !== 'object')
      errors.push('tool_call.arguments: must be an object');
  }

  // delegation_context on execution events mirrors the delegated grant
  if (!event.delegation_context || typeof event.delegation_context !== 'object')
    errors.push('delegation_context: must be non-null object on execution event');
  else {
    if (!isNonEmptyString(event.delegation_context.parent_grant_id))
      errors.push('delegation_context.parent_grant_id: required on execution event');
    if (!Array.isArray(event.delegation_context.delegation_chain))
      errors.push('delegation_context.delegation_chain: must be array on execution event');
  }
}

function validateRevoked(event, errors) {
  if (!isNonEmptyString(event.capability_id))
    errors.push('capability_id: must be non-empty string');
  if (!isNonEmptyString(event.revoked_by))
    errors.push('revoked_by: must be non-empty string');
  if (!isNonEmptyString(event.reason))
    errors.push('reason: must be non-empty string');
  // cascade_of: null or non-empty string
  if (event.cascade_of !== null && !isNonEmptyString(event.cascade_of))
    errors.push('cascade_of: must be null or non-empty string');
}

function validateDenied(event, errors) {
  if (!event.attempted_capability || typeof event.attempted_capability !== 'object')
    errors.push('attempted_capability: must be an object');
  if (!isNonEmptyString(event.denial_reason))
    errors.push('denial_reason: must be non-empty string');
  const validViolationTypes = ['scope_exceeded', 'ttl_exceeded', 'resource_mismatch', 'constraint_weaker'];
  if (!validViolationTypes.includes(event.violation_type))
    errors.push(`violation_type: must be one of [${validViolationTypes.join(', ')}], got '${event.violation_type}'`);
  if (!isNonEmptyString(event.parent_grant_id))
    errors.push('parent_grant_id: must be non-empty string');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

const VALIDATORS = {
  'capability.granted':   validateGranted,
  'capability.delegated': validateDelegated,
  'capability.executed':  validateExecuted,
  'capability.revoked':   validateRevoked,
  'capability.denied':    validateDenied,
};

/**
 * validateCapability(event) → { valid: boolean, errors: string[] }
 *
 * Validates structure and state machine compliance of any capability event.
 * Returns { valid: true, errors: [] } on success.
 * Returns { valid: false, errors: [...] } listing all violations found.
 * Never throws — errors are collected and returned.
 */
function validateCapability(event) {
  const errors = [];

  if (!event || typeof event !== 'object') {
    return { valid: false, errors: ['event: must be a non-null object'] };
  }

  // Common field checks first
  validateCommonFields(event, errors);

  // If event_type is unknown, cannot run specific validator
  const specificValidator = VALIDATORS[event.event_type];
  if (!specificValidator) {
    errors.push(`event_type: no validator registered for '${event.event_type}'`);
    return { valid: false, errors };
  }

  // Run specific validator
  specificValidator(event, errors);

  return { valid: errors.length === 0, errors };
}

module.exports = { validateCapability };
