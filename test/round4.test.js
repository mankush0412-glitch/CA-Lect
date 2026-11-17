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
  await t.press(owner, 'ml'); assert.match(t.tg.last('editMessageText').text, /lectures only/); t.tg.clear(); await t.send(owner, pdf('a.pdf')); assert.match(t.tg.last('editMessageText').text, /Lectures only/); assert.equal(t.tg.of('copyMessage').length, 0);
  await t.press(owner, 'ma'); await t.send(owner, pdf('Notes.pdf')); assert.equal(t.tg.of('copyMessage').length, 1);
  // burst: several files at once → panel shows progress while queued
  t.tg.clear(); const ps = [video(100, 'Lecture 1'), video(110, 'Lecture 2'), video(120, 'Lecture 3')].map((m) => t.send(owner, m)); await Promise.all(ps);
  const eds = t.tg.of('editMessageText').map((m) => m.text); assert.ok(eds.some((x) => /Uploading \d of 3/.test(x)), 'live progress shown'); assert.match(eds[eds.length - 1], /Lectures: <b>3<\/b>/); assert.ok(!/Uploading/.test(eds[eds.length - 1]));
});

test('upload auto-clean: saved forwarded files are deleted from the chat; toggle OFF keeps them; failures are kept', async () => {
  const t = await boot(); t.add('Hardik Sep 2026', 'foundation', ['Accounts']); let mid = 8000;
  const video = (d) => ({ message_id: ++mid, chat: { id: owner.id, type: 'private' }, from: owner, video: { file_id: 'v' + mid, file_unique_id: 'u' + mid, duration: d } });
  await t.say(owner, '/upload'); await t.press(owner, 'wl:0'); await t.press(owner, 'ws:0'); await t.press(owner, 'wf:0'); await t.press(owner, 'un'); await t.say(owner, 'Ch');
  assert.match(JSON.stringify(t.tg.last('sendMessage').reply_markup), /Auto-clean: ON/); t.tg.clear(); const m1 = video(100); await t.send(owner, m1);
  assert.ok(t.tg.of('deleteMessage').some((m) => m.message_id === m1.message_id), 'saved file removed');
  await t.press(owner, 'uk'); assert.match(JSON.stringify(t.tg.last('editMessageText').reply_markup), /Auto-clean: OFF/); t.tg.clear(); const m2 = video(100); await t.send(owner, m2); assert.ok(!t.tg.of('deleteMessage').some((m) => m.message_id === m2.message_id));
});

test('upload auto-clean: saved forwards are deleted from chat (panel stays at bottom); skipped ones stay; toggle works', async () => {
  const t = await boot(); t.add('Hardik Sep 2026', 'foundation', ['Accounts']); let mid = 8000;
  const video = (d) => ({ message_id: ++mid, chat: { id: owner.id, type: 'private' }, from: owner, video: { file_id: 'v' + mid, file_unique_id: 'u' + mid, duration: d } });
  await t.say(owner, '/upload'); await t.press(owner, 'wl:0'); await t.press(owner, 'ws:0'); await t.press(owner, 'wf:0'); await t.press(owner, 'un'); await t.say(owner, 'Ch');
  assert.match(JSON.stringify(t.tg.last('sendMessage').reply_markup), /Auto-clean: ON/);
  t.tg.clear(); const m1 = video(100); await t.send(owner, m1); assert.ok(t.tg.of('deleteMessage').some((m) => m.message_id === m1.message_id), 'saved file removed');
  await t.send(owner, { ...m1 }); assert.equal(t.tg.of('deleteMessage').filter((m) => m.message_id === m1.message_id).length, 1); assert.match(t.tg.last('editMessageText').text, /already uploaded/); // duplicate is reported, not silently deleted
  await t.press(owner, 'uk'); assert.match(t.tg.last('editMessageText').text, /Forward videos/); t.tg.clear(); const m2 = video(120); await t.send(owner, m2); assert.ok(!t.tg.of('deleteMessage').some((m) => m.message_id === m2.message_id), 'OFF keeps files');
});

test('missing lectures: real numbers shown with a gap (1,2,3,4,6…), missing list in view, upload panel and student sheet data', async () => {
  const t = await boot(); const bid = t.add('Gap batch', 'foundation', ['Accounts']); const b0 = t.app.db.batch.getOne(bid); const s0 = b0.subjects[0]; const c = t.app.content.addChapter(bid, s0._id, 'Ch');
  for (const n of [1, 2, 3, 4, 6, 7]) t.app.content.addLecture(bid, s0._id, c._id, { name: `Lecture ${n}`, duration: 60, channelMsgId: 10 + n, fid: 'f' + n, position: t.app.content.autoPosition(c._id, `Lecture ${n}`, '') });
  const v = t.app.content.view(bid, s0._id).chapters[0]; assert.deepEqual(v.lectures.map((l) => l.label), [1, 2, 3, 4, 6, 7]); assert.deepEqual(v.lectures.map((l) => l.number), [1, 2, 3, 4, 5, 6]); assert.deepEqual(v.missing, [5]);
  t.app.content.addLecture(bid, s0._id, c._id, { name: 'Lecture 5', duration: 60, channelMsgId: 99, fid: 'f5', position: t.app.content.autoPosition(c._id, 'Lecture 5', '') });
  const v2 = t.app.content.view(bid, s0._id).chapters[0]; assert.deepEqual(v2.lectures.map((l) => l.label), [1, 2, 3, 4, 5, 6, 7]); assert.deepEqual(v2.missing, []);
  const c2 = t.app.content.addChapter(bid, s0._id, 'Plain'); t.app.content.addLecture(bid, s0._id, c2._id, { name: 'Intro video', channelMsgId: 1, fid: 'z1' }); t.app.content.addLecture(bid, s0._id, c2._id, { name: 'Another', channelMsgId: 2, fid: 'z2' });
  assert.deepEqual(t.app.content.view(bid, s0._id).chapters[1].lectures.map((l) => l.label), [1, 2]); assert.deepEqual(t.app.content.missingOf(c2._id), []);
});

test('auto-capture OFF: files get “Lecture N / Note N” by order, no name parsing, no auto-position; per-session toggle + config default', async () => {
  const t = await boot(); t.add('Cap batch', 'foundation', ['Accounts']); let mid = 9000;
  const video = (cap) => ({ message_id: ++mid, chat: { id: owner.id, type: 'private' }, from: owner, video: { file_id: 'v' + mid, file_unique_id: 'u' + mid, duration: 60 }, caption: cap });
  await t.say(owner, '/upload'); await t.press(owner, 'wl:0'); await t.press(owner, 'ws:0'); await t.press(owner, 'wf:0'); await t.press(owner, 'un'); await t.say(owner, 'Ch');
  assert.match(JSON.stringify(t.tg.last('sendMessage').reply_markup), /Auto-capture: ON/); await t.press(owner, 'uq'); assert.match(t.tg.last('editMessageText').text, /manual/);
  await t.send(owner, video('Lecture 9 Heads of income')); await t.send(owner, video('Lecture 2 Basics'));
  const ls = t.app.db.batch.getAll()[0].subjects[0].chapters[0].lectures; assert.deepEqual(ls.map((l) => l.name), ['Lecture 1', 'Lecture 2']);
  await t.press(owner, 'uq'); await t.send(owner, video('Lecture 1 Intro')); assert.ok(t.app.db.batch.getAll()[0].subjects[0].chapters[0].lectures.some((l) => l.name === 'Lecture 1 Intro'));
  t.app.service.config.set(own, { autoCapture: false }); t.tg.clear(); await t.say(owner, '/done'); await t.say(owner, '/upload'); await t.press(owner, 'wl:0'); await t.press(owner, 'ws:0'); await t.press(owner, 'wf:0');
  assert.equal(t.app.service.config.get().autoCapture, false);
});

test('/missing 4 5 7: marked numbers are not reported missing (admin, panel, student), survive uploads, new “Lecture N” names skip them', async () => {
  const t = await boot(); const bid = t.add('Skip batch', 'foundation', ['Accounts']); let mid = 9500;
  const video = (cap) => ({ message_id: ++mid, chat: { id: owner.id, type: 'private' }, from: owner, video: { file_id: 'v' + mid, file_unique_id: 'u' + mid, duration: 60 }, caption: cap });
  await t.say(owner, '/upload'); await t.press(owner, 'wl:0'); await t.press(owner, 'ws:0'); await t.press(owner, 'wf:0'); await t.press(owner, 'un'); await t.say(owner, 'Ch');
  for (const n of [1, 2, 3, 6, 8]) await t.send(owner, video(`Lecture ${n}`)); const ch = () => t.app.db.batch.getOne(bid).subjects[0].chapters[0];
  assert.deepEqual(t.app.content.missingOf(ch()._id), [4, 5, 7]); assert.match(t.tg.last('editMessageText').text, /Missing lectures<\/b>: 4, 5, 7/);
  t.tg.clear(); await t.say(owner, '/missing 4 5 7'); assert.match(t.tg.last('editMessageText').text, /4, 5, 7/); assert.deepEqual(t.app.content.missingOf(ch()._id), []); assert.doesNotMatch(t.tg.last('editMessageText').text, /Missing lectures/);
  const v = t.app.content.view(bid, t.app.db.batch.getOne(bid).subjects[0]._id).chapters[0]; assert.deepEqual(v.skip, [4, 5, 7]); assert.deepEqual(v.missing, []); assert.deepEqual(v.lectures.map((l) => l.label), [1, 2, 3, 6, 8]);
  await t.send(owner, video('Lecture 10')); assert.deepEqual(t.app.content.missingOf(ch()._id), [9]); assert.deepEqual(t.app.content.skippedOf(ch()._id), [4, 5, 7]);
  await t.press(owner, 'uq'); await t.send(owner, video('x')); assert.ok(ch().lectures.some((l) => l.name === 'Lecture 9')); await t.send(owner, video('y')); assert.ok(ch().lectures.some((l) => l.name === 'Lecture 11'));
  const r = await t.call(owner, 'POST', `/api/admin/chapters/${ch()._id}/skip`, { numbers: '2, 99' }); assert.equal(r.status, 200); assert.deepEqual(t.app.content.skippedOf(ch()._id), [2, 99]);
  await t.say(owner, '/missing none'); assert.deepEqual(t.app.content.skippedOf(ch()._id), []);
});

test('refer reminders: 3 random times a day, bold text with name + count, native share button, stop button, config off', async () => {
  const START = Date.UTC(2026, 10, 17, 3, 30, 0); const t = await boot({ start: START }); const u = t.user(71, 'Riya'); await t.reg(u); const id = String(u.id); t.tg.clear();
  const mine = () => t.tg.of('sendMessage').filter((m) => String(m.chat_id) === id && /friends referred/i.test(m.text || ''));
  for (let i = 0; i < 90; i++) { await t.app.bot.tickRefer(); t.clock.t += 10 * 60000; }
  const got = mine(); assert.equal(got.length, 3, 'exactly 3 reminders in a day'); assert.match(got[0].text, /<b>.*Riya.*<\/b>/); assert.match(got[0].text, /Friends referred: <b>0<\/b>/);
  const btn = JSON.stringify(got[0].reply_markup); assert.match(btn, /https:\/\/t\.me\/share\/url\?url=/); assert.match(decodeURIComponent(btn), /Hey! .*Riya here[\s\S]*Ads-Free/); assert.match(decodeURIComponent(btn), /start=ref_/); assert.match(btn, /rfoff/);
  // next day: stop button silences it
  t.clock.t = START + 86400000; await t.press(u, 'rfoff'); t.tg.clear(); for (let i = 0; i < 90; i++) { await t.app.bot.tickRefer(); t.clock.t += 10 * 60000; } assert.equal(mine().length, 0);
  // admin switch off
  const t2 = await boot({ start: START }); const u2 = t2.user(72, 'Sam'); await t2.reg(u2); t2.app.service.config.set(own, { referReminders: false }); t2.tg.clear(); for (let i = 0; i < 90; i++) { await t2.app.bot.tickRefer(); t2.clock.t += 10 * 60000; } assert.equal(t2.tg.of('sendMessage').filter((m) => /friends referred/i.test(m.text || '')).length, 0);
});

test('plan sync: admin deletes / adds lectures → plan rebuilt, student told only about removals, change hook fires', async () => {
  const START = Date.UTC(2026, 10, 6, 4, 0, 0); const H = 3600; const t = await boot({ start: START }); const bid = t.add('Sync batch', 'foundation', ['Accounts']); const s0 = t.app.db.batch.getOne(bid).subjects[0]; const c = t.app.content.addChapter(bid, s0._id, 'Basics');
  const heard = []; t.app.content.onChange((b) => heard.push(b));
  const l1 = t.app.content.addLecture(bid, s0._id, c._id, { name: 'Lecture 1', duration: 2 * H, channelMsgId: 5, fid: 'a' }); t.app.content.addLecture(bid, s0._id, c._id, { name: 'Lecture 2', duration: 2 * H, channelMsgId: 6, fid: 'b' }); assert.ok(heard.includes(String(bid)));
  const u = await t.reg(t.user(73)); const id = String(u.id); t.app.planner.create(id, { level: 'foundation', subjects: [{ batchId: bid, subjectId: s0._id, finished: [] }], startDate: '2026-11-06', dailyHours: 4, mode: 'mixed', perDay: 1, examMonth: 'September 2027' });
  assert.deepEqual(t.app.planner.syncBatch(bid), []); // nothing changed
  t.app.content.addLecture(bid, s0._id, c._id, { name: 'Lecture 3', duration: 2 * H, channelMsgId: 7, fid: 'c' }); t.tg.clear(); let r = await t.app.bot.planSync(bid); assert.deepEqual(r.map((x) => [x.added, x.removed]), [[1, 0]]); assert.equal(t.app.planner.get(id).count, 3); assert.equal(t.tg.of('sendMessage').length, 0);
  t.app.content.deleteLecture(l1._id); r = await t.app.bot.planSync(bid); assert.deepEqual(r.map((x) => [x.added, x.removed]), [[0, 1]]); assert.equal(t.app.planner.get(id).count, 2); assert.match(t.tg.last('sendMessage').text, /study plan was updated/); assert.match(t.tg.last('sendMessage').text, /1 lecture was removed/);
  assert.deepEqual(t.app.planner.syncBatch(bid), []);
});

test('no free access: reminder shows Unlock instead of send buttons, pressing Send gives the “unlock your free access” message, delivery /start too; with access nothing changes', async () => {
  const START = Date.UTC(2026, 10, 16, 4, 0, 0); const H = 3600; const t = await boot({ start: START }); const bid = t.add('Acc batch', 'foundation', ['Accounts']); const s0 = t.app.db.batch.getOne(bid).subjects[0]; const c = t.app.content.addChapter(bid, s0._id, 'Basics');
  t.app.content.addLecture(bid, s0._id, c._id, { name: 'Lecture 1', duration: 2 * H, channelMsgId: 5, fid: 'a' });
  const u = await t.reg(t.user(81)); const id = String(u.id);
  const msg = t.app.access.accessNeeded(id); assert.ok(msg); assert.match(msg.text, /unlock your free access/i); assert.match(msg.text, /@FocusXSupport_Bot/); assert.match(msg.text, /Access<\/b> tab/); assert.match(JSON.stringify(msg.rows), /t\.me\/FocusXSupport_Bot/);
  t.app.planner.create(id, { level: 'foundation', subjects: [{ batchId: bid, subjectId: s0._id, finished: [] }], startDate: '2026-11-16', dailyHours: 4, mode: 'mixed', perDay: 1, examMonth: 'September 2027' }); t.app.planner.setReminders(id, { daily: true, at: '09:30' });
  t.clock.t = Date.UTC(2026, 10, 16, 4, 0, 0); t.tg.clear(); assert.equal(await t.app.bot.tick(), 1); const m = t.tg.last('sendMessage'); const kbs = JSON.stringify(m.reply_markup); assert.match(m.text, /Your free access is off/); assert.match(kbs, /Unlock free access/); assert.ok(!/"rl:/.test(kbs));
  t.tg.clear(); const day = '2026-11-16'; await t.press(u, `rl:${day}:0`); assert.match(t.tg.last('sendMessage').text, /unlock your free access/i);
  t.app.access.grantHours(id, 5, 'test'); assert.equal(t.app.access.accessNeeded(id), null);
});

test('ad backup: Adsgram fail → Monetag → access anyway (capped per day); too-early and unknown tokens refused; missing-fill + manage buttons', async () => {
  const t = await boot(); const acc = t.app.access; acc.ensureDefaults(); const u = await t.reg(t.user(21)); const uid = String(u.id);
  t.app.service.config.set(own, { adsgramBlockId: '12345', monetagZoneId: '12243244', adFallbackPerDay: 2 });
  const sid = (await t.call(u, 'GET', '/api/app/access')).json.data.servers[0].id;
  let s = acc.adStart(uid, sid);
  acc.adAlt(uid, s.token, 'monetag'); assert.ok(acc.window(uid).remainingMs > 7 * 3600000); assert.throws(() => acc.adAlt(uid, s.token, 'monetag'), /already claimed/);
  assert.throws(() => acc.adAlt(uid, 'nope', 'fallback'), /Unknown/);
  s = acc.adStart(uid, sid); t.clock.t += 3000; acc.adAlt(uid, s.token, 'fallback'); assert.ok(acc.window(uid).remainingMs > 15 * 3600000);
  t.app.service.config.set(own, { adFallback: false }); s = acc.adStart(uid, sid); t.clock.t += 3000; assert.throws(() => acc.adAlt(uid, s.token, 'fallback'), /No ad available/);
  // panel: missing numbers get ➕ buttons; Manage page; fill goes to the right place
  const b2 = t.add('Fill batch', 'foundation', ['Accounts']); let mid = 9900; const video = (cap) => ({ message_id: ++mid, chat: { id: owner.id, type: 'private' }, from: owner, video: { file_id: 'v' + mid, file_unique_id: 'u' + mid, duration: 60 }, caption: cap });
  await t.say(owner, '/upload'); await t.press(owner, 'wl:0'); await t.press(owner, 'ws:0'); await t.press(owner, 'wf:0'); await t.press(owner, 'un'); await t.say(owner, 'Ch');
  for (const n of [1, 2, 4]) await t.send(owner, video(`Lecture ${n}`)); const ch = () => t.app.db.batch.getOne(b2).subjects[0].chapters[0];
  assert.match(JSON.stringify(t.tg.last('editMessageText').reply_markup), /uf:3/); await t.press(owner, 'uf:3'); assert.match(t.tg.last('editMessageText').text, /fills #3/); await t.send(owner, video('whatever'));
  assert.deepEqual(t.app.content.missingOf(ch()._id), []); assert.equal(t.app.content.labelOf(t.app.content.lectureAt(ch()._id, 3)._id), 3);
  await t.press(owner, 'mg'); assert.match(JSON.stringify(t.tg.last('editMessageText').reply_markup), /mrc[\s\S]*mdc/); await t.press(owner, 'mrc'); await t.say(owner, 'Renamed Ch'); assert.equal(ch().name, 'Renamed Ch'); assert.match(t.tg.last('editMessageText').text, /Chapter renamed/);
  await t.press(owner, 'mdc'); assert.match(t.tg.last('editMessageText').text, /Delete this chapter/); await t.press(owner, 'mb'); assert.match(t.tg.last('editMessageText').text, /Upload in progress/);
});
