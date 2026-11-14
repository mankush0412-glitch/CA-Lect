'use strict';
const fs = require('fs'); const path = require('path'); const { DatabaseSync } = require('node:sqlite');
const iso = (t) => new Date(t).toISOString();

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS users (userId TEXT PRIMARY KEY, firstName TEXT, lastName TEXT, username TEXT, firstSeen TEXT, lastSeen TEXT, referredBy TEXT, points INTEGER NOT NULL DEFAULT 0, level TEXT);
    CREATE INDEX IF NOT EXISTS idx_users_seen ON users(lastSeen);
    CREATE TABLE IF NOT EXISTS suspensions (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT, at INTEGER, until INTEGER, channel TEXT);
    CREATE TABLE IF NOT EXISTS bans (userId TEXT PRIMARY KEY, reason TEXT, bannedBy TEXT, at INTEGER);
    CREATE TABLE IF NOT EXISTS access (userId TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL DEFAULT 0, windowMs INTEGER NOT NULL DEFAULT 0, updatedAt INTEGER);
    CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, data TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS usage (userId TEXT NOT NULL, day TEXT NOT NULL, lectures INTEGER NOT NULL DEFAULT 0, extra INTEGER NOT NULL DEFAULT 0, ads INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (userId, day));
    CREATE TABLE IF NOT EXISTS ad_claims (token TEXT PRIMARY KEY, userId TEXT NOT NULL, serverId TEXT NOT NULL, startedAt INTEGER NOT NULL, claimedAt INTEGER);
    CREATE INDEX IF NOT EXISTS idx_ad_claims_user ON ad_claims(userId, serverId, startedAt);
    CREATE TABLE IF NOT EXISTS referrals (referredId TEXT PRIMARY KEY, referrerId TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_ref_referrer ON referrals(referrerId);
    CREATE TABLE IF NOT EXISTS points_log (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_points_user ON points_log(userId, id);
    CREATE TABLE IF NOT EXISTS plans (userId TEXT PRIMARY KEY, data TEXT NOT NULL, updatedAt INTEGER);
    CREATE TABLE IF NOT EXISTS autodel (id INTEGER PRIMARY KEY AUTOINCREMENT, chatId TEXT NOT NULL, msgId INTEGER NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS autodel_at ON autodel(at);
    CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL, lectureId TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_deliv_at ON deliveries(at);
    CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, emoji TEXT, heading TEXT, body TEXT, createdAt TEXT);
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
  `);
  const q = (s) => sqlite.prepare(s);
  for (const col of ['btnText', 'btnUrl']) { try { sqlite.exec(`ALTER TABLE announcements ADD COLUMN ${col} TEXT`); } catch (e) { /* exists */ } }
  for (const col of ['dl', 'dlUsed']) { try { sqlite.exec(`ALTER TABLE usage ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`); } catch (e) { /* already there */ } }
  const plain = (r) => (r ? { ...r } : null);

  const user = {
    findOne: (id) => plain(q('SELECT * FROM users WHERE userId=?').get(String(id))),
    listAll: () => q('SELECT * FROM users ORDER BY firstSeen DESC').all().map(plain),
    count: () => q('SELECT COUNT(*) c FROM users').get().c,
    /** Create or touch a user. Returns { user, created }. */
    touch(tg, now = Date.now()) {
      const id = String(tg.id); const cur = user.findOne(id);
      if (!cur) { q('INSERT INTO users(userId,firstName,lastName,username,firstSeen,lastSeen) VALUES(?,?,?,?,?,?)').run(id, tg.first_name || '', tg.last_name || '', tg.username || '', iso(now), iso(now)); return { user: user.findOne(id), created: true }; }
      q('UPDATE users SET firstName=?,lastName=?,username=?,lastSeen=? WHERE userId=?').run(tg.first_name || cur.firstName, tg.last_name || '', tg.username || '', iso(now), id); return { user: user.findOne(id), created: false };
    },
    upsert(u) { q('INSERT INTO users(userId,firstName,lastName,username,firstSeen,lastSeen) VALUES(?,?,?,?,?,?) ON CONFLICT(userId) DO UPDATE SET firstName=excluded.firstName,lastName=excluded.lastName,username=excluded.username,lastSeen=excluded.lastSeen').run(String(u.userId), u.firstName || '', u.lastName || '', u.username || '', u.firstSeen || iso(Date.now()), u.lastSeen || iso(Date.now())); },
    setLevel: (id, level) => q('UPDATE users SET level=? WHERE userId=?').run(level, String(id)),
    addPoints(id, delta, reason, now = Date.now()) { q('UPDATE users SET points=points+? WHERE userId=?').run(delta, String(id)); q('INSERT INTO points_log(userId,delta,reason,at) VALUES(?,?,?,?)').run(String(id), delta, reason || '', now); return user.findOne(id).points; },
  };
  const ban = {
    isBanned: (id) => !!q('SELECT 1 x FROM bans WHERE userId=?').get(String(id)),
    ban: ({ userId, reason, bannedBy }) => q('INSERT OR REPLACE INTO bans(userId,reason,bannedBy,at) VALUES(?,?,?,?)').run(String(userId), reason || '', bannedBy || '', Date.now()),
    unban: (id) => q('DELETE FROM bans WHERE userId=?').run(String(id)),
    findOne: (id) => plain(q('SELECT * FROM bans WHERE userId=?').get(String(id))),
    listAll: () => q('SELECT * FROM bans').all().map(plain),
  };
  const access = {
    findOne: (id) => { const r = q('SELECT * FROM access WHERE userId=?').get(String(id)); return r ? { userId: r.userId, expiresAt: new Date(r.expiresAt).toISOString(), expiresMs: r.expiresAt, windowMs: r.windowMs } : null; },
    upsert(a) { const ms = typeof a.expiresMs === 'number' ? a.expiresMs : Date.parse(a.expiresAt); q('INSERT INTO access(userId,expiresAt,windowMs,updatedAt) VALUES(?,?,?,?) ON CONFLICT(userId) DO UPDATE SET expiresAt=excluded.expiresAt, windowMs=excluded.windowMs, updatedAt=excluded.updatedAt').run(String(a.userId), ms, a.windowMs || 0, Date.now()); },
  };
  const batch = {
    getAll: () => q('SELECT data FROM batches ORDER BY ord, rowid').all().map((r) => JSON.parse(r.data)),
    getOne: (id) => { const r = q('SELECT data FROM batches WHERE id=?').get(String(id)); return r ? JSON.parse(r.data) : null; },
    upsert(b) { const id = String(b._id); const ord = Number.isFinite(b.order) ? b.order : 0; q('INSERT INTO batches(id,data,ord) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, ord=excluded.ord').run(id, JSON.stringify(b), ord); batch.version++; },
    delete(id) { q('DELETE FROM batches WHERE id=?').run(String(id)); batch.version++; },
    version: 0,
  };
  const announcement = {
    insert: (a) => q('INSERT OR REPLACE INTO announcements(id,emoji,heading,body,createdAt,btnText,btnUrl) VALUES(?,?,?,?,?,?,?)').run(a.id, a.emoji || '', a.heading || '', a.body || '', a.createdAt || iso(Date.now()), a.btnText || '', a.btnUrl || ''),
    delete: (id) => q('DELETE FROM announcements WHERE id=?').run(id),
    latest: (n = 10) => q('SELECT * FROM announcements ORDER BY createdAt DESC LIMIT ?').all(n).map(plain),
  };
  const usage = {
    get(id, day) { const r = q('SELECT * FROM usage WHERE userId=? AND day=?').get(String(id), day); return r ? { ...r } : { userId: String(id), day, lectures: 0, extra: 0, ads: 0, dl: 0, dlUsed: 0 }; },
    bump(id, day, field, n = 1) { if (!['lectures', 'extra', 'ads', 'dl', 'dlUsed'].includes(field)) throw new Error('bad field'); q(`INSERT INTO usage(userId,day,${field}) VALUES(?,?,?) ON CONFLICT(userId,day) DO UPDATE SET ${field}=${field}+excluded.${field}`).run(String(id), day, n); },
  };
  const kv = { get: (k) => { const r = q('SELECT v FROM kv WHERE k=?').get(k); return r ? r.v : null; }, set: (k, v) => q('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v)) };
  return { sqlite, user, ban, access, batch, announcement, usage, kv, q, close: () => sqlite.close() };
}
module.exports = { openDb };
