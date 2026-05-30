'use strict';

/**
 * tests/delegation.test.js
 * AI-Delegation-Learning-Lab — AMO Research Series Lab 3
 *
 * Unit tests. No external test framework — pure Node.js assertions.
 * Run: node tests/delegation.test.js
 */

const assert = require('assert');

const { STATES, TRANSITIONS, isValidTransition, isTerminalState } = require('../src/validator/rules');
const { validateCapability }  = require('../src/validator/validateCapability');
const { checkConstitution }   = require('../src/validator/checkConstitution');
const { Ledger }              = require('../src/ledger/ledger');
const { replayChain }         = require('../src/ledger/replayChain');
const { issueGrant }          = require('../src/capability/grant');
const { revokeGrant }         = require('../src/capability/revoke');
const { delegateGrant,
        cascadeRevoke }       = require('../src/capability/delegate');
const { buildChain,
        validateChain,
        isSubResource,
        actionsAreSubset }    = require('../src/capability/chain');
const { runDelegatedTool,
        CapabilityViolationError } = require('../src/runtime/delegation-bridge');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[rules.js]');
// ─────────────────────────────────────────────────────────────────────────────

test('STATES has 8 values', () => {
  assert.strictEqual(Object.keys(STATES).length, 8);
});

test('TRANSITIONS covers all states', () => {
  for (const state of Object.values(STATES)) {
    assert.ok(TRANSITIONS.has(state), `missing transition entry for '${state}'`);
  }
});

test('isValidTransition: requested → evaluated = true', () => {
  assert.ok(isValidTransition('requested', 'evaluated'));
});

test('isValidTransition: granted → delegated = true', () => {
  assert.ok(isValidTransition('granted', 'delegated'));
});

test('isValidTransition: completed → anything = false', () => {
  assert.ok(!isValidTransition('completed', 'granted'));
  assert.ok(!isValidTransition('completed', 'revoked'));
});

test('isValidTransition: self-loop = false', () => {
  assert.ok(!isValidTransition('granted', 'granted'));
});

test('isTerminalState: completed/revoked/denied = true', () => {
  assert.ok(isTerminalState('completed'));
  assert.ok(isTerminalState('revoked'));
  assert.ok(isTerminalState('denied'));
  assert.ok(!isTerminalState('granted'));
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[checkConstitution.js]');
// ─────────────────────────────────────────────────────────────────────────────

test('checkConstitution passes', () => {
  const result = checkConstitution();
  assert.ok(result.ok);
  assert.strictEqual(result.violations.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[validateCapability.js]');
// ─────────────────────────────────────────────────────────────────────────────

function makeRootGrant(overrides = {}) {
  return {
    event_id:   'evt-001',
    event_type: 'capability.granted',
    session_id: 'sess-001',
    timestamp:  new Date().toISOString(),
    state:      'granted',
    capability: {
      id:          'cap-001',
      resource:    'filesystem:/data',
      actions:     ['read'],
      ttl_seconds: 3600,
      expires_at:  new Date(Date.now() + 3600000).toISOString(),
    },
    provenance: {
      requestor_id:  'principal:alice',
      justification: 'test',
      requested_at:  new Date().toISOString(),
    },
    delegation_context: null,
    ...overrides,
  };
}

test('valid root grant passes', () => {
  const r = validateCapability(makeRootGrant());
  assert.ok(r.valid, JSON.stringify(r.errors));
});

test('root grant with non-null delegation_context fails', () => {
  const r = validateCapability(makeRootGrant({ delegation_context: { foo: 'bar' } }));
  assert.ok(!r.valid);
  assert.ok(r.errors.some(e => e.includes('must be null')));
});

test('expired grant fails', () => {
  const g = makeRootGrant();
  g.capability.expires_at = '2020-01-01T00:00:00Z';
  const r = validateCapability(g);
  assert.ok(!r.valid);
  assert.ok(r.errors.some(e => e.includes('expired')));
});

test('empty actions array fails', () => {
  const g = makeRootGrant();
  g.capability.actions = [];
  const r = validateCapability(g);
  assert.ok(!r.valid);
});

test('unknown event_type fails', () => {
  const g = makeRootGrant({ event_type: 'capability.unknown', state: 'granted' });
  const r = validateCapability(g);
  assert.ok(!r.valid);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[chain.js]');
// ─────────────────────────────────────────────────────────────────────────────

test('isSubResource: exact match = true', () => {
  assert.ok(isSubResource('filesystem:/data/reports', 'filesystem:/data/reports'));
});

test('isSubResource: sub-path = true', () => {
  assert.ok(isSubResource('filesystem:/data/reports/q1', 'filesystem:/data/reports'));
});

test('isSubResource: sibling path = false', () => {
  assert.ok(!isSubResource('filesystem:/data/other', 'filesystem:/data/reports'));
});

test('isSubResource: prefix collision avoided', () => {
  assert.ok(!isSubResource('filesystem:/data/report', 'filesystem:/data/reports'));
});

test('actionsAreSubset: write ⊆ [read,write] = true', () => {
  assert.ok(actionsAreSubset(['write'], ['read', 'write']));
});

test('actionsAreSubset: delete ⊆ [read,write] = false', () => {
  assert.ok(!actionsAreSubset(['delete'], ['read', 'write']));
});

test('validateChain: valid depth-2 chain passes', () => {
  const chain = [
    { grant_id: 'g1', principal: 'agent:A', issued_at: new Date().toISOString(), actions: ['read', 'write'], resource: 'filesystem:/data', depth: 1 },
    { grant_id: 'g2', principal: 'agent:B', issued_at: new Date().toISOString(), actions: ['read'], resource: 'filesystem:/data', depth: 2 },
  ];
  const r = validateChain(chain);
  assert.ok(r.ok, JSON.stringify(r.violations));
});

test('validateChain: action escalation fails', () => {
  const chain = [
    { grant_id: 'g1', principal: 'agent:A', issued_at: new Date().toISOString(), actions: ['read'], resource: 'filesystem:/data', depth: 1 },
    { grant_id: 'g2', principal: 'agent:B', issued_at: new Date().toISOString(), actions: ['read', 'write'], resource: 'filesystem:/data', depth: 2 },
  ];
  const r = validateChain(chain);
  assert.ok(!r.ok);
  assert.ok(r.violations.some(v => v.includes('write')));
});

test('validateChain: gap in depth fails', () => {
  const chain = [
    { grant_id: 'g1', principal: 'agent:A', issued_at: new Date().toISOString(), actions: ['read'], resource: 'filesystem:/data', depth: 1 },
    { grant_id: 'g2', principal: 'agent:B', issued_at: new Date().toISOString(), actions: ['read'], resource: 'filesystem:/data', depth: 3 }, // gap
  ];
  const r = validateChain(chain);
  assert.ok(!r.ok);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[grant.js + revoke.js]');
// ─────────────────────────────────────────────────────────────────────────────

test('issueGrant returns valid GrantEvent', () => {
  const g = issueGrant({
    session_id: 'sess-001', requestor_id: 'principal:alice',
    resource: 'filesystem:/data', actions: ['read'],
    ttl_seconds: 3600, justification: 'test',
  });
  assert.strictEqual(g.event_type, 'capability.granted');
  assert.strictEqual(g.state, 'granted');
  assert.strictEqual(g.delegation_context, null);
  assert.ok(g.capability.id);
  assert.ok(g.capability.expires_at);
});

test('revokeGrant returns RevocationEvent with cascade_of null', () => {
  const r = revokeGrant({
    session_id: 'sess-001', capability_id: 'cap-001',
    revoked_by: 'principal:alice', reason: 'done',
  });
  assert.strictEqual(r.event_type, 'capability.revoked');
  assert.strictEqual(r.state, 'revoked');
  assert.strictEqual(r.cascade_of, null);
});

test('revokeGrant with cascade_of sets field', () => {
  const r = revokeGrant({
    session_id: 'sess-001', capability_id: 'cap-002',
    revoked_by: 'system:cascade', reason: 'cascade',
    cascade_of: 'cap-001',
  });
  assert.strictEqual(r.cascade_of, 'cap-001');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[delegate.js]');
// ─────────────────────────────────────────────────────────────────────────────

function makeTestLedger() {
  const sessionId = 'test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const ledger = new Ledger({ sessionId });
  const root = issueGrant({
    session_id: sessionId, requestor_id: 'principal:alice',
    resource: 'filesystem:/data', actions: ['read', 'write'],
    ttl_seconds: 3600, justification: 'test root',
  });
  ledger.append(root);
  return { sessionId, ledger, root };
}

test('delegateGrant: valid delegation returns DelegatedGrantEvent', () => {
  const { sessionId, ledger, root } = makeTestLedger();
  const d = delegateGrant({
    session_id: sessionId, parent_grant_id: root.capability.id,
    delegated_to: 'agent:worker', resource: 'filesystem:/data',
    actions: ['read'], ttl_seconds: 1800, justification: 'test',
    ledger,
  });
  assert.strictEqual(d.event_type, 'capability.delegated');
  assert.strictEqual(d.state, 'delegated');
  assert.strictEqual(d.delegation_context.depth, 1);
  assert.strictEqual(d.delegation_context.parent_grant_id, root.capability.id);
  assert.strictEqual(d.delegation_context.delegation_chain.length, 1);
});

test('delegateGrant: action escalation returns DenialEvent', () => {
  const { sessionId, ledger, root } = makeTestLedger();
  const d = delegateGrant({
    session_id: sessionId, parent_grant_id: root.capability.id,
    delegated_to: 'agent:bad', resource: 'filesystem:/data',
    actions: ['read', 'write', 'delete'], ttl_seconds: 1800,
    justification: 'test', ledger,
  });
  assert.strictEqual(d.event_type, 'capability.denied');
  assert.strictEqual(d.violation_type, 'scope_exceeded');
});

test('delegateGrant: TTL exceeds parent → DenialEvent', () => {
  const { sessionId, ledger, root } = makeTestLedger();
  const d = delegateGrant({
    session_id: sessionId, parent_grant_id: root.capability.id,
    delegated_to: 'agent:X', resource: 'filesystem:/data',
    actions: ['read'], ttl_seconds: 99999, justification: 'test', ledger,
  });
  assert.strictEqual(d.event_type, 'capability.denied');
  assert.strictEqual(d.violation_type, 'ttl_exceeded');
});

test('delegateGrant: resource mismatch → DenialEvent', () => {
  const { sessionId, ledger, root } = makeTestLedger();
  const d = delegateGrant({
    session_id: sessionId, parent_grant_id: root.capability.id,
    delegated_to: 'agent:X', resource: 'filesystem:/other',
    actions: ['read'], ttl_seconds: 1800, justification: 'test', ledger,
  });
  assert.strictEqual(d.event_type, 'capability.denied');
  assert.strictEqual(d.violation_type, 'resource_mismatch');
});

test('delegateGrant: depth-2 chain correct', () => {
  const { sessionId, ledger, root } = makeTestLedger();
  const d1 = delegateGrant({
    session_id: sessionId, parent_grant_id: root.capability.id,
    delegated_to: 'agent:A', resource: 'filesystem:/data',
    actions: ['read', 'write'], ttl_seconds: 3000, justification: 'level 1', ledger,
  });
  ledger.append(d1);
  const d2 = delegateGrant({
    session_id: sessionId, parent_grant_id: d1.capability.id,
    delegated_to: 'agent:B', resource: 'filesystem:/data',
    actions: ['read'], ttl_seconds: 1500, justification: 'level 2', ledger,
  });
  assert.strictEqual(d2.delegation_context.depth, 2);
  assert.strictEqual(d2.delegation_context.delegation_chain.length, 2);
  assert.strictEqual(d2.delegation_context.delegation_chain[0].depth, 1);
  assert.strictEqual(d2.delegation_context.delegation_chain[1].depth, 2);
});

test('cascadeRevoke: revokes all children recursively', () => {
  const { sessionId, ledger, root } = makeTestLedger();
  const d1 = delegateGrant({
    session_id: sessionId, parent_grant_id: root.capability.id,
    delegated_to: 'agent:A', resource: 'filesystem:/data',
    actions: ['read'], ttl_seconds: 3000, justification: 'L1', ledger,
  });
  ledger.append(d1);
  const d2 = delegateGrant({
    session_id: sessionId, parent_grant_id: d1.capability.id,
    delegated_to: 'agent:B', resource: 'filesystem:/data',
    actions: ['read'], ttl_seconds: 1500, justification: 'L2', ledger,
  });
  ledger.append(d2);

  const cascadeEvents = cascadeRevoke({
    session_id: sessionId, parent_grant_id: root.capability.id,
    revoked_by: 'system', reason: 'test cascade', ledger,
  });
  assert.strictEqual(cascadeEvents.length, 2);
  assert.strictEqual(cascadeEvents[0].capability_id, d1.capability.id);
  assert.strictEqual(cascadeEvents[0].cascade_of, root.capability.id);
  assert.strictEqual(cascadeEvents[1].capability_id, d2.capability.id);
  assert.strictEqual(cascadeEvents[1].cascade_of, d1.capability.id);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[delegation-bridge.js]');
// ─────────────────────────────────────────────────────────────────────────────

function makeExecutionLedger() {
  const { sessionId, ledger, root } = makeTestLedger();
  const del = delegateGrant({
    session_id: sessionId, parent_grant_id: root.capability.id,
    delegated_to: 'agent:executor', resource: 'filesystem:/data',
    actions: ['read', 'write'], ttl_seconds: 1800, justification: 'exec test', ledger,
  });
  ledger.append(del);
  return { sessionId, ledger, root, del };
}

test('runDelegatedTool: valid execution returns ExecutionEvent', () => {
  const { sessionId, ledger, del } = makeExecutionLedger();
  const e = runDelegatedTool({
    session_id: sessionId, capability_id: del.capability.id,
    executor_id: 'agent:executor', tool_name: 'filesystem_write',
    arguments: { path: '/data/test.md', content: 'hello' }, ledger,
  });
  assert.strictEqual(e.event_type, 'capability.executed');
  assert.strictEqual(e.state, 'completed');
  assert.ok(e.tool_call.result.success);
});

test('runDelegatedTool: wrong executor throws CapabilityViolationError', () => {
  const { sessionId, ledger, del } = makeExecutionLedger();
  assert.throws(() => {
    runDelegatedTool({
      session_id: sessionId, capability_id: del.capability.id,
      executor_id: 'agent:impostor', tool_name: 'filesystem_read',
      arguments: {}, ledger,
    });
  }, CapabilityViolationError);
});

test('runDelegatedTool: action not in grant throws', () => {
  const { sessionId, ledger, del } = makeExecutionLedger();
  assert.throws(() => {
    runDelegatedTool({
      session_id: sessionId, capability_id: del.capability.id,
      executor_id: 'agent:executor', tool_name: 'filesystem_delete',
      arguments: {}, ledger,
    });
  }, CapabilityViolationError);
});

test('runDelegatedTool: revoked capability throws', () => {
  const { sessionId, ledger, del } = makeExecutionLedger();
  const rev = revokeGrant({
    session_id: sessionId, capability_id: del.capability.id,
    revoked_by: 'principal:alice', reason: 'revoked before exec',
  });
  ledger.append(rev);
  assert.throws(() => {
    runDelegatedTool({
      session_id: sessionId, capability_id: del.capability.id,
      executor_id: 'agent:executor', tool_name: 'filesystem_read',
      arguments: {}, ledger,
    });
  }, CapabilityViolationError);
});

test('runDelegatedTool: root grant (not delegated) throws', () => {
  const { sessionId, ledger, root } = makeTestLedger();
  assert.throws(() => {
    runDelegatedTool({
      session_id: sessionId, capability_id: root.capability.id,
      executor_id: 'principal:alice', tool_name: 'filesystem_read',
      arguments: {}, ledger,
    });
  }, CapabilityViolationError);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[replayChain.js]');
// ─────────────────────────────────────────────────────────────────────────────

test('replayChain: happy path → ok:true', () => {
  const { sessionId, ledger, root } = makeTestLedger();
  const del = delegateGrant({
    session_id: sessionId, parent_grant_id: root.capability.id,
    delegated_to: 'agent:worker', resource: 'filesystem:/data',
    actions: ['read'], ttl_seconds: 1800, justification: 'test', ledger,
  });
  ledger.append(del);
  const rev = revokeGrant({ session_id: sessionId, capability_id: del.capability.id, revoked_by: 'a', reason: 'done' });
  ledger.append(rev);
  const rev2 = revokeGrant({ session_id: sessionId, capability_id: root.capability.id, revoked_by: 'a', reason: 'done' });
  ledger.append(rev2);
  const audit = replayChain(sessionId, ledger);
  assert.ok(audit.ok, JSON.stringify(audit.violations));
});

test('replayChain: incomplete cascade → ok:false', () => {
  const { sessionId, ledger, root } = makeTestLedger();
  const del = delegateGrant({
    session_id: sessionId, parent_grant_id: root.capability.id,
    delegated_to: 'agent:worker', resource: 'filesystem:/data',
    actions: ['read'], ttl_seconds: 1800, justification: 'test', ledger,
  });
  ledger.append(del);
  // Revoke root but NOT the delegate → cascade incomplete
  const rev = revokeGrant({ session_id: sessionId, capability_id: root.capability.id, revoked_by: 'a', reason: 'done' });
  ledger.append(rev);
  const audit = replayChain(sessionId, ledger);
  assert.ok(!audit.ok);
  assert.ok(audit.violations.some(v => v.includes('cascade incomplete')));
});

test('replayChain: denial event → ok:true (valid terminal path)', () => {
  const { sessionId, ledger, root } = makeTestLedger();
  const denied = delegateGrant({
    session_id: sessionId, parent_grant_id: root.capability.id,
    delegated_to: 'agent:bad', resource: 'filesystem:/data',
    actions: ['delete'], ttl_seconds: 1800, justification: 'test', ledger,
  });
  ledger.append(denied);
  const audit = replayChain(sessionId, ledger);
  assert.ok(audit.ok, JSON.stringify(audit.violations));
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed ✓');
}
