# ADR-007 — Scope Constraint Is Structural, Not Policy

**Status:** Accepted  
**Date:** 2026-05-30  
**Series:** AI-Delegation-Learning-Lab / AMO Research Series Lab 3

---

## Context

When a delegated grant is issued, it must not exceed the scope of the parent grant.
The question is where this constraint is enforced: at policy evaluation time (runtime check
that can be bypassed or misconfigured), or as a structural property of the event itself.

## Decision

Scope constraint is **structural**: `delegateGrant()` reads the parent grant from the
ledger at delegation time and computes the violation before the event is constructed.
A scope violation produces a `DenialEvent` — a first-class ledger event, not an exception.

Three dimensions are enforced:

1. **Actions subset:** `child.actions ⊆ parent.actions`  
   Any action in the delegated grant must be present in the parent grant.

2. **Resource path:** `child.resource` must equal or be a sub-path of `parent.resource`  
   Enforced via normalized prefix matching to prevent false positives
   (e.g. `/data/report` ≠ `/data/reports`).

3. **TTL:** `child.ttl_seconds ≤ parent.remaining_seconds`  
   Prevents a delegated grant from outliving its parent.

4. **Constraints:** Numeric constraint values must be ≤ parent values  
   (e.g. `max_file_size_kb: 256 ≤ 512`).

`chain.js:validateChain()` re-verifies these constraints during `replayChain()` audit,
creating a second enforcement layer independent of runtime code paths.

## Consequences

**Positive:**
- Scope violations are recorded in the ledger as `capability.denied` events
- The audit trail shows not only what was granted, but what was attempted and blocked
- `replayChain()` can detect scope violations that were not caught at runtime
  (defensive audit layer)

**Negative:**
- `delegateGrant()` requires ledger access (cannot be a pure factory function)
- Constraint comparison is currently limited to numeric keys; string/enum
  constraints require future extension

## Alternatives Rejected

**Exception on violation:** throw ScopeViolationError instead of returning DenialEvent.  
Rejected because exceptions leave no audit trail. A denial must be a first-class
ledger event — it is a governance outcome, not a programming error.
