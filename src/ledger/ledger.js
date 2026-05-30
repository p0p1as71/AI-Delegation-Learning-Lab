'use strict';

/**
 * src/ledger/ledger.js
 * Reused from AI-MCP-Learning-Lab — no modifications.
 *
 * Facade over Store + query helpers.
 * Single object passed through all modules to avoid global state.
 */

const { Store }          = require('./store');
const query              = require('./query');
const { replayCapability } = require('./replay');

class Ledger {
  constructor({ sessionId } = {}) {
    this._store     = new Store();
    this._sessionId = sessionId || null;
  }

  /**
   * append(event) → void
   * Validates session_id matches ledger session (if set), then appends.
   */
  append(event) {
    if (this._sessionId && event.session_id !== this._sessionId) {
      throw new Error(
        `Ledger session mismatch: expected '${this._sessionId}', got '${event.session_id}'`
      );
    }
    this._store.append(event);
  }

  /**
   * bySession(sessionId?) → Event[]
   * If sessionId omitted, uses ledger's own sessionId.
   */
  bySession(sessionId) {
    return this._store.bySession(sessionId || this._sessionId);
  }

  byCapabilityId(capabilityId, sessionId) {
    return query.byCapabilityId(this._store, sessionId || this._sessionId, capabilityId);
  }

  byEventType(eventType, sessionId) {
    return query.byEventType(this._store, sessionId || this._sessionId, eventType);
  }

  latestState(capabilityId, sessionId) {
    return query.latestState(this._store, sessionId || this._sessionId, capabilityId);
  }

  grantById(capabilityId, sessionId) {
    return query.grantById(this._store, sessionId || this._sessionId, capabilityId);
  }

  allDelegatesOf(parentGrantId, sessionId) {
    return query.allDelegatesOf(this._store, sessionId || this._sessionId, parentGrantId);
  }

  isRevoked(capabilityId, sessionId) {
    return query.isRevoked(this._store, sessionId || this._sessionId, capabilityId);
  }

  replayCapability(capabilityId, sessionId) {
    return replayCapability(this._store, sessionId || this._sessionId, capabilityId);
  }

  size() {
    return this._store.size();
  }

  get sessionId() {
    return this._sessionId;
  }
}

module.exports = { Ledger };
