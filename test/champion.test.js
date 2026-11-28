'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const { boot, closeAll } = require('./helpers');
test.afterEach(closeAll);
const IST = 330 * 60000;
test('day end: Top 10 goes to every student, #1 gets 24h Ads-Free once, admin can see it', async () => {
  const start = Date.parse('2026-11-27T10:00:00Z'); const t = await boot({ start });
  const ids = []; for (let i = 1; i <= 12; i++) { const u = t.user(i); await t.reg(u); ids.push(String(u.id)); }
  assert.ok(t.app.db.user.findOne(ids[0]));
 
  const day = '2026-11-27'; const bump = (u, s) => t.app.db.sqlite.prepare('INSERT INTO study_day(userId,day,subject,seconds) VALUES(?,?,?,?)').run(String(u), day, 'FR', s);
  const bump2 = (u, sub, s) => t.app.db.sqlite.prepare('INSERT INTO study_day(userId,day,subject,seconds) VALUES(?,?,?,?)').run(String(u), day, sub, s);
  ids.forEach((id, i) => bump(id, 1800 + i * 600)); bump2(ids[4], 'Audit', 4 * 3600);
  const sent0 = t.tg.of('sendMessage').length;
  t.clock.t = Date.parse('2026-11-28T00:10:00+05:30');
  const r = await t.app.champion.tick(); assert.ok(r && r.record, 'ran'); assert.equal(r.record.winnerId, ids[4]); assert.equal(r.record.rows.length, 10);
  assert.ok(t.app.service && (t.app.champion.history()[0].day === day));
  const msgs = t.tg.of('sendMessage').slice(sent0); assert.ok(msgs.length >= 12, 'sent to all: ' + msgs.length);
  const win = msgs.find((m) => String(m.chat_id) === ids[4]); assert.match(win.text, /Congratulations/); assert.match(win.text, /Valid till/);
  const other = msgs.find((m) => String(m.chat_id) === ids[0]); assert.match(other.text, /Daily Study Champions/); assert.match(other.text, /✅ 🎉 <b>Congratulations/); assert.match(other.text, /✅ 🥇/); assert.match(other.text, /🔟/); assert.match(other.text, /Your rank/);
  // 2005 is now Ads-Free for 24h, others are not
  const me = await t.call(t.user(5), 'GET', '/api/app/me'); assert.equal(me.json.data.adFree.active, true);
  const me2 = await t.call(t.user(1), 'GET', '/api/app/me'); assert.equal(!!(me2.json.data.adFree && me2.json.data.adFree.active), false);
  const until = me.json.data.adFree.until; assert.ok(Math.abs(until - (t.clock.t + 864e5)) < 5000);
  // never twice for the same day
  assert.equal(await t.app.champion.tick(), null); const again = await t.app.champion.run(day); assert.equal(again.skipped, 'done');
  // admin history API
  const h = await t.call({ id: 1000, first_name: 'Owner' }, 'GET', '/api/admin/champions'); assert.equal(h.status, 200); assert.equal(h.json.data.items[0].winnerId, ids[4]);
});
test('nobody reaches the minimum minutes → board is sent but no premium', async () => {
  const t = await boot({ start: Date.parse('2026-11-27T10:00:00Z') }); const u = t.user(31); await t.reg(u);
  t.app.db.sqlite.prepare('INSERT INTO study_day(userId,day,subject,seconds) VALUES(?,?,?,?)').run(String(u.id), '2026-11-27', 'FR', 600);
  t.clock.t = Date.parse('2026-11-28T00:10:00+05:30'); const r = await t.app.champion.tick(); assert.equal(r.record.winnerId, ''); assert.match(t.tg.last('sendMessage').text, /at least <b>30 minutes/);
});
test('each course (Foundation / Inter / Final) gets its own champion; or one overall winner when switched off', async () => {
  for (const per of [true, false]) {
    const t = await boot({ start: Date.parse('2026-11-27T10:00:00Z') }); const us = [41, 42, 43].map((n) => t.user(n)); for (const u of us) await t.reg(u);
    const lv = ['foundation', 'intermediate', 'final']; us.forEach((u, i) => t.app.db.sqlite.prepare('UPDATE users SET level=? WHERE userId=?').run(lv[i], String(u.id)));
    const secs = [3600, 7200, 10800]; us.forEach((u, i) => t.app.db.sqlite.prepare('INSERT INTO study_day(userId,day,subject,seconds) VALUES(?,?,?,?)').run(String(u.id), '2026-11-27', 'X', secs[i]));
    t.app.service.config.set({ id: '1000', name: 'o', role: 'super_admin', perms: new Set(['*']) }, { championPerLevel: per });
    t.clock.t = Date.parse('2026-11-28T00:10:00+05:30'); const r = await t.app.champion.tick(); const af = async (u) => !!((await t.call(u, 'GET', '/api/app/me')).json.data.adFree || {}).active;
    if (per) {
      assert.equal(r.record.boards.length, 3); assert.deepEqual(await Promise.all(us.map(af)), [true, true, true], 'one winner per course');
      const f = t.tg.of('sendMessage').find((m) => String(m.chat_id) === String(us[0].id) && /Daily Study Champions/.test(m.text)); assert.match(f.text, /CA Foundation/); assert.match(f.text, /Other courses' champions/); assert.match(f.text, /Congratulations/);
    } else { assert.equal(r.record.boards.length, 1); assert.deepEqual(await Promise.all(us.map(af)), [false, false, true], 'only the overall #1'); }
  }
});
