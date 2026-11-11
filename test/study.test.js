'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { boot, signInit, OWNER } = require('./legacy-harness');
const owner = { id: OWNER, first_name: 'Owner' };
const U = (n, name = 'User' + n) => ({ id: 800000 + n, first_name: name });
const START = Date.UTC(2026, 10, 7, 4, 0, 0); // 09:30 IST, Sat 7 Nov 2026
async function setup() { const t = await boot({ start: START }); for (let i = 1; i <= 6; i++) t.dbs.userDb.upsert({ userId: String(800000 + i), firstName: ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Isha'][i - 1], lastName: 'Sharma', username: 'u' + i, firstSeen: new Date(START).toISOString(), lastSeen: new Date(START).toISOString() }); return t; }
const api = (t, u, m, p, b) => t.call(u, m, '/api/study' + p, b);
const adv = (t, ms) => { t.clock.t += ms; };

test('timer is counted server-side with heartbeat grace (anti-cheat)', async () => {
  const t = await setup(); const a = U(1);
  assert.equal((await t.call(null, 'GET', '/api/study/state')).status, 401);
  assert.equal((await api(t, a, 'POST', '/start?level=intermediate', { subject: 'Hacking' })).status, 400);
  let r = await api(t, a, 'POST', '/start?level=intermediate', { subject: 'Costing' }); assert.equal(r.json.data.active.subject, 'Costing');
  for (let i = 0; i < 30; i++) { adv(t, 60e3); await api(t, a, 'POST', '/beat'); } // 30 min with heartbeats
  adv(t, 5e3); r = await api(t, a, 'POST', '/stop'); assert.equal(r.json.data.active, null); assert.equal(r.json.data.todaySeconds, 1805);
  assert.equal(r.json.data.subjects.find((s) => s.name === 'Costing').seconds, 1805);
  // client "forgets" to stop for 2 hours with no heartbeat → only the 90 s grace counts
  await api(t, a, 'POST', '/start?level=intermediate', { subject: 'FM' }); adv(t, 2 * 3600e3); r = await api(t, a, 'GET', '/state?level=intermediate'); assert.equal(r.json.data.active, null); assert.equal(r.json.data.subjects.find((x) => x.name === 'FM').seconds, 90); // reaped: only the 90 s heartbeat grace counts, not 2 hours
  // starting a second subject finalises the first
  await api(t, a, 'POST', '/start?level=intermediate', { subject: 'Auditing' }); adv(t, 40e3); await api(t, a, 'POST', '/beat'); r = await api(t, a, 'POST', '/start?level=intermediate', { subject: 'SM' });
  assert.equal(r.json.data.subjects.find((x) => x.name === 'Auditing').seconds, 40); assert.equal(r.json.data.active.subject, 'SM');
  t.close();
});
test('sessions split at IST midnight; foundation subjects; custom subjects limited to 4', async () => {
  const t = await setup(); const a = U(2); t.clock.t = Date.UTC(2026, 10, 7, 18, 29, 0); // 23:59 IST
  await api(t, a, 'POST', '/start?level=foundation', { subject: 'Accounts' }); for (let i = 0; i < 2; i++) { adv(t, 60e3); await api(t, a, 'POST', '/beat'); } adv(t, 30e3); await api(t, a, 'POST', '/stop');
  const rows = t.sqlite.prepare('SELECT day, seconds FROM study_day WHERE userId=? ORDER BY day').all(String(a.id)); assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ day: '2026-11-07', seconds: 60 }, { day: '2026-11-08', seconds: 90 }]);
  assert.equal((await api(t, a, 'PATCH', '/profile', { customSubjects: ['A1', 'A2', 'A3', 'A4', 'A5'] })).status, 400);
  assert.equal((await api(t, a, 'PATCH', '/profile', { customSubjects: ['Maths', 'Maths', 'GK'] })).json.data.customSubjects.length, 2);
  assert.equal((await api(t, a, 'POST', '/start?level=foundation', { subject: 'GK' })).status, 200);
  assert.equal((await api(t, a, 'PATCH', '/profile', { goalMin: 5 })).status, 400); assert.equal((await api(t, a, 'PATCH', '/profile', { goalMin: 360, displayName: '  Riya\u202e  ' })).json.data.displayName, 'Riya');
  t.close();
});
test('leaderboards (today/week/all), live flag, ranks, me row', async () => {
  const t = await setup(); const ins = t.sqlite.prepare('INSERT INTO study_day(userId,day,subject,seconds) VALUES(?,?,?,?)');
  ins.run('800001', '2026-11-07', 'FM', 3600); ins.run('800002', '2026-11-07', 'FM', 7200); ins.run('800003', '2026-11-05', 'FM', 5000); ins.run('800004', '2026-10-01', 'FM', 99999);
  let r = (await api(t, U(1), 'GET', '/leaderboard?period=today')).json.data; assert.deepEqual(r.rows.map((x) => x.userId), ['800002', '800001']); assert.equal(r.rows[0].name, 'Diya S.'); assert.equal(r.me.rank, 2);
  r = (await api(t, U(1), 'GET', '/leaderboard?period=week')).json.data; assert.deepEqual(r.rows.map((x) => x.userId), ['800002', '800003', '800001'].sort((a, b) => ({ '800002': 7200, '800003': 5000, '800001': 3600 }[b] - { '800002': 7200, '800003': 5000, '800001': 3600 }[a])));
  r = (await api(t, U(5), 'GET', '/leaderboard?period=all')).json.data; assert.equal(r.rows[0].userId, '800004'); assert.equal(r.me, null); assert.equal(r.students, 4);
  await api(t, U(5), 'POST', '/start?level=intermediate', { subject: 'FM' }); adv(t, 30e3); await api(t, U(5), 'POST', '/beat'); r = (await api(t, U(1), 'GET', '/live')).json.data; assert.equal(r.online, 1); assert.equal(r.students[0].subject, 'FM');
  assert.equal((await api(t, U(1), 'GET', '/leaderboard?period=forever')).status, 400);
  t.close();
});
test('streaks, badges (14), recap and history', async () => {
  const t = await setup(); const a = U(3), id = String(a.id); const ins = t.sqlite.prepare('INSERT INTO study_day(userId,day,subject,seconds) VALUES(?,?,?,?)');
  ins.run(id, '2026-11-05', 'FM', 4000); ins.run(id, '2026-11-06', 'FM', 2000); ins.run(id, '2026-11-06', 'SM', 2000); ins.run(id, '2026-11-07', 'FM', 300); ins.run(id, '2026-10-01', 'FM', 600);
  let s = (await api(t, a, 'GET', '/state?level=intermediate')).json.data; assert.equal(s.streak, 2); // today only 5 min → not counted yet, yesterday+day before count
  let b = (await api(t, a, 'GET', '/badges')).json.data; assert.equal(b.total, 14); assert.equal(b.badges.find((x) => x.id === 'd1').earned, true); assert.equal(b.badges.find((x) => x.id === 's3').earned, false); assert.equal(b.badges.find((x) => x.id === 's3').hint, '1 more days'); assert.equal(b.badges.find((x) => x.id === 'd4').earned, false); assert.equal(b.badges.find((x) => x.id === 'd4').hint, '4h to go' === b.badges.find((x) => x.id === 'd4').hint ? '4h to go' : b.badges.find((x) => x.id === 'd4').hint);
  ins.run(id, '2026-11-07', 'GST', 1800); s = (await api(t, a, 'GET', '/state?level=intermediate')).json.data; assert.equal(s.streak, 3); assert.equal((await api(t, a, 'GET', '/badges')).json.data.badges.find((x) => x.id === 's3').earned, true);
  const w = (await api(t, a, 'GET', '/recap?period=week')).json.data; assert.equal(w.from, '2026-11-02'); assert.equal(w.to, '2026-11-08'); assert.equal(w.daily.length, 7); assert.equal(w.totalSeconds, 4000 + 4000 + 300 + 1800); assert.equal(w.daysActive, 3); assert.equal(w.goalsHit, 0);
  assert.equal(w.subjects[0].name, 'FM'); assert.equal((await api(t, a, 'GET', '/recap?period=month')).json.data.totalSeconds, 10100);
  assert.equal((await api(t, a, 'GET', '/recap?period=all')).json.data.totalSeconds, 10700); assert.equal((await api(t, a, 'GET', '/recap?period=decade')).status, 400);
  assert.equal(Object.keys((await api(t, a, 'GET', '/history?month=2026-11')).json.data.days).length, 3); assert.equal((await api(t, a, 'GET', '/day?day=2026-11-06')).json.data.subjects.length, 2); assert.equal((await api(t, a, 'GET', '/day?day=nope')).status, 400);
  t.close();
});
test('danger zone: clear today / delete all (and mirrored deletes)', async () => {
  const t = await setup(); const a = U(4), id = String(a.id); const ins = t.sqlite.prepare('INSERT INTO study_day(userId,day,subject,seconds) VALUES(?,?,?,?)'); ins.run(id, '2026-11-07', 'FM', 600); ins.run(id, '2026-11-06', 'FM', 600);
  await api(t, a, 'POST', '/clear-today'); assert.equal((await api(t, a, 'GET', '/state?level=intermediate')).json.data.todaySeconds, 0); assert.deepEqual(t.unmirrored.at(-1), ['study_day', `${id}|2026-11-07|FM`]);
  assert.equal((await api(t, a, 'POST', '/delete-all', {})).status, 400); assert.equal((await api(t, a, 'POST', '/delete-all', { confirm: 'DELETE' })).status, 200);
  assert.equal(t.sqlite.prepare('SELECT COUNT(*) c FROM study_day WHERE userId=?').get(id).c, 0); assert.equal((await api(t, a, 'GET', '/badges')).json.data.earned, 0);
  // restore from backup rows
  assert.equal(t.study.restore([{ kind: 'study_day', id: 'x', data: { userId: id, day: '2026-11-01', subject: 'FM', seconds: 90 } }]), 1); t.close();
});
test('groups & chat: official auto-join, create/join by code, messages, replies, rate limit, unread, privacy', async () => {
  const t = await setup(); const a = U(1), b = U(2), c = U(3);
  let g = (await api(t, a, 'GET', '/groups?level=intermediate')).json.data; assert.equal(g.mine[0].name, 'CA Intermediate'); assert.equal(g.public[0].name, 'CA Foundation'); assert.equal(g.mine[0].members, 1);
  const made = (await api(t, a, 'POST', '/groups', { name: 'Night Owls', isPublic: false })).json.data; assert.match(made.code, /^[A-HJKMNP-Z2-9]{6}$/); assert.equal(made.member, true);
  assert.equal((await api(t, b, 'GET', `/groups/${made.id}`)).status, 403); assert.equal((await api(t, b, 'GET', `/groups/${made.id}/messages`)).status, 403); assert.equal((await api(t, b, 'POST', '/groups/join', { code: 'ZZZZZZ' })).status, 404);
  assert.equal((await api(t, b, 'POST', '/groups/join', { code: made.code.toLowerCase() })).status, 200);
  const m1 = (await api(t, a, 'POST', `/groups/${made.id}/messages`, { text: '  Hello <b>all</b>  ' })).json.data.id; assert.equal((await api(t, a, 'POST', `/groups/${made.id}/messages`, { text: 'again' })).status, 429);
  assert.equal((await api(t, b, 'GET', '/groups/unread')).json.data.unread, 1); adv(t, 2000);
  await api(t, b, 'POST', `/groups/${made.id}/messages`, { text: 'Hi!', replyTo: m1 }); let ms = (await api(t, a, 'GET', `/groups/${made.id}/messages`)).json.data; assert.equal(ms.messages.length, 2); assert.equal(ms.messages[0].text, 'Hello <b>all</b>'); assert.equal(ms.messages[1].reply.text, 'Hello <b>all</b>'); assert.equal(ms.messages[0].mine, true);
  assert.equal((await api(t, b, 'GET', '/groups/unread')).json.data.unread, 1); await api(t, b, 'GET', `/groups/${made.id}/messages`); assert.equal((await api(t, b, 'GET', '/groups/unread')).json.data.unread, 0); assert.equal((await api(t, a, 'GET', `/groups/${made.id}/messages?after=${ms.messages[1].id}`)).json.data.messages.length, 0);
  assert.equal(JSON.stringify(ms).includes('username'), false); assert.equal((await api(t, a, 'POST', `/groups/${made.id}/messages`, { text: '   ' })).status, 400);
  assert.equal((await api(t, c, 'POST', `/groups/${'official_foundation'}/join`)).status, 200); assert.equal((await api(t, c, 'POST', '/groups/official_foundation/leave')).status, 400);
  assert.equal((await api(t, b, 'POST', `/groups/${made.id}/leave`)).status, 200); assert.equal((await api(t, b, 'GET', `/groups/${made.id}/messages`)).status, 403);
  for (let i = 0; i < 3; i++) await api(t, c, 'POST', '/groups', { name: 'G' + i }); assert.equal((await api(t, c, 'POST', '/groups', { name: 'G4' })).status, 400);
  const info = (await api(t, a, 'GET', `/groups/${made.id}`)).json.data; assert.equal(info.members, 1); assert.ok(Array.isArray(info.leaderboard)); t.close();
});
test('banned students are locked out of study APIs', async () => {
  const t = await setup(); await t.call(owner, 'POST', '/api/admin/students/800005/block', { reason: 'x' }); assert.equal((await api(t, U(5), 'GET', '/state')).status, 403); t.close();
});
test('admin study tracker: overview, live, groups moderation with RBAC', async () => {
  const t = await setup(); const a = U(1); await api(t, a, 'POST', '/start?level=intermediate', { subject: 'FM' }); adv(t, 45e3); await api(t, a, 'POST', '/beat');
  const g = (await api(t, a, 'POST', '/groups', { name: 'Study Club', isPublic: true })).json.data; await api(t, a, 'POST', `/groups/${g.id}/messages`, { text: 'bad message' });
  let o = (await t.call(owner, 'GET', '/api/admin/study/overview')).json.data; assert.equal(o.liveNow, 1); assert.equal(o.groups >= 1, true); assert.equal(o.trend.length, 14); assert.equal(o.messagesTotal, 1);
  assert.equal((await t.call(owner, 'GET', '/api/admin/study/live')).json.data.students[0].subject, 'FM');
  const msgs = (await t.call(owner, 'GET', `/api/admin/study/groups/${g.id}/messages`)).json.data.messages; assert.equal(msgs.length, 1);
  await t.call(owner, 'POST', '/api/admin/admins', { userId: '200010', role: 'support' }); await t.call(owner, 'POST', '/api/admin/admins', { userId: '200011', role: 'moderator' });
  const sup = { id: 200010, first_name: 'S' }, mod = { id: 200011, first_name: 'M' };
  assert.equal((await t.call(sup, 'GET', '/api/admin/study/overview')).status, 200); assert.equal((await t.call(sup, 'DELETE', `/api/admin/study/groups/${g.id}/messages/${msgs[0].id}`)).status, 403);
  assert.equal((await t.call(mod, 'DELETE', `/api/admin/study/groups/${g.id}/messages/${msgs[0].id}`)).status, 200); assert.equal((await t.call(mod, 'DELETE', `/api/admin/study/groups/${g.id}/members/${a.id}`)).status, 200);
  await api(t, a, 'GET', '/groups?level=intermediate'); assert.equal((await t.call(owner, 'DELETE', '/api/admin/study/groups/official_intermediate')).status, 400); assert.equal((await t.call(owner, 'DELETE', `/api/admin/study/groups/${g.id}`)).status, 200);
  assert.equal((await t.call(owner, 'GET', `/api/admin/students/${a.id}/study`)).status, 200); assert.equal((await t.call(mod, 'POST', `/api/admin/students/${a.id}/study/reset`)).status, 200);
  assert.ok((await t.call(owner, 'GET', '/api/admin/logs?action=study')).json.data.total >= 3); t.close();
});

test('recap can be sent to the student on Telegram (escaped, own chat only)', async () => {
  const t = await setup(); const a = U(1); t.sqlite.prepare('INSERT INTO study_day(userId,day,subject,seconds) VALUES(?,?,?,?)').run(String(a.id), '2026-11-07', '<i>FM</i>', 5400);
  const r = await api(t, a, 'POST', '/recap/send', { period: 'week' }); assert.equal(r.status, 200); assert.equal(t.sent.length, 1); assert.equal(t.sent[0][0], String(a.id)); assert.match(t.sent[0][1], /1h 30m/); assert.ok(t.sent[0][1].includes('&lt;i&gt;FM')); t.close();
});
