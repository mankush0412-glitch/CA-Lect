'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { boot, owner, OWNER, closeAll } = require('./helpers'); test.afterEach(closeAll);
const own = { id: String(OWNER), name: 'o', role: 'super_admin', perms: new Set(['*']) };
const video = (d = 3600, cap) => ({ video: { file_id: 'v', duration: d, file_size: 1000 }, caption: cap });
const doc = (name, mime = 'application/pdf') => ({ document: { file_id: 'd', file_name: name, mime_type: mime, file_size: 10 } });

test('staff upload session: batch → subject → new chapter → videos become lectures (with real duration), PDFs become notes', async () => {
  const t = await boot(); const bid = t.add('Nitin Goel Sep 2026', 'foundation', ['Accounts']); const stu = t.user(1);
  await t.say(stu, '/upload'); assert.equal(t.tg.of('sendMessage').filter((m) => /Upload session/.test(m.text)).length, 0); // students cannot upload
  t.tg.clear(); await t.say(owner, '/upload'); const pick = t.tg.last('sendMessage'); assert.match(pick.text, /Select the batch/); assert.equal(pick.reply_markup.inline_keyboard[0][0].text, 'Nitin Goel Sep 2026');
  await t.press(owner, 'ub:0'); assert.match(t.tg.last('editMessageText').text, /Select the subject/);
  await t.press(owner, 'us:0'); await t.press(owner, 'un'); await t.say(owner, 'Basics of Accounts'); assert.match(t.tg.last('sendMessage').text, /Upload in progress/);
  t.tg.clear(); await t.send(owner, video(6780, 'Lecture 01')); await t.send(owner, video(7260)); await t.send(owner, doc('Basics_Notes.pdf'));
  const copies = t.tg.of('copyMessage'); assert.equal(copies.length, 3); assert.equal(copies[0].chat_id, '-100999');
  const b = t.app.db.batch.getOne(bid); const ch = b.subjects[0].chapters[0]; assert.equal(ch.name, 'Basics of Accounts'); assert.deepEqual(ch.lectures.map((l) => [l.name, l.duration]), [['Lecture 01', 6780], ['Lecture 02', 7260]]); assert.equal(ch.notes[0].name, 'Basics Notes'); assert.ok(ch.lectures.every((l) => l.channelMsgId > 5000));
  assert.match(t.tg.last('editMessageText').text, /Lectures: <b>2<\/b>\s+📄 Notes: <b>1<\/b>/);
  await t.press(owner, 'um'); await t.send(owner, video(100)); assert.equal(t.app.db.batch.getOne(bid).subjects[0].chapters[0].notes.length, 2); // notes mode
  await t.say(owner, '/done'); assert.match(t.tg.last('sendMessage').text, /Upload finished/); assert.equal(t.app.bot.sessions.size, 0);
  t.tg.clear(); await t.send(owner, video(5)); assert.equal(t.tg.of('copyMessage').length, 0); // no session → ignored
  await t.close();
});
test('upload errors are reported clearly (storage channel failure, empty batch)', async () => {
  const t = await boot({ config: { storageChannelId: '' } }); await t.say(owner, '/upload'); assert.match(t.tg.last('sendMessage').text, /No batches yet/); t.app.service.batch.create(own, { name: 'Empty', isPublic: true }); await t.say(owner, '/upload'); await t.press(owner, 'ub:0'); assert.match(t.tg.last('editMessageText').text, /no subjects yet/i);
  const bid2 = t.add('C', 'foundation', ['Law']); await t.say(owner, '/cancel'); await t.say(owner, '/upload'); await t.press(owner, 'ub:1'); await t.press(owner, 'us:0'); await t.press(owner, 'un'); await t.say(owner, 'Ch'); t.tg.clear(); await t.send(owner, video()); assert.match(t.tg.last('sendMessage').text, /STORAGE_CHANNEL_ID/); await t.close();
});
test('welcome, force-join gate (verified), banned users, referral rewards once', async () => {
  const t = await boot(); t.app.service.config.set(own, { joinChannels: [{ title: 'Main', url: 'https://t.me/main', chatId: '-100111' }], whatsappLink: 'https://wa.me/x' }); const a = t.user(1, 'Asha'), b = t.user(2, 'Ben');
  await t.say(a, '/start'); let m = t.tg.last('sendMessage'); assert.match(m.text, /Choose Your Level/); assert.equal(m.reply_markup.inline_keyboard[0][0].callback_data, 'lv:foundation'); assert.equal(m.reply_markup.inline_keyboard[1][0].callback_data, 'lv:intermediate'); await t.press(a, 'lv:foundation'); m = t.tg.last('sendMessage'); assert.match(m.text, /Hey, <b>Asha<\/b>/); assert.equal(m.reply_markup.inline_keyboard[0][0].web_app.url, 'https://app.example.com/app/'); // level → straight to Open WebApp; the force-join gate lives inside the app
  let j = (await t.call(a, 'GET', '/api/app/join')).json.data; assert.equal(j.required, true); assert.equal(j.allJoined, false); assert.equal(j.channels[0].title, 'Main');
  t.tg.members['-100111:' + a.id] = 'member'; j = (await t.call(a, 'POST', '/api/app/join/verify', {})).json.data; assert.equal(j.allJoined, true);
  await t.say(a, '/start'); assert.match(t.tg.last('sendMessage').text, /Hey/); // stays verified
  // referral: only first start, never self, rewards points + access hours, referrer notified
  t.tg.clear(); await t.say(b, '/start ref_' + a.id); t.tg.members['-100111:' + b.id] = 'member'; assert.equal(t.app.db.user.findOne(a.id).points, 10); assert.ok(t.app.access.window(String(a.id)).active); assert.ok(t.tg.of('sendMessage').some((x) => String(x.chat_id) === String(a.id) && /joined using your link/.test(x.text)));
  await t.say(b, '/start ref_' + a.id); assert.equal(t.app.db.user.findOne(a.id).points, 10); await t.say(a, '/start ref_' + a.id); assert.equal(t.app.db.user.findOne(a.id).points, 10);
  const c = t.user(3); await t.say(c, '/start ref_999999'); assert.equal(t.app.db.q('SELECT COUNT(*) c FROM referrals').get().c, 1);
  // banned
  t.app.db.ban.ban({ userId: String(c.id), reason: 'x' }); t.tg.clear(); await t.say(c, '/start'); assert.match(t.tg.last('sendMessage').text, /blocked/); await t.close();
});
test('access: ad servers with time gate, per-server and global daily limits, single-use tokens, cap, lecture-quota ads', async () => {
  const t = await boot(); const u = await t.reg(t.user(1)); const id = String(u.id);
  const s1 = t.app.access.adminServers.save({ name: 'Ad Server #1', url: 'https://ads.example/go?u={uid}&t={token}', hours: 12, perDay: 2 }); const s2 = t.app.access.adminServers.save({ name: 'Extra Lectures', url: 'https://ads.example/x', type: 'lectures', extraLectures: 3, perDay: 1 });
  assert.throws(() => t.app.access.adminServers.save({ name: 'x', url: 'http://insecure' }), /https/); let st = (await t.call(u, 'GET', '/api/app/access')).json.data; assert.equal(st.active, false); assert.equal(st.servers[0].used, 0); assert.equal(st.usage.lecturesLeft, 15); assert.equal(st.lectureServers.length, 1);
  let r = await t.call(u, 'POST', '/api/app/ad/start', { serverId: s1.id }); assert.equal(r.status, 200); assert.ok(r.json.data.url.includes('u=' + id) && r.json.data.url.includes('t=' + r.json.data.token)); const tok = r.json.data.token;
  r = await t.call(u, 'POST', '/api/app/ad/claim', { token: tok }); assert.equal(r.status, 425); assert.match(r.json.error, /more seconds/); t.clock.t += 16000;
  r = await t.call(u, 'POST', '/api/app/ad/claim', { token: tok }); assert.equal(r.status, 200); assert.equal(r.json.data.active, true); assert.ok(Math.abs(r.json.data.remainingMs - 12 * 3600e3) < 60000); assert.equal(r.json.data.servers[0].used, 1); assert.equal(r.json.data.usage.adsWatched, 1);
  assert.equal((await t.call(u, 'POST', '/api/app/ad/claim', { token: tok })).status, 400); // single use
  const other = t.user(2); await t.reg(other); assert.equal((await t.call(other, 'POST', '/api/app/ad/claim', { token: tok })).status, 404); // not your token
  for (let i = 0; i < 1; i++) { const a = (await t.call(u, 'POST', '/api/app/ad/start', { serverId: s1.id })).json.data; t.clock.t += 16000; await t.call(u, 'POST', '/api/app/ad/claim', { token: a.token }); }
  assert.equal((await t.call(u, 'POST', '/api/app/ad/start', { serverId: s1.id })).status, 429); // server limit 2/day
  const l = (await t.call(u, 'POST', '/api/app/ad/start', { serverId: s2.id })).json.data; t.clock.t += 16000; st = (await t.call(u, 'POST', '/api/app/ad/claim', { token: l.token })).json.data; assert.equal(st.usage.lecturesLimit, 18); assert.equal(st.lectureServers[0].used, 1);
  t.app.service.config.set(own, { dailyAdLimit: 3 }); assert.equal((await t.call(u, 'POST', '/api/app/ad/start', { serverId: s2.id })).status, 429); // global 3/day reached
  // expiry cap (72h) and next-day reset
  t.app.service.config.set(own, { dailyAdLimit: 20 }); t.clock.t += 24 * 3600e3; for (let i = 0; i < 2; i++) { const a = (await t.call(u, 'POST', '/api/app/ad/start', { serverId: s1.id })).json.data; t.clock.t += 16000; await t.call(u, 'POST', '/api/app/ad/claim', { token: a.token }); }
  t.app.access.grantHours(id, 500); assert.ok(t.app.access.window(id).remainingMs <= 72 * 3600e3 + 1000); assert.equal((await t.call(u, 'GET', '/api/app/access')).json.data.usage.lecturesLimit, 15);
  assert.equal((await t.call(u, 'POST', '/api/app/ad/start', { serverId: 'nope' })).status, 404); await t.close();
});
test('lecture delivery: locked until access, quota, premium, hidden batches, staff bypass, blocked-bot error, notes', async () => {
  const t = await boot(); const bid = t.add('Free batch', 'foundation', ['Accounts']); const b = t.app.db.batch.getOne(bid); const sid = b.subjects[0]._id; const ch = t.app.content.addChapter(bid, sid, 'Journal'); const L = [1, 2, 3].map((i) => t.app.content.addLecture(bid, sid, ch._id, { name: 'Lecture ' + i, duration: 3600 * i, channelMsgId: 6000 + i }));
  t.app.content.addNote(bid, sid, ch._id, { name: 'Journal notes.pdf', channelMsgId: 6100, fileType: 'document' });
  const u = await t.reg(t.user(1)); const ids = L.map((l) => l._id);
  const view = (await t.call(u, 'GET', `/api/app/batch/${bid}/${sid}`)).json.data; assert.equal(view.locked, true); assert.equal(view.reason, 'access'); assert.equal(view.chapters[0].lectures[1].duration, 7200); assert.equal(JSON.stringify(view).includes('channelMsgId'), false); assert.equal(JSON.stringify(view).includes('6001'), false);
  let r = await t.call(u, 'POST', '/api/app/lectures/send', { ids }); assert.equal(r.status, 402); assert.match(r.json.error, /Access tab/); assert.equal((await t.call(u, 'POST', '/api/app/notes/send', { chapterId: ch._id })).status, 402);
  t.app.access.grantHours(String(u.id), 10); t.tg.clear(); r = await t.call(u, 'POST', '/api/app/lectures/send', { ids: [ids[0], ids[2]] }); assert.equal(r.status, 200); assert.equal(r.json.data.sent, 2); assert.equal(r.json.data.quota.left, 13);
  const cp = t.tg.of('copyMessage'); assert.deepEqual(cp.map((c) => [String(c.chat_id), c.from_chat_id, c.message_id, c.protect_content]), [[String(u.id), '-100999', 6001, true], [String(u.id), '-100999', 6003, true]]); assert.match(cp[0].caption, /Accounts<\/b> · Journal\n▶ Lecture 1 · 1h 0m/);
  r = await t.call(u, 'POST', '/api/app/notes/send', { chapterId: ch._id }); assert.equal(r.json.data.sent, 1); assert.equal(t.app.access.quota(String(u.id)).left, 13); // notes are free
  t.app.service.config.set(own, { dailyLectureLimit: 3 }); r = await t.call(u, 'POST', '/api/app/lectures/send', { ids }); assert.equal(r.status, 429); assert.match(r.json.error, /Only 1 lecture left/);
  assert.equal((await t.call(u, 'POST', '/api/app/lectures/send', { ids: [] })).status, 400); assert.equal((await t.call(u, 'POST', '/api/app/lectures/send', { ids: ['deadbeef'] })).status, 404);
  // premium batch
  const pb = t.add('Premium', 'foundation', ['Law']); const pbd = t.app.db.batch.getOne(pb); pbd.isPremium = true; t.app.db.batch.upsert(pbd); const pc = t.app.content.addChapter(pb, pbd.subjects[0]._id, 'C'); const pl = t.app.content.addLecture(pb, pbd.subjects[0]._id, pc._id, { name: 'P1', channelMsgId: 7001 });
  r = await t.call(u, 'POST', '/api/app/lectures/send', { ids: [pl._id] }); assert.equal(r.status, 403); assert.match(r.json.error, /Premium/); t.app.service.student.enroll(own, String(u.id), pb); t.app.service.config.set(own, { dailyLectureLimit: 50 }); assert.equal((await t.call(u, 'POST', '/api/app/lectures/send', { ids: [pl._id] })).status, 200);
  // hidden (archived) batch
  t.app.service.batch.setStatus(own, bid, 'archive'); assert.equal((await t.call(u, 'POST', '/api/app/lectures/send', { ids })).status, 403); assert.equal((await t.call(u, 'GET', `/api/app/batch/${bid}/${sid}`)).status, 404); t.app.service.batch.setStatus(own, bid, 'restore');
  // staff: no access window or quota needed
  t.tg.clear(); const r2 = await t.call(owner, 'POST', '/api/app/lectures/send', { ids }); assert.equal(r2.json.data.sent, 3);
  // student who blocked the bot → helpful message
  const v = await t.reg(t.user(5)); t.app.access.grantHours(String(v.id), 5); t.tg.failFor.add(String(v.id)); const rr = await t.call(v, 'POST', '/api/app/lectures/send', { ids: [ids[0]] }); assert.equal(rr.json.data.sent, 0); assert.match(rr.json.data.failed[0].error, /Start the bot first/);
  // banned
  t.app.db.ban.ban({ userId: String(u.id) }); assert.equal((await t.call(u, 'POST', '/api/app/lectures/send', { ids })).status, 403); await t.close();
});
test('points redeem + pins + level + tree for the Mini App', async () => {
  const t = await boot(); const u = await t.reg(t.user(1)); t.app.db.user.addPoints(String(u.id), 20, 'test');
  let r = await t.call(u, 'POST', '/api/app/points/redeem', { hours: 5 }); assert.equal(r.status, 400); assert.match(r.json.error, /25 points/); r = await t.call(u, 'POST', '/api/app/points/redeem', { hours: 4 }); assert.equal(r.status, 200); assert.equal(r.json.data.points.balance, 0); assert.equal(r.json.data.access.active, true); assert.equal((await t.call(u, 'POST', '/api/app/points/redeem', { hours: 1 })).status, 400);
  assert.equal((await t.call(u, 'POST', '/api/app/level', { level: 'foundation' })).json.data.level, 'foundation'); assert.equal((await t.call(u, 'GET', '/api/app/me')).json.data.level, 'foundation');
  const bid = t.add('B', 'foundation', ['Accounts']); assert.equal((await t.call(u, 'POST', '/api/app/pins', { batchId: bid })).json.data.pinned, true); assert.deepEqual((await t.call(u, 'GET', '/api/app/pins')).json.data.pins, [bid]); assert.equal((await t.call(u, 'POST', '/api/app/pins', { batchId: bid })).json.data.pinned, false);
  assert.equal((await t.call(null, 'GET', '/api/app/me')).status, 401); assert.equal((await t.call(u, 'GET', '/api/app/nothing')).status, 404); await t.close();
});
