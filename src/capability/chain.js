'use strict';

/**
 * src/capability/chain.js
 * AI-Delegation-Learning-Lab — AMO Research Series Lab 3
 *
 * Builds and validates delegation_chain arrays.
 * No ledger access — operates on plain objects.
 * This is the structural integrity layer for the chain thesis:
 *   every step must be a subset of the previous step.
 */

/**
 * buildChain(params) → ChainEntry[]
 *
 * Extends the parent's delegation_chain with a new ChainEntry for the new grant.
 * If parent is a root grant (delegation_context === null), creates a depth-1 chain.
 *
 * @param {object} params
 * @param {object} params.parent_event       — GrantEvent or DelegatedGrantEvent
 * @param {string} params.new_grant_id
 * @param {string} params.new_principal
 * @param {string[]} params.new_actions
 * @param {string} params.new_resource
 * @param {string} params.issued_at          — ISO-8601
 * @returns {ChainEntry[]}
 */
function buildChain({
  parent_event,
  new_grant_id,
  new_principal,
  new_actions,
  new_resource,
  issued_at,
}) {
  const parentChain = parent_event.delegation_context?.delegation_chain || [];
  const parentDepth = parent_event.delegation_context?.depth ?? 0;

  // The new entry's depth is parentDepth + 1 (root grant = depth 0, first delegate = depth 1)
  const newEntry = Object.freeze({
    grant_id:   new_grant_id,
    principal:  new_principal,
    issued_at,
    actions:    [...new_actions],
    resource:   new_resource,
    depth:      parentDepth + 1,
  });

  return [...parentChain, newEntry];
}

/**
 * validateChain(chain) → { ok: boolean, violations: string[] }
 *
 * Validates structural integrity of a delegation_chain array:
 *   1. depth values are sequential: 1, 2, 3, …  (no gaps, no duplicates)
 *   2. Each step's actions ⊆ previous step's actions (or root grant's actions for depth=1)
 *   3. Each step's resource equals or is a sub-path of the previous step's resource
 *   4. No empty actions arrays
 *
 * NOTE: depth=1 is validated against the chain entry alone (root grant not in chain).
 * Scope vs. root grant is enforced separately in delegate.js.
 *
 * @param {ChainEntry[]} chain
 * @param {object} [rootGrant]  — optional root GrantEvent to validate depth-1 against root
 * @returns {{ ok: boolean, violations: string[] }}
 */
function validateChain(chain, rootGrant = null) {
  const violations = [];

  if (!Array.isArray(chain)) {
    return { ok: false, violations: ['chain: must be an array'] };
  }

  if (chain.length === 0) {
    return { ok: false, violations: ['chain: must have at least one entry'] };
  }

  // ── Check 1: sequential depth values starting at 1 ─────────────────────
  for (let i = 0; i < chain.length; i++) {
    const expected = i + 1;
    if (chain[i].depth !== expected) {
      violations.push(
        `chain[${i}]: expected depth ${expected}, got ${chain[i].depth}`
      );
    }
  }

  // ── Check 2+3: each step ⊆ previous step ───────────────────────────────
  for (let i = 0; i < chain.length; i++) {
    const current  = chain[i];
    const previous = i === 0 ? (rootGrant?.capability || null) : chain[i - 1];

    if (!current.actions || current.actions.length === 0) {
      violations.push(`chain[${i}]: actions must be non-empty`);
      continue;
    }

    if (previous) {
      // Actions subset check
      const parentActions = new Set(previous.actions);
      for (const action of current.actions) {
        if (!parentActions.has(action)) {
          violations.push(
            `chain[${i}]: action '${action}' not present in parent actions [${previous.actions.join(', ')}]`
          );
        }
      }

      // Resource path check: current must equal or be sub-path of parent
      const parentResource = previous.resource;
      if (parentResource && !isSubResource(current.resource, parentResource)) {
        violations.push(
          `chain[${i}]: resource '${current.resource}' is not equal to or sub-path of parent '${parentResource}'`
        );
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * isSubResource(child, parent) → boolean
 *
 * Returns true if child resource equals parent resource,
 * or child resource path starts with parent resource path.
 *
 * Examples:
 *   isSubResource('filesystem:/data/reports', 'filesystem:/data/reports') → true
 *   isSubResource('filesystem:/data/reports/q1', 'filesystem:/data/reports') → true
 *   isSubResource('filesystem:/data/other', 'filesystem:/data/reports') → false
 *   isSubResource('filesystem:/data', 'filesystem:/data/reports') → false (parent more specific)
 */
function isSubResource(child, parent) {
  if (child === parent) return true;
  // Normalize: ensure parent ends with / for prefix matching to avoid
  // false positives like /data/report matching /data/reports
  const normalizedParent = parent.endsWith('/') ? parent : parent + '/';
  return child.startsWith(normalizedParent);
}

/**
 * actionsAreSubset(child, parent) → boolean
 * Returns true iff every action in child is present in parent.
 */
function actionsAreSubset(childActions, parentActions) {
  const parentSet = new Set(parentActions);
  return childActions.every(a => parentSet.has(a));
}

module.exports = {
  buildChain,
  validateChain,
  isSubResource,
  actionsAreSubset,
};
