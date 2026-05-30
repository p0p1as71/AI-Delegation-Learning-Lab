# ADR-008 — Revocation Cascade Is Recursive and Ledger-Driven

**Status:** Accepted  
**Date:** 2026-05-30  
**Series:** AI-Delegation-Learning-Lab / AMO Research Series Lab 3

---

## Context

When a parent grant is revoked, all authority objects derived from it must also be
revoked — including delegates of delegates at arbitrary depth. This is the
revocation cascade property required by the lab thesis.

The question is how cascade is triggered and what guarantees completeness.

## Decision

`cascadeRevoke()` in `delegate.js` implements recursive cascade:

1. Reads all `capability.delegated` events from the ledger whose
   `delegation_context.parent_grant_id` matches the revoked grant.
2. Issues a `RevocationEvent` for each direct child with `cascade_of = parent_grant_id`.
3. Recursively calls itself for each child, cascading down the full tree.
4. Returns a flat array of all RevocationEvents — caller appends all to ledger atomically.

**Correctness guarantee:** `replayChain()` verifies cascade completeness as part of
its audit pass. For every `capability.revoked` event, it checks that all known
delegates of that capability also have a `capability.revoked` event. If any are missing,
the replay returns `ok: false` with a specific violation message.

**Idempotency:** Already-revoked capabilities are skipped during cascade traversal
(`ledger.isRevoked(childId)` check). This handles cases where a delegate was
independently revoked before its parent.

**cascade_of field:** Each cascade-produced RevocationEvent carries `cascade_of`
pointing to the immediate parent that triggered it (not the root). This preserves
the causal chain for forensic audit even in deep trees.

## Consequences

**Positive:**
- Cascade completeness is machine-verifiable via `replayChain()`
- The causal chain of revocations is fully traceable
- Works correctly at arbitrary delegation depth without schema changes

**Negative:**
- Cascade traversal requires a full scan of session events for each level
  (acceptable for lab scale; production would index `parent_grant_id`)
- The caller must append all cascade events; partial append leaves an
  inconsistent state (no transaction boundary in the current in-memory store)

## Note on revokeGrant() separation

`revokeGrant()` in `revoke.js` is intentionally kept as a single-event factory
with no knowledge of cascade topology. Cascade logic lives exclusively in
`delegate.js` — the only module that holds the parent-child relationship model.
This separation ensures `revoke.js` remains reusable across contexts where
cascade is not applicable.
