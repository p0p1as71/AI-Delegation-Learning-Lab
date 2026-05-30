# AI-Delegation-Learning-Lab

**AMO Research Series — Lab 3**  
*Structural Governance in Autonomous Systems*

---

## Thesis

Delegation does not transfer authority — it issues a new, scoped, time-bounded
authority object derived from the original grant. The delegated grant must:

- **(a)** not exceed the scope of the original grant
- **(b)** carry a `delegation_chain` recording the full issuance path
- **(c)** be independently revocable without revoking the parent grant
- **(d)** be verifiable through replay at every step of the chain

---

## Relation to Previous Labs

| Lab | Demonstrated |
|-----|-------------|
| AI-Filesystem-Learning-Lab | Capability as a governed object |
| AI-MCP-Learning-Lab | Identity ≠ authority; authority as time-bounded revocable grant |
| **AI-Delegation-Learning-Lab** | **Delegation as derivation, not transfer; chain integrity** |

---

## State Machine

```
requested → evaluated → granted → delegated → active → completed
                       ↓          ↓
                      denied     denied (scope violation)
                     (terminal)  (terminal)

Any non-terminal state → revoked (terminal)
```

The state machine definition is validated at boot time by `checkConstitution()`.
The system halts if the definition is malformed.

---

## Architecture

```
src/
├── validator/
│   ├── rules.js                — state machine constants + pure functions
│   ├── validateCapability.js   — structural validation of any event
│   └── checkConstitution.js    — boot-time state machine integrity check
├── ledger/
│   ├── store.js                — append-only in-memory event store [reused]
│   ├── query.js                — read-only query helpers [reused]
│   ├── replay.js               — per-capability state machine replay [reused]
│   ├── ledger.js               — facade over store + query [reused]
│   └── replayChain.js          — full delegation chain audit [new]
├── capability/
│   ├── grant.js                — root grant factory [reused pattern]
│   ├── revoke.js               — revocation event factory [reused pattern]
│   ├── chain.js                — chain builder + structural validator [new]
│   └── delegate.js             — derived grant factory + cascade revoke [new]
├── runtime/
│   └── delegation-bridge.js    — ADR-005 adapter for delegated tool execution
└── index.js                    — demo runner (4 scenarios)
```

---

## Demo Scenarios

```bash
node src/index.js
```

| Scenario | Description | Expected |
|----------|-------------|----------|
| `demo1_happyPath` | Root grant → delegate → execute → revoke all | `ok: true`, 5 events |
| `demo2_scopeViolation` | Delegate attempts to exceed parent actions | `ok: true`, denial recorded |
| `demo3_parentRevocationCascade` | Root revoked → depth-2 cascade | `ok: true`, 6 events |
| `demo4_chainReplayAudit` | Full depth-2 delegation + audit | `ok: true`, 7 events |

---

## Tests

```bash
node tests/delegation.test.js
```

39 unit tests covering all modules. No external dependencies.

---

## ADRs

| ADR | Decision |
|-----|----------|
| ADR-005 | Bridge is adapter, not governor *(inherited)* |
| ADR-006 | Delegation is derivation, not transfer |
| ADR-007 | Scope constraint is structural, not policy |
| ADR-008 | Revocation cascade is recursive and ledger-driven |

---

## Key Invariants (verified by `replayChain()`)

- **INV-1** Scope containment: `child.actions ⊆ parent.actions`
- **INV-2** Chain integrity: sequential depth, monotone scope narrowing
- **INV-3** Cascade completeness: all children of a revoked grant are revoked
- **INV-4** `delegation_context = null` iff root grant
- **INV-5** Independent revocability: child revocation does not touch parent

---

## Series

AMO Research Series — `zenodo.org/communities/amo_research`
