'use strict';
// Smoke test for core/wire.js using minimal fakes for Express, Mongoose and sqlite-manager.
const test = require('node:test'); const assert = require('node:assert/strict'); const http = require('http');
const { DatabaseSync } = require('node:sqlite'); const { wire } = require('../core/wire'); const { signInit, OWNER } = require('./harness');

function fakeMongoose(rows = []) {
  const written = [], deleted = []; const listeners = {};
  const Model = { updateOne: (f, u) => { written.push([f, u.$set.data]); return Promise.resolve(); }, deleteOne: (f) => { deleted.push(f); return Promise.resolve(); }, find: () => ({ lean: async () => rows }) };
  function Schema() { this.index = () => {}; } Schema.Types = { Mixed: {} };
  return { written, deleted, mongoose: { Schema, models: {}, model: () => Model, connection: { readyState: 1, once: (e, f) => { listeners[e] = f; } } } };
}
test('wire(): mounts handlers, mirrors writes to Mongo, restores missing entities, sends via bot', async () => {
  const sqlite = new DatabaseSync(':memory:'); const users = new Map([['11111', { userId: '11111', firstName: 'A', firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() }]]); const batches = new Map(); const mirrored = [];
  const db = { getDb: () => sqlite, batch: { getAll: () => [...batches.values()], getOne: (i) => batches.get(i) || null, upsert: (b) => batches.set(String(b._id), b), delete: (i) => batches.delete(i) }, user: { findOne: (i) => users.get(i) || null, listAll: () => [...users.values()], count: () => users.size },
    bannedUser: { isBanned: () => false, ban() {}, unban() {}, findOne: () => null, listAll: () => [] }, access: { findOne: () => null, upsert() {} }, announcement: { insert() {}, delete() {} }, adsFree: { getAllActive: () => [] } };
  const mg = fakeMongoose([{ kind: 'faculty', id: 'restored1', data: { id: 'restored1', name: 'Restored Teacher', status: 'active' } }]);
  const mounts = {}; const app = { use: (p, h) => { mounts[p] = h; }, get: (p, h) => { mounts['GET ' + p] = h; } };
  const BatchModel = { findByIdAndUpdate: (id, d) => { mirrored.push(id); return Promise.resolve(); }, findByIdAndDelete: () => Promise.resolve() };
  const m = wire({ app, db, mongoose: mg.mongoose, Batch: BatchModel, botToken: 'T:OKEN', ownerId: OWNER });
  assert.ok(mounts['/api/admin'] && mounts['GET /api/catalog']);
  await new Promise((r) => setTimeout(r, 30)); assert.equal(m.store.get('faculty', 'restored1').name, 'Restored Teacher'); // restore at startup
  const sent = []; m.setBot({ sendMessage: async (id, t, o) => { sent.push([id, o.parse_mode]); } });
  assert.equal(m.isPanelUser(OWNER), true); assert.equal(m.isPanelUser(5), false);
  // drive the mounted admin handler over real HTTP with a correctly signed token
  const server = http.createServer(mounts['/api/admin']); await new Promise((r) => server.listen(0, r)); const port = server.address().port;
  const tok = (u) => { const real = require('crypto'); const p = new URLSearchParams({ user: JSON.stringify(u), auth_date: String(Math.floor(Date.now() / 1000)) }); const dcs = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + '=' + v).join('\n'); p.set('hash', real.createHmac('sha256', real.createHmac('sha256', 'WebAppData').update('T:OKEN').digest()).update(dcs).digest('hex')); return p.toString(); };
  const call = async (method, path, body) => { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', 'x-tg-init-data': tok({ id: OWNER, first_name: 'O' }) }, body: body && JSON.stringify(body) }); return r.json(); };
  const f = await call('POST', '/api/admin/faculties', { name: 'Via Wire' }); assert.equal(f.success, true);
  assert.ok(mg.written.some(([flt]) => flt.kind === 'faculty' && flt.id === f.data.id)); // mirrored to Mongo
  const b = await call('POST', '/api/admin/batches', { name: 'Wired Batch', facultyId: f.data.id }); assert.equal(b.success, true);
  await new Promise((r) => setTimeout(r, 20)); assert.deepEqual(mirrored, [b.data.id]); // batch mirrored through the same path as existing routes
  const n = await call('POST', '/api/admin/notifications', { title: 'Hi', body: 'There', audience: 'all' }); await call('POST', `/api/admin/notifications/${n.data.id}/send`); await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(sent, [[11111, 'HTML']]); // goes through bot.sendMessage with numeric id + HTML parse mode
  await call('DELETE', `/api/admin/faculties/${f.data.id}?force=1`); assert.ok(mg.deleted.some((d) => d.id === f.data.id));
  server.closeAllConnections(); server.close();
});
