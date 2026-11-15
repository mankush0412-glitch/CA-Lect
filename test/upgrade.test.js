'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { boot, OWNER, closeAll } = require('./helpers'); test.afterEach(closeAll);
const own = { id: String(OWNER), name: 'o', role: 'super_admin', perms: new Set(['*']) };
const START = Date.UTC(2026, 10, 6, 4, 0, 0); const H = 3600;
function build(t, n = 3, dur = H) { const bid = t.add('Upg batch', 'foundation', ['Accounts']); const b = t.app.db.batch.getOne(bid); const s = b.subjects[0]; const c = t.app.content.addChapter(bid, s._id, 'Basics'); const ls = []; for (let i = 0; i < n; i++) ls.push(t.app.content.addLecture(bid, s._id, c._id, { name: 'Lecture ' + (i + 1), duration: dur, channelMsgId: 100 + i })); t.app.content.addNote(bid, s._id, c._id, { name: 'Notes.pdf', channelMsgId: 200 }); return { bid, sid: s._id, cid: c._id, ls: ls.map((l) => l._id) }; }
const claim = async (t, u, sid) => { const s = await t.call(u, 'POST', '/api/app/ad/start', { serverId: sid }); assert.equal(s.status, 200); t.clock.t += 61000; const c = await t.call(u, 'POST', '/api/app/ad/claim', { token: s.json.data.token }); assert.equal(c.status, 200); return c.json.data; };

test('download ads give save quota; saved lectures are sent without protect_content', async () => {
  const t = await boot({ start: START }); const x = build(t); const u = await t.reg(t.user(1)); const id = String(u.id); t.app.access.grantHours(id, 5);
  t.app.service.config.set(own, { minAdSeconds: 1 }); const srv = t.app.access.adminServers.save({ name: 'Save Lectures', url: 'https://ads.example/s', type: 'downloads', extraDownloads: 2, perDay: 1 }); assert.equal(srv.extraDownloads, 2);
  let st = (await t.call(u, 'GET', '/api/app/access')).json.data; assert.equal(st.downloadServers.length, 1); assert.equal(st.usage.downloadsLeft, 0);
  let r = await t.call(u, 'POST', '/api/app/lectures/send', { ids: [x.ls[0]], save: true }); assert.equal(r.status, 429); // no quota yet
  t.tg.clear(); r = await t.call(u, 'POST', '/api/app/lectures/send', { ids: [x.ls[0]] }); assert.equal(r.status, 200); assert.equal(t.tg.last('copyMessage').protect_content, true);
  st = await claim(t, u, srv.id); assert.equal(st.usage.downloadsLeft, 2);
  t.tg.clear(); r = await t.call(u, 'POST', '/api/app/lectures/send', { ids: [x.ls[1], x.ls[2]], save: true }); assert.equal(r.status, 200); assert.equal(r.json.data.sent, 2); assert.ok(t.tg.of('copyMessage').every((c) => !c.protect_content));
  assert.equal(r.json.data.quota.downloadsLeft, 0); assert.equal((await t.call(u, 'POST', '/api/app/lectures/send', { ids: [x.ls[0]], save: true, force: true })).status, 429);
  const bad = await t.call({ id: 1000, first_name: 'Owner' }, 'POST', '/api/admin/adservers', { name: 'x', url: 'https://a.b', type: 'weird' }); assert.equal(bad.status, 400);
});

test('rankings and live are course-wise', async () => {
  const t = await boot({ start: START }); const a = await t.reg(t.user(1, 'Asha')); const b = await t.reg(t.user(2, 'Bala')); t.app.db.user.setLevel(String(a.id), 'foundation'); t.app.db.user.setLevel(String(b.id), 'intermediate');
  const sq = t.app.db.sqlite; const day = '2026-11-06'; sq.prepare('INSERT INTO study_day(userId,day,subject,seconds) VALUES(?,?,?,?)').run(String(a.id), day, 'Accounts', 3600); sq.prepare('INSERT INTO study_day(userId,day,subject,seconds) VALUES(?,?,?,?)').run(String(b.id), day, 'FM', 7200);
  let r = (await t.call(a, 'GET', '/api/study/leaderboard?period=today&level=foundation')).json.data; assert.equal(r.students, 1); assert.equal(r.rows[0].seconds, 3600);
  r = (await t.call(b, 'GET', '/api/study/leaderboard?period=today&level=intermediate')).json.data; assert.equal(r.students, 1); assert.equal(r.rows[0].seconds, 7200);
  await t.call(a, 'POST', '/api/study/start?level=foundation', { subject: 'Accounts' }); await t.call(b, 'POST', '/api/study/start?level=intermediate', { subject: 'FM' });
  assert.equal((await t.call(a, 'GET', '/api/study/live?level=foundation')).json.data.online, 1); assert.equal((await t.call(b, 'GET', '/api/study/live?level=intermediate')).json.data.online, 1);
});

test('planner: useHours keeps the chosen hours, reports days late and the hours needed; behind lists missed lectures', async () => {
  const t = await boot({ start: START }); const x = build(t, 8, H); const u = await t.reg(t.user(1)); const id = String(u.id);
  const body = { level: 'foundation', subjects: [{ batchId: x.bid, subjectId: x.sid, finished: [] }], startDate: '2026-11-06', dailyHours: 2, mode: 'mixed', perDay: 1, examMonth: 'September 2027', finishBy: '2026-11-08', useHours: true };
  const p = (await t.call(u, 'POST', '/api/app/plan/preview', body)).json.data; assert.equal(p.hoursPerDay, 2); assert.equal(p.recommended, 2.7); assert.ok(p.daysLate > 0); assert.equal(p.feasible, true);
  assert.equal((await t.call(u, 'POST', '/api/app/plan', body)).status, 200); // allowed: student chose to finish later
  t.clock.t += 2 * 864e5; const v = (await t.call(u, 'GET', '/api/app/plan')).json.data.plan; assert.ok(v.behind.count > 0); assert.equal(v.behind.days[0].items[0].chapter, 'Basics'); assert.equal(v.behind.count, t.app.planner.behind(id).count);
});

test('reminder buttons send the day\'s lectures and notes into the chat', async () => {
  const t = await boot({ start: START }); const x = build(t, 2, H); const u = await t.reg(t.user(1)); const id = String(u.id); t.app.access.grantHours(id, 5);
  await t.call(u, 'POST', '/api/app/plan', { level: 'foundation', subjects: [{ batchId: x.bid, subjectId: x.sid, finished: [] }], startDate: '2026-11-06', dailyHours: 4, mode: 'mixed', perDay: 1, examMonth: 'September 2027' });
  await t.call(u, 'PATCH', '/api/app/plan/reminders', { daily: true, at: '09:30' }); t.tg.clear(); await t.app.bot.tick(); const kb = t.tg.last('sendMessage').reply_markup.inline_keyboard;
  t.tg.clear(); await t.press(u, kb[0][0].callback_data); assert.equal(t.tg.of('copyMessage').length, 2); assert.match(t.tg.last('sendMessage').text, /Sent 2 lectures/);
  t.tg.clear(); await t.press(u, kb[1][0].callback_data); assert.equal(t.tg.of('copyMessage').length, 1); assert.match(t.tg.last('sendMessage').text, /Sent 1 note/);
});

test('upload status panel is re-sent at the bottom once the flow is quiet', async () => {
  const t = await boot({ realtime: true }); const { owner } = require('./helpers'); const x = build(t, 0); t.app.db.batch.getOne(x.bid);
  await t.say(owner, '/upload'); await t.press(owner, 'ub:0'); await t.press(owner, 'us:0'); await t.press(owner, 'uh:0'); const s = t.app.bot.sessions.get(String(owner.id)); assert.ok(s && s.statusId);
  const first = s.statusId; t.tg.clear(); await t.send(owner, { video: { file_id: 'v', duration: 600, file_size: 10 }, caption: 'Lec' }); await new Promise((r) => setTimeout(r, 2900));
  assert.notEqual(s.statusId, first); assert.ok(t.tg.of('deleteMessage').some((d) => d.message_id === first)); assert.match(t.tg.last('sendMessage').text, /Upload in progress/);
});

test('recap image renders as a valid PNG and is sent as a photo', async () => {
  const { renderRecap } = require('../src/recap-image'); const png = renderRecap({ period: 'week', label: '2026-11-02 → 2026-11-08', totalSeconds: 5400, daysActive: 2, daysInRange: 7, avgSeconds: 770, goalsHit: 1, daily: [{ day: '2026-11-02', seconds: 3600 }, { day: '2026-11-03', seconds: 1800 }], subjects: [{ name: 'FM', seconds: 5400 }] }, { brand: 'StudyMate', name: 'Riya S.' });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]); assert.equal(png.readUInt32BE(16), 900); assert.ok(png.length > 2000);
});

test('config exposes Test Series + Pro-tip flags to the app', async () => {
  const t = await boot({ start: START }); const u = await t.reg(t.user(1)); t.app.service.config.set(own, { testSeriesUrl: 'https://tests.example/x', testSeriesEnabled: true });
  const me = (await t.call(u, 'GET', '/api/app/me')).json.data; assert.equal(me.config.testSeriesUrl, 'https://tests.example/x'); assert.equal(me.config.testSeriesEnabled, true); assert.equal(me.config.proTip, true);
});

test('student catalog shows newly added batch + faculty immediately (published by default in the admin form)', async () => {
  const t = await boot({ start: START }); const u = await t.reg(t.user(1)); const fid = t.app.service.faculty.create(own, { name: 'CA New Teacher' }).id;
  const b = t.app.service.batch.create(own, { name: 'Fresh batch', level: 'foundation', isPublic: true, status: 'active', facultyId: fid, label: 'Jan 2027' }); t.app.content.addSubject(b.id, { name: 'Accounts' });
  const tree = (await t.call(u, 'GET', '/api/app/tree?level=foundation')).json.data; const acc = tree.subjects.find((s) => s.name === 'Accounts'); assert.ok(acc.faculties.some((f) => f.name === 'CA New Teacher' && f.batches.some((x) => x.label === 'Jan 2027')));
  const sid = t.app.db.batch.getOne(b.id).subjects[0]._id; const view = (await t.call(u, 'GET', `/api/app/batch/${b.id}/${sid}`)).json.data; assert.equal(view.faculty.name, 'CA New Teacher');
});
