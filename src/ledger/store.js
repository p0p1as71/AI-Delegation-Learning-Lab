'use strict';

/**
 * src/ledger/store.js
 * Reused from AI-MCP-Learning-Lab — no modifications.
 *
 * Append-only in-memory event store.
 * Keyed by session_id for O(1) session lookup.
 */

class Store {
  constructor() {
    // Map<session_id, Event[]>
    this._sessions = new Map();
    // Flat append log — insertion order preserved
    this._log = [];
  }

  /**
   * append(event) → void
   * Appends event to the flat log and the session bucket.
   * Immutably freezes the event on insert.
   */
  append(event) {
    if (!event || typeof event !== 'object')
      throw new TypeError('store.append: event must be a non-null object');
    if (!event.session_id)
      throw new TypeError('store.append: event.session_id is required');

    const frozen = Object.freeze({ ...event });
    this._log.push(frozen);

    if (!this._sessions.has(event.session_id)) {
      this._sessions.set(event.session_id, []);
    }
    this._sessions.get(event.session_id).push(frozen);
  }

  /**
   * bySession(session_id) → Event[]
   * Returns all events for a session in insertion order.
   */
  bySession(sessionId) {
    return this._sessions.get(sessionId) || [];
  }

  /**
   * all() → Event[]
   * Returns full flat log in insertion order.
   */
  all() {
    return [...this._log];
  }

  /**
   * size() → number
   */
  size() {
    return this._log.length;
  }
}

module.exports = { Store };
