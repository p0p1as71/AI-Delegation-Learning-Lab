# ADR-006 — Delegation Does Not Transfer Authority

**Status:** Accepted  
**Date:** 2026-05-30  
**Series:** AI-Delegation-Learning-Lab / AMO Research Series Lab 3

---

## Context

In the previous lab (AI-MCP-Learning-Lab), authority was a time-bounded, revocable,
formally justified object. The open question was: what happens when authority is not
exercised directly by the original requestor, but passed to a third party?

The naive design would treat delegation as a transfer — the delegatee receives the
same authority object the delegator held. This is incorrect.

## Decision

Delegation issues a **new, derived authority object** (DelegatedGrantEvent) from the
original grant. The parent grant is not consumed, modified, or transferred.

The derived grant:
- carries its own `capability.id` (new UUID)
- carries a `delegation_context` recording the full issuance path
- is independently revocable without touching the parent grant
- has a scope that is equal to or strictly narrower than the parent

The parent grant:
- remains active and valid after delegation
- can be revoked independently of its delegates
- when revoked, cascades revocation to all derived grants (see ADR-008)

## Consequences

**Positive:**
- The authority plane remains structurally auditable at every depth
- A delegated agent cannot exceed the authority of its delegator — enforced structurally, not by policy
- Independent revocability enables fine-grained session management

**Negative:**
- Two active grants can exist simultaneously (parent + delegate), requiring
  cascade logic to maintain consistency on revocation

## Alternatives Rejected

**Transfer model:** Parent grant is consumed and replaced by delegate grant.  
Rejected because it destroys the audit chain and makes parent-level revocation impossible
without knowing all downstream delegates at revocation time.

**Permission copy model:** Delegate receives a copy with the same id.  
Rejected because identity collision in the ledger breaks replay integrity.
