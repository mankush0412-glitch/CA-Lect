'use strict';
/**
 * Generic entity store used by the management modules.
 * Read/write goes to SQLite (same handle as sqlite-manager). Every write/delete is
 * also reported to optional hooks so server.js can mirror to MongoDB — required on
 * Render where the SQLite file lives on an ephemeral disk.
 */
const crypto = require('crypto');

class EntityStore {
  constructor(db, hooks = {}) {
    this.db = db;
    this.hooks = hooks; // { onWrite(kind,id,data), onDelete(kind,id) }
    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER DEFAULT 0,
        PRIMARY KEY (kind, id)
      );
      CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind, updated_at);
    `);
  }
  static newId() { return crypto.randomBytes(8).toString('hex'); }
  list(kind) {
    return this.db.prepare('SELECT data FROM entities WHERE kind=? ORDER BY updated_at ASC, rowid ASC')
      .all(kind).map(r => JSON.parse(r.data));
  }
  get(kind, id) {
    const r = this.db.prepare('SELECT data FROM entities WHERE kind=? AND id=?').get(kind, String(id));
    return r ? JSON.parse(r.data) : null;
  }
  put(kind, id, obj, { mirror = true } = {}) {
    id = String(id);
    const data = { ...obj, id };
    this.db.prepare(`INSERT INTO entities(kind,id,data,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`)
      .run(kind, id, JSON.stringify(data), Date.now());
    if (mirror && this.hooks.onWrite) { try { this.hooks.onWrite(kind, id, data); } catch (e) { /* backup is best-effort */ } }
    return data;
  }
  del(kind, id, { mirror = true } = {}) {
    id = String(id);
    const r = this.db.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind, id);
    if (mirror && this.hooks.onDelete) { try { this.hooks.onDelete(kind, id); } catch (e) {} }
    return r.changes > 0;
  }
  count(kind) { return this.db.prepare('SELECT COUNT(*) c FROM entities WHERE kind=?').get(kind).c; }
  /** Insert rows that exist in the backup but not locally (never overwrites newer local data). */
  restoreMissing(rows) {
    let n = 0;
    for (const r of rows) {
      if (!this.get(r.kind, r.id)) { this.put(r.kind, r.id, r.data, { mirror: false }); n++; }
    }
    return n;
  }
  exportAll() {
    return this.db.prepare('SELECT kind,id,data FROM entities').all().map(r => ({ kind: r.kind, id: r.id, data: JSON.parse(r.data) }));
  }
}
module.exports = { EntityStore };
