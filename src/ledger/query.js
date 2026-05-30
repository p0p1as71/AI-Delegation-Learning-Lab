'use strict';

/**
 * src/ledger/query.js
 * Reused from AI-MCP-Learning-Lab — no modifications.
 *
 * Read-only query functions over a Store instance.
 * No mutation. All functions return new arrays — never store references.
 */

/**
 * bySession(store, sessionId) → Event[]
 */
function bySession(store, sessionId) {
  return store.bySession(sessionId);
}

/**
 * byCapabilityId(store, sessionId, capabilityId) → Event[]
 * Returns all events that reference a specific capability id.
 */
function byCapabilityId(store, sessionId, capabilityId) {
  return store.bySession(sessionId).filter(e => {
    return (
      e.capability?.id === capabilityId ||
      e.capability_id  === capabilityId
    );
  });
}

/**
 * byEventType(store, sessionId, eventType) → Event[]
 */
function byEventType(store, sessionId, eventType) {
  return store.bySession(sessionId).filter(e => e.event_type === eventType);
}

/**
 * latestState(store, sessionId, capabilityId) → string | null
 * Returns the most recent state recorded for a capability_id in this session.
 */
function latestState(store, sessionId, capabilityId) {
  const events = byCapabilityId(store, sessionId, capabilityId);
  if (events.length === 0) return null;
  return events[events.length - 1].state;
}

/**
 * grantById(store, sessionId, capabilityId) → Event | null
 * Returns the original grant or delegated-grant event for a capability_id.
 */
function grantById(store, sessionId, capabilityId) {
  const events = store.bySession(sessionId);
  return events.find(e =>
    (e.event_type === 'capability.granted' || e.event_type === 'capability.delegated') &&
    e.capability?.id === capabilityId
  ) || null;
}

/**
 * allDelegatesOf(store, sessionId, parentGrantId) → Event[]
 * Returns all capability.delegated events with delegation_context.parent_grant_id === parentGrantId.
 */
function allDelegatesOf(store, sessionId, parentGrantId) {
  return store.bySession(sessionId).filter(e =>
    e.event_type === 'capability.delegated' &&
    e.delegation_context?.parent_grant_id === parentGrantId
  );
}

/**
 * isRevoked(store, sessionId, capabilityId) → boolean
 */
function isRevoked(store, sessionId, capabilityId) {
  return store.bySession(sessionId).some(e =>
    e.event_type === 'capability.revoked' &&
    e.capability_id === capabilityId
  );
}

module.exports = {
  bySession,
  byCapabilityId,
  byEventType,
  latestState,
  grantById,
  allDelegatesOf,
  isRevoked,
};
