# Delegation Policy
## AI-Delegation-Learning-Lab / AMO Research Series Lab 3

---

## Core Invariants

These invariants must hold for every session recorded in the ledger.
`replayChain()` verifies all of them on demand.

### INV-1 — Scope Containment
A delegated grant's scope must be equal to or strictly contained within its parent grant's scope.  
Formally: `∀ delegation D with parent P: D.actions ⊆ P.actions ∧ D.resource ⊆ P.resource ∧ D.ttl ≤ P.remaining_ttl`

### INV-2 — Chain Integrity
The `delegation_chain` array of any DelegatedGrantEvent must have:
- Sequential depth values starting at 1
- Each entry's actions ⊆ previous entry's actions
- Each entry's resource equal to or sub-path of previous entry's resource

### INV-3 — Cascade Completeness
If a grant G is revoked, all grants D where `D.delegation_context.parent_grant_id = G.id` must also be revoked.  
This applies recursively at all depths.

### INV-4 — Delegation Context Null ↔ Root Grant
`delegation_context = null` if and only if `event_type = 'capability.granted'`.  
No delegated grant may have a null delegation_context.

### INV-5 — Independent Revocability
Revoking a delegated grant does not revoke its parent grant.  
Revoking a parent grant cascades to all derived grants.

---

## Scope Definitions

### Actions
The set of permitted operations. Standard actions in this lab:
- `read` — non-mutating retrieval
- `write` — creation or modification
- `delete` — removal
- `push` — append-only write (e.g. git push)

Actions are opaque strings matched by exact equality. Future labs may introduce
hierarchical action sets (e.g. `write:append` ⊂ `write`).

### Resources
Resources use a URI scheme: `<type>:<path>`  
Examples:
- `filesystem:/data/reports`
- `github:org/repo/main`
- `database:production/users`

Sub-resource matching uses path prefix with `/` normalization.

### Constraints
Constraints are key-value pairs applied on top of resource+actions scope.  
Current enforcement: numeric keys, child value must be ≤ parent value.  
Example: `{ max_file_size_kb: 256 }` is stricter than `{ max_file_size_kb: 512 }`.

---

## State Machine

```
requested → evaluated → granted → delegated → active → completed (terminal)
                       ↓          ↓
                      denied     denied     (terminal — scope violation)
                     (terminal)

Any non-terminal state → revoked (terminal)
```

The constitution check (`checkConstitution()`) validates this graph at boot time.
The system will not start if the state machine definition is malformed.

---

## Audit

Every session is fully auditable via `replayChain(sessionId, ledger)`.  
The function returns:
- `ok: true` — all invariants hold, all transitions are valid
- `ok: false` — one or more invariants violated, with specific violation messages
- `chain_trace` — full event-by-event trace regardless of ok value

A denial event (`capability.denied`) is a valid terminal state and does not
cause `ok: false`. It is evidence of governance working correctly.
