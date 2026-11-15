'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { boot, owner, closeAll } = require('./helpers'); test.afterEach(closeAll);
const own = { id: String(owner.id), name: 'o', role: 'super_admin', perms: new Set(['*']) };
const A = '/api/admin'; const d = (r) => r.json.data || r.json;

test('multi-account: same device alerts the owner once; admin list shows it; staff and toggle respected', async () => {
  const t = await boot(); const a = t.user(11, 'Asha'), b = t.user(12, 'Ben'), c = t.user(13, 'Cy'); for (const u of [a, b, c]) await t.reg(u);
  t.tg.clear(); let r = await t.call(a, 'POST', '/api/app/device-check', { fingerprint: 'abcdef0123456789' }, { 'x-forwarded-for': '1.1.1.1' }); assert.equal(r.status, 200); assert.equal(t.tg.of('sendMessage').filter((m) => /Multi-Account/.test(m.text || '')).length, 0);
  await t.call(b, 'POST', '/api/app/device-check', { fingerprint: 'abcdef0123456789' }, { 'x-forwarded-for': '2.2.2.2' }); let al = t.tg.of('sendMessage').filter((m) => /Possible Multi-Account/.test(m.text || '')); assert.equal(al.length, 1); assert.match(al[0].text, /Same Device/); assert.match(al[0].text, /11/);
  await t.call(b, 'POST', '/api/app/device-check', { fingerprint: 'abcdef0123456789' }, { 'x-forwarded-for': '2.2.2.2' }); assert.equal(t.tg.of('sendMessage').filter((m) => /Possible Multi-Account/.test(m.text || '')).length, 1);
  await t.call(c, 'POST', '/api/app/device-check', { fingerprint: 'zzzzzz999999' }, { 'x-forwarded-for': '1.1.1.1' }); al = t.tg.of('sendMessage').filter((m) => /Possible Multi-Account/.test(m.text || '')); assert.equal(al.length, 2); assert.match(al[1].text, /Same IP/);
  const fl = d(await t.call(owner, 'GET', `${A}/devices/flags`)); assert.ok(fl.some((x) => x.kind === 'device') && fl.some((x) => x.kind === 'ip'));
  t.app.service.config.set(own, { deviceAlerts: false }); const e = t.user(14, 'Eve'); await t.reg(e); t.tg.clear(); await t.call(e, 'POST', '/api/app/device-check', { fingerprint: 'abcdef0123456789' }); assert.equal(t.tg.of('sendMessage').filter((m) => /Multi-Account/.test(m.text || '')).length, 0);
  assert.equal((await t.call(a, 'POST', '/api/app/device-check', { fingerprint: 'x' })).json.data.ok, false);
});

test('ban: /ban with reason, banned list, API gate carries reason, unban notifies', async () => {
  const t = await boot(); const u = t.user(21, 'Bad'); await t.reg(u); const id = String(u.id); t.tg.clear();
  await t.say(owner, `/ban ${id} Multiple accounts`); assert.match(t.tg.of('sendMessage').map((m) => m.text).join('|'), /Banned/); assert.equal(t.app.db.ban.findOne(id).reason, 'Multiple accounts');
  assert.ok(t.tg.of('sendMessage').some((m) => String(m.chat_id) === id && /banned/i.test(m.text) && /Multiple accounts/.test(m.text)));
  const r = await t.call(u, 'GET', '/api/app/me'); assert.equal(r.status, 403); assert.equal(r.json.banned, true); assert.equal(r.json.reason, 'Multiple accounts');
  t.tg.clear(); await t.say(owner, '/banned'); assert.match(t.tg.last('sendMessage').text, /Multiple accounts/); assert.match(t.tg.last('sendMessage').text, new RegExp(id));
  await t.say(owner, `/unban ${id}`); assert.equal(t.app.db.ban.isBanned(id), false); assert.ok(t.tg.of('sendMessage').some((m) => String(m.chat_id) === id && /restored/.test(m.text)));
  await t.say(owner, '/ban 990099'); assert.equal(t.app.db.ban.findOne('990099').reason, 'Banned by admin');
});

test('ban removes still-visible delivered lectures of that student', async () => {
  const t = await boot(); const u = t.user(31, 'Del'); await t.reg(u); const id = String(u.id); t.app.db.q('INSERT INTO autodel(chatId,msgId,at) VALUES(?,?,?)').run(id, 555, Date.now() + 1e7); t.tg.clear();
  await t.say(owner, `/ban ${id} test`); await new Promise((r) => setTimeout(r, 100)); assert.ok(t.tg.of('deleteMessage').some((m) => String(m.chat_id) === id && m.message_id === 555)); assert.equal(t.app.db.q('SELECT COUNT(*) n FROM autodel WHERE chatId=?').get(id).n, 0);
});

test('remove-words: /rmword list/add/del/clear, names cleaned at upload, in captions and for existing names', async () => {
  const C = (await boot()).app.content;
  assert.equal(C.stripWords('@MyChannel Lecture 5 www.site.com', ['@mychannel', 'www.site.com']), 'Lecture 5');
  assert.equal(C.suggestName('Lec 3 - @Chan.mp4', '', { words: ['@Chan'] }), 'Lec 3');
  assert.equal(C.suggestName('file name.mp4', 'My caption', { prefer: 'filename' }), 'file name'); assert.equal(C.suggestName('file name.mp4', 'My caption', {}), 'My caption'); assert.equal(C.suggestName('', 'Only caption', { prefer: 'filename' }), 'Only caption');
  const t = await boot(); await t.say(owner, '/rmword list'); assert.match(t.tg.last('sendMessage').text, /No words/); await t.say(owner, "/rmword '@MyChannel'"); assert.deepEqual(t.app.service.config.get().removeWords, ['@MyChannel']);
  await t.say(owner, '/rmword www.x.com'); await t.say(owner, '/rmword list'); assert.match(t.tg.last('sendMessage').text, /@MyChannel/); await t.say(owner, '/rmword del @mychannel'); assert.deepEqual(t.app.service.config.get().removeWords, ['www.x.com']); await t.say(owner, '/rmword clear'); assert.deepEqual(t.app.service.config.get().removeWords, []);
  // admin config + clean existing
  const S = t.app.service; const Ct = t.app.content; const sub = S.subject.create(own, { name: 'Acc', level: 'foundation', icon: '📘', color: '#112233' }); const f = S.faculty.create(own, { name: 'F Sir', institute: 'PW' });
  const bid = d(await t.call(owner, 'POST', `${A}/subjects/${sub.id}/teachers`, { facultyId: f.id })).batchId; const sid = t.app.db.batch.getOne(bid).subjects[0]._id; const ch = Ct.addChapter(bid, sid, 'Ch');
  Ct.addLecture(bid, sid, ch._id, { name: 'Intro @Spam', channelMsgId: 5, duration: 60, fid: 'f1' });
  assert.equal((await t.call(owner, 'PATCH', `${A}/config`, { removeWords: '@Spam\nwww.junk.com\n@spam', nameSource: 'filename' })).status, 200); assert.deepEqual(S.config.get().removeWords, ['@Spam', 'www.junk.com']); assert.equal(S.config.get().nameSource, 'filename');
  assert.equal((await t.call(owner, 'PATCH', `${A}/config`, { nameSource: 'nope' })).status, 400);
  const r = d(await t.call(owner, 'POST', `${A}/content/clean-names`, {})); assert.equal(r.renamed, 1); assert.equal(Ct.lectureAt(ch._id, 1).name, 'Intro');
});

test('broadcast: reply to a media message copies it to every student (with --pin); banned skipped; text still previews', async () => {
  const t = await boot(); const a = t.user(41, 'A'), b = t.user(42, 'B'); await t.reg(a); await t.reg(b); t.app.db.ban.ban({ userId: String(b.id), reason: 'x', bannedBy: '1' }); t.tg.clear();
  await t.send(owner, { message_id: 900, chat: { id: owner.id, type: 'private' }, from: owner, text: '/broadcast --pin', reply_to_message: { message_id: 800, chat: { id: owner.id }, photo: [{ file_id: 'p1' }], caption: 'Hi' } });
  assert.match(t.tg.last('sendMessage').text, /copied to <b>\d+<\/b>/); await t.press(owner, 'bcs'); await new Promise((r) => setTimeout(r, 200));
  const cp = t.tg.of('copyMessage').filter((m) => String(m.chat_id) !== String(owner.id)); assert.equal(cp.length, 1); assert.equal(String(cp[0].chat_id), String(a.id)); assert.equal(cp[0].message_id, 800); assert.ok(t.tg.of('pinChatMessage').some((m) => String(m.chat_id) === String(a.id)));
  t.tg.clear(); await t.say(owner, '/broadcast Exam update\nTest on Sunday'); assert.match(t.tg.last('sendMessage').text, /Broadcast preview/);
});

test('planner: deleted lectures disappear from the plan; new plans start with reminders ON', async () => {
  const START = Date.UTC(2026, 10, 6, 4, 0, 0); const H = 3600; const t = await boot({ start: START }); const bid = t.add('Plan batch', 'foundation', ['Accounts']); const b = t.app.db.batch.getOne(bid); const s0 = b.subjects[0]; const c = t.app.content.addChapter(bid, s0._id, 'Basics');
  const l1 = t.app.content.addLecture(bid, s0._id, c._id, { name: 'L1', duration: 2 * H, channelMsgId: 5, fid: 'a' }); t.app.content.addLecture(bid, s0._id, c._id, { name: 'L2', duration: 2 * H, channelMsgId: 6, fid: 'b' });
  const u = await t.reg(t.user(61)); const id = String(u.id); const plan = t.app.planner.create(id, { level: 'foundation', subjects: [{ batchId: bid, subjectId: s0._id, finished: [] }], startDate: '2026-11-06', dailyHours: 4, mode: 'mixed', perDay: 1, examMonth: 'September 2027' });
  assert.equal(plan.reminders.daily, true); assert.equal(plan.reminders.newLectures, true); assert.equal(plan.reminders.at, new Date(START + 330 * 60000).toISOString().slice(11, 16)); assert.equal(t.app.planner.get(id).count, 2);
  t.app.content.deleteLecture(l1._id); const g = t.app.planner.get(id); assert.equal(g.count, 1); assert.ok(!JSON.stringify(g.days).includes(l1._id)); assert.equal(t.app.planner.behind(id).count, 0);
});

test('upload panel: mode buttons (Auto / Lectures only / Notes), live burst progress, lectures-only skips notes', async () => {
  const t = await boot(); const bid = t.add('Hardik Sep 2026', 'foundation', ['Accounts']); let mid = 7000;
  const video = (d, cap) => ({ message_id: ++mid, chat: { id: owner.id, type: 'private' }, from: owner, video: { file_id: 'v' + mid, file_unique_id: 'u' + mid, duration: d }, caption: cap });
  const pdf = (n) => ({ message_id: ++mid, chat: { id: owner.id, type: 'private' }, from: owner, document: { file_id: 'd' + mid, file_unique_id: 'ud' + mid, file_name: n, mime_type: 'application/pdf' } });
  await t.say(owner, '/upload'); await t.press(owner, 'wl:0'); await t.press(owner, 'ws:0'); await t.press(owner, 'wf:0'); await t.press(owner, 'un'); await t.say(owner, 'Ch One');
  const kbs = JSON.stringify(t.tg.last('sendMessage').reply_markup); assert.match(kbs, /"ma"/); assert.match(kbs, /"ml"/); assert.match(kbs, /"mn"/); assert.match(t.tg.last('sendMessage').text, /auto — videos → lectures, everything else → notes/);
  await t.press(owner, 'ml'); assert.match(t.tg.last('editMessageText').text, /lectures only/); t.tg.clear(); await t.send(owner, pdf('a.pdf')); assert.match(t.tg.last('sendMessage').text, /Lectures only/); assert.equal(t.tg.of('copyMessage').length, 0);
  await t.press(owner, 'ma'); await t.send(owner, pdf('Notes.pdf')); assert.equal(t.tg.of('copyMessage').length, 1);
  // burst: several files at once → panel shows progress while queued
  t.tg.clear(); const ps = [video(100, 'Lecture 1'), video(110, 'Lecture 2'), video(120, 'Lecture 3')].map((m) => t.send(owner, m)); await Promise.all(ps);
  const eds = t.tg.of('editMessageText').map((m) => m.text); assert.ok(eds.some((x) => /Uploading \d of 3/.test(x)), 'live progress shown'); assert.match(eds[eds.length - 1], /Lectures: <b>3<\/b>/); assert.ok(!/Uploading/.test(eds[eds.length - 1]));
});
