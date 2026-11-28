'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const { boot, closeAll } = require('./helpers');
test.afterEach(closeAll);
test('timer: survives app close, splits at midnight, today/week/month/all totals saved', async () => {
  const t = await boot({ start: Date.parse('2026-11-27T22:30:00+05:30') }); const u = t.user(5); await t.reg(u); const id = String(u.id);
  const call = (m, p, b) => t.call(u, m, '/api/study' + p, b);
  let r = await call('POST', '/start?level=intermediate', { subject: 'Costing' }); assert.equal(r.status, 200, JSON.stringify(r.json));
  t.clock.t += 5 * 3600e3; // app closed for 5h (no beats): crosses IST midnight
  let st = (await call('GET', '/state')).json.data; assert.ok(st.active, 'still running after 5h with the app closed');
  r = await call('POST', '/stop', {}); assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
  const rows = t.app.db.sqlite.prepare('SELECT day, SUM(seconds) s FROM study_day WHERE userId=? GROUP BY day ORDER BY day').all(id);
  assert.equal(rows.length, 2); assert.equal(rows[0].s + rows[1].s, 5 * 3600); assert.equal(rows[0].s, 5400);
  const sec = async (p) => (await call('GET', '/leaderboard?period=' + p)).json.data.rows[0].seconds;
  assert.equal(await sec('today'), 12600, 'today = only the part after midnight'); assert.equal(await sec('week'), 18000); assert.equal(await sec('all'), 18000);
  const rc = (await call('GET', '/history?month=2026-11')).json.data; assert.equal(Object.values(rc.days).reduce((a, b) => a + b, 0), 18000, 'month history saved');
});
