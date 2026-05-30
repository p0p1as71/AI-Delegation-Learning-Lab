'use strict';

/**
 * AI-Delegation-Learning-Lab — src/index.js
 * AMO Research Series — Lab 3
 *
 * End-to-end demo runner. Executes 4 scenarios.
 */

const { Ledger }             = require('./ledger/ledger');
const { replayChain }        = require('./ledger/replayChain');
const { checkConstitution }  = require('./validator/checkConstitution');
const { issueGrant }         = require('./capability/grant');
const { revokeGrant }        = require('./capability/revoke');
const { delegateGrant,
        cascadeRevoke }      = require('./capability/delegate');
const { runDelegatedTool }   = require('./runtime/delegation-bridge');

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 1 — Happy path
// ─────────────────────────────────────────────────────────────────────────────
async function demo1_happyPath() {
  const sessionId = 'demo1-' + Date.now();
  const ledger = new Ledger({ sessionId });

  const rootGrant = issueGrant({
    session_id:    sessionId,
    requestor_id:  'principal:alice',
    resource:      'filesystem:/data/reports',
    actions:       ['read', 'write'],
    ttl_seconds:   3600,
    constraints:   { max_file_size_kb: 512 },
    justification: 'Alice needs to produce quarterly report',
  });
  ledger.append(rootGrant);

  const delegatedGrant = delegateGrant({
    session_id:      sessionId,
    parent_grant_id: rootGrant.capability.id,
    delegated_to:    'agent:report-writer',
    resource:        'filesystem:/data/reports',
    actions:         ['write'],
    ttl_seconds:     1800,
    constraints:     { max_file_size_kb: 256 },
    justification:   'Report writer agent needs write-only access',
    ledger,
  });
  ledger.append(delegatedGrant);

  const executionEvent = runDelegatedTool({
    session_id:    sessionId,
    capability_id: delegatedGrant.capability.id,
    executor_id:   'agent:report-writer',
    tool_name:     'filesystem_write',
    arguments:     { path: '/data/reports/q1.md', content: '# Q1 Report' },
    ledger,
  });
  ledger.append(executionEvent);

  const revokeDelegate = revokeGrant({
    session_id:    sessionId,
    capability_id: delegatedGrant.capability.id,
    revoked_by:    'principal:alice',
    reason:        'Task completed',
    cascade_of:    null,
  });
  ledger.append(revokeDelegate);

  const revokeRoot = revokeGrant({
    session_id:    sessionId,
    capability_id: rootGrant.capability.id,
    revoked_by:    'principal:alice',
    reason:        'Session closed',
    cascade_of:    null,
  });
  ledger.append(revokeRoot);

  return { scenario: 'demo1_happyPath', result: replayChain(sessionId, ledger) };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 2 — Scope violation
// ─────────────────────────────────────────────────────────────────────────────
async function demo2_scopeViolation() {
  const sessionId = 'demo2-' + Date.now();
  const ledger = new Ledger({ sessionId });

  const rootGrant = issueGrant({
    session_id:    sessionId,
    requestor_id:  'principal:bob',
    resource:      'filesystem:/data/readonly',
    actions:       ['read'],
    ttl_seconds:   3600,
    justification: 'Bob has read-only access',
  });
  ledger.append(rootGrant);

  const deniedGrant = delegateGrant({
    session_id:      sessionId,
    parent_grant_id: rootGrant.capability.id,
    delegated_to:    'agent:malicious-writer',
    resource:        'filesystem:/data/readonly',
    actions:         ['read', 'write'],   // VIOLATION
    ttl_seconds:     1800,
    justification:   'Attempt to escalate scope',
    ledger,
  });
  ledger.append(deniedGrant);

  return { scenario: 'demo2_scopeViolation', result: replayChain(sessionId, ledger) };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 3 — Parent revocation cascade
// ─────────────────────────────────────────────────────────────────────────────
async function demo3_parentRevocationCascade() {
  const sessionId = 'demo3-' + Date.now();
  const ledger = new Ledger({ sessionId });

  const rootGrant = issueGrant({
    session_id:    sessionId,
    requestor_id:  'principal:alice',
    resource:      'filesystem:/data/shared',
    actions:       ['read', 'write', 'delete'],
    ttl_seconds:   7200,
    justification: 'Alice controls shared filesystem',
  });
  ledger.append(rootGrant);

  const delegateA = delegateGrant({
    session_id:      sessionId,
    parent_grant_id: rootGrant.capability.id,
    delegated_to:    'agent:processor-A',
    resource:        'filesystem:/data/shared',
    actions:         ['read', 'write'],
    ttl_seconds:     3600,
    justification:   'Processor A needs read/write',
    ledger,
  });
  ledger.append(delegateA);

  const delegateB = delegateGrant({
    session_id:      sessionId,
    parent_grant_id: delegateA.capability.id,
    delegated_to:    'agent:processor-B',
    resource:        'filesystem:/data/shared',
    actions:         ['read'],
    ttl_seconds:     1800,
    justification:   'Processor B needs read-only sub-delegation',
    ledger,
  });
  ledger.append(delegateB);

  const revokeRoot = revokeGrant({
    session_id:    sessionId,
    capability_id: rootGrant.capability.id,
    revoked_by:    'principal:alice',
    reason:        'Emergency shutdown',
    cascade_of:    null,
  });
  ledger.append(revokeRoot);

  const cascadeEvents = cascadeRevoke({
    session_id:      sessionId,
    parent_grant_id: rootGrant.capability.id,
    revoked_by:      'system:cascade',
    reason:          'Cascade from parent revocation',
    ledger,
  });
  cascadeEvents.forEach(e => ledger.append(e));

  return { scenario: 'demo3_parentRevocationCascade', result: replayChain(sessionId, ledger) };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 4 — Chain replay audit (depth-2 delegation)
// ─────────────────────────────────────────────────────────────────────────────
async function demo4_chainReplayAudit() {
  const sessionId = 'demo4-' + Date.now();
  const ledger = new Ledger({ sessionId });

  const root = issueGrant({
    session_id:    sessionId,
    requestor_id:  'principal:carol',
    resource:      'filesystem:/data/audit-target',
    actions:       ['read', 'write'],
    ttl_seconds:   7200,
    justification: 'Audit test root grant',
  });
  ledger.append(root);

  const level1 = delegateGrant({
    session_id:      sessionId,
    parent_grant_id: root.capability.id,
    delegated_to:    'agent:level1',
    resource:        'filesystem:/data/audit-target',
    actions:         ['read', 'write'],
    ttl_seconds:     3600,
    justification:   'Level 1 delegation',
    ledger,
  });
  ledger.append(level1);

  const level2 = delegateGrant({
    session_id:      sessionId,
    parent_grant_id: level1.capability.id,
    delegated_to:    'agent:level2',
    resource:        'filesystem:/data/audit-target',
    actions:         ['read'],
    ttl_seconds:     1800,
    justification:   'Level 2 read-only delegation',
    ledger,
  });
  ledger.append(level2);

  const execution = runDelegatedTool({
    session_id:    sessionId,
    capability_id: level2.capability.id,
    executor_id:   'agent:level2',
    tool_name:     'filesystem_read',
    arguments:     { path: '/data/audit-target/report.md' },
    ledger,
  });
  ledger.append(execution);

  const revokeRoot = revokeGrant({
    session_id:    sessionId,
    capability_id: root.capability.id,
    revoked_by:    'principal:carol',
    reason:        'Audit complete',
    cascade_of:    null,
  });
  ledger.append(revokeRoot);

  const cascadeEvents = cascadeRevoke({
    session_id:      sessionId,
    parent_grant_id: root.capability.id,
    revoked_by:      'system:cascade',
    reason:          'Cascade from root revocation',
    ledger,
  });
  cascadeEvents.forEach(e => ledger.append(e));

  return { scenario: 'demo4_chainReplayAudit', result: replayChain(sessionId, ledger) };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  // Constitution check — MUST pass before any scenario runs
  const constitution = checkConstitution();
  console.log('[BOOT] Constitution valid. State machine: OK\n');

  const results = [];
  results.push(await demo1_happyPath());
  results.push(await demo2_scopeViolation());
  results.push(await demo3_parentRevocationCascade());
  results.push(await demo4_chainReplayAudit());

  console.log('=== AI-Delegation-Learning-Lab — Demo Results ===\n');
  results.forEach(({ scenario, result }) => {
    const status = result.ok ? '✓ PASS' : '✗ FAIL';
    console.log(`[${status}] ${scenario}`);
    console.log(`         events: ${result.event_count}`);
    result.chain_trace.forEach(t =>
      console.log(`         [${t.check}] ${t.event_type} (${t.state}) — ${t.note}`)
    );
    if (!result.ok) {
      result.violations.forEach(v => console.log(`         VIOLATION: ${v}`));
    }
    console.log('');
  });

  const allPassed = results.every(r => r.result.ok);
  console.log(`Thesis verification: delegation_chain integrity ${allPassed ? 'CONFIRMED ✓' : 'FAILED ✗'}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
