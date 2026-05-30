'use strict';

/**
 * src/ledger/replayChain.js
 * AI-Delegation-Learning-Lab — AMO Research Series Lab 3
 *
 * Full delegation chain auditor.
 * Reads all events for a session and verifies:
 *   - Each DelegatedGrantEvent: chain structural integrity via validateChain()
 *   - Each RevocationEvent: cascade completeness
 *     (if parent revoked, all derived delegations must also have RevocationEvent)
 *   - No scope violation slipped through (delegated events must not exceed their parent)
 *
 * Returns full trace regardless of ok value — for audit evidence.
 */

const { validateChain }      = require('../capability/chain');
const { actionsAreSubset,
        isSubResource }      = require('../capability/chain');

/**
 * replayChain(sessionId, ledger) → ReplayChainResult
 *
 * @typedef {Object} ChainTraceEntry
 * { event_id, event_type, state, capability_id, depth, check, note }
 *
 * @typedef {Object} ReplayChainResult
 * { ok, session_id, chain_trace, violations, event_count }
 */
function replayChain(sessionId, ledger) {
  const events     = ledger.bySession(sessionId);
  const violations = [];
  const trace      = [];

  // Index structures for O(1) lookup
  const grantsById     = new Map();   // capability_id → grant/delegated event
  const revokedIds     = new Set();   // capability_ids that have been revoked

  // ── Pass 1: index all grant events ───────────────────────────────────────
  for (const event of events) {
    if (event.event_type === 'capability.granted' ||
        event.event_type === 'capability.delegated') {
      grantsById.set(event.capability.id, event);
    }
    if (event.event_type === 'capability.revoked') {
      revokedIds.add(event.capability_id);
    }
  }

  // ── Pass 2: audit each event ──────────────────────────────────────────────
  for (const event of events) {
    switch (event.event_type) {

      // ── Root grant: verify delegation_context is null ──────────────────
      case 'capability.granted': {
        const capId = event.capability.id;
        if (event.delegation_context !== null) {
          const msg = `root grant ${capId}: delegation_context must be null`;
          violations.push(msg);
          trace.push(_entry(event, capId, 0, 'fail', msg));
        } else {
          trace.push(_entry(event, capId, 0, 'pass', 'root grant valid'));
        }
        break;
      }

      // ── Delegated grant: verify chain integrity + scope vs parent ──────
      case 'capability.delegated': {
        const capId = event.capability.id;
        const ctx   = event.delegation_context;
        const depth = ctx?.depth ?? null;

        // Chain structural validation
        const chainResult = validateChain(ctx.delegation_chain);
        if (!chainResult.ok) {
          chainResult.violations.forEach(v => violations.push(`${capId}: ${v}`));
          trace.push(_entry(event, capId, depth, 'fail',
            `chain violations: ${chainResult.violations.join('; ')}`));
          break;
        }

        // Scope vs parent verification
        const parentEvent = grantsById.get(ctx.parent_grant_id);
        if (!parentEvent) {
          const msg = `${capId}: parent grant '${ctx.parent_grant_id}' not found in session`;
          violations.push(msg);
          trace.push(_entry(event, capId, depth, 'fail', msg));
          break;
        }

        const scopeViolation = _checkScopeViolation(event, parentEvent);
        if (scopeViolation) {
          violations.push(`${capId}: ${scopeViolation}`);
          trace.push(_entry(event, capId, depth, 'fail', scopeViolation));
        } else {
          trace.push(_entry(event, capId, depth, 'pass',
            `chain[${depth - 1}→${depth}] scope valid`));
        }
        break;
      }

      // ── Revocation: verify cascade completeness ────────────────────────
      case 'capability.revoked': {
        const capId = event.capability_id;

        // Find all direct delegates of this revoked capability
        const delegates = _findDelegatesOf(capId, events);
        const missingCascades = [];

        for (const del of delegates) {
          const delId = del.capability.id;
          if (!revokedIds.has(delId)) {
            missingCascades.push(delId);
          }
        }

        if (missingCascades.length > 0) {
          const msg = `revocation of ${capId}: cascade incomplete — delegates not revoked: [${missingCascades.join(', ')}]`;
          violations.push(msg);
          trace.push(_entry(event, capId, null, 'fail', msg));
        } else {
          const isCascade = event.cascade_of ? `cascade of ${event.cascade_of}` : 'direct revocation';
          trace.push(_entry(event, capId, null, 'pass', isCascade + ' — cascade complete'));
        }
        break;
      }

      // ── Denial: valid terminal path, just trace ────────────────────────
      case 'capability.denied': {
        trace.push(_entry(event, null, null, 'pass',
          `scope denial recorded: ${event.violation_type} — ${event.denial_reason}`));
        break;
      }

      // ── Execution: verify capability was in delegated state ────────────
      case 'capability.executed': {
        const capId = event.capability_id;
        const grant = grantsById.get(capId);

        if (!grant) {
          const msg = `execution event references unknown capability '${capId}'`;
          violations.push(msg);
          trace.push(_entry(event, capId, null, 'fail', msg));
          break;
        }

        // Execution must be on a delegated grant (not root)
        if (grant.event_type !== 'capability.delegated') {
          const msg = `execution must be on a delegated grant, found '${grant.event_type}'`;
          violations.push(msg);
          trace.push(_entry(event, capId, null, 'fail', msg));
          break;
        }

        trace.push(_entry(event, capId, null, 'pass', 'execution within delegated scope'));
        break;
      }

      default: {
        const msg = `unknown event_type '${event.event_type}'`;
        violations.push(msg);
        trace.push({
          event_id:      event.event_id,
          event_type:    event.event_type,
          state:         event.state || null,
          capability_id: null,
          depth:         null,
          check:         'fail',
          note:          msg,
        });
      }
    }
  }

  return {
    ok:          violations.length === 0,
    session_id:  sessionId,
    chain_trace: trace,
    violations,
    event_count: events.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _entry(event, capabilityId, depth, check, note) {
  return {
    event_id:      event.event_id,
    event_type:    event.event_type,
    state:         event.state || null,
    capability_id: capabilityId,
    depth,
    check,
    note,
  };
}

function _findDelegatesOf(parentGrantId, events) {
  return events.filter(e =>
    e.event_type === 'capability.delegated' &&
    e.delegation_context?.parent_grant_id === parentGrantId
  );
}

/**
 * _checkScopeViolation(delegatedEvent, parentEvent) → string | null
 * Returns null if scope is valid, or a description string if violated.
 */
function _checkScopeViolation(delegatedEvent, parentEvent) {
  const child  = delegatedEvent.capability;
  const parent = parentEvent.capability;

  // Actions subset check
  if (!actionsAreSubset(child.actions, parent.actions)) {
    const excess = child.actions.filter(a => !parent.actions.includes(a));
    return `actions [${excess.join(', ')}] exceed parent scope [${parent.actions.join(', ')}]`;
  }

  // Resource check
  if (!isSubResource(child.resource, parent.resource)) {
    return `resource '${child.resource}' exceeds parent resource '${parent.resource}'`;
  }

  // TTL check: child expires_at must be ≤ parent expires_at
  if (new Date(child.expires_at) > new Date(parent.expires_at)) {
    return `expires_at '${child.expires_at}' exceeds parent expiry '${parent.expires_at}'`;
  }

  return null;
}

module.exports = { replayChain };
