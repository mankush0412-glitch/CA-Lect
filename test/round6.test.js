'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { boot, owner, OWNER, closeAll } = require('./helpers'); test.afterEach(closeAll);
const own = { id: String(OWNER), name: 'o', role: 'super_admin', perms: new Set(['*']) };
const A = (t, m, p, b) => t.call(owner, m, '/api/admin' + p, b);

test('/admin shows every staff command as buttons; buttons run or explain the command; students get nothing', async () => {
  const t = await boot(); const u = t.user(41); await t.reg(u);
  t.tg.clear(); await t.say(owner, '/admin'); const m = t.tg.last('sendMessage'); assert.match(m.text, /Admin menu/);
  const cds = m.reply_markup.inline_keyboard.flat().map((x) => x.callback_data); for (const k of ['upload', 'stats', 'ban', 'unban', 'suspend', 'unsuspend', 'ipbans', 'unbanip', 'grant', 'broadcast', 'howto', 'rmword', 'banned', 'suspended']) assert.ok(cds.includes('adm:' + k), k); assert.ok(cds.every((x) => x.length <= 64));
  t.tg.clear(); await t.press(owner, 'adm:ban'); assert.match(t.tg.last('sendMessage').text, /\/ban 123456789/);
  t.tg.clear(); await t.press(owner, 'adm:stats'); assert.ok(t.tg.of('sendMessage').length >= 1);
  t.tg.clear(); await t.press(owner, 'adm:upload'); assert.ok(t.tg.of('sendMessage').length >= 1);
  t.tg.clear(); await t.press(u, 'adm:ban'); assert.equal(t.tg.of('sendMessage').length, 0); // not staff
  t.tg.clear(); await t.say(owner, '/help'); assert.match(t.tg.last('sendMessage').text, /\/admin/);
});

test('upload panel no longer shows Auto-order or the 🔁 Replace button (Replace moved into Manage)', async () => {
  const t = await boot(); const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'bot.js'), 'utf8');
  assert.ok(!/Auto-order: O/.test(src)); assert.ok(!/text: '🔁 Replace #'/.test(src)); assert.match(src, /Replace a lecture #/); assert.ok(t);
});

test('Private / Public: an attempt or a teacher can be hidden from students without deleting anything', async () => {
  const t = await boot(); const S = t.app.service; const fid = S.faculty.create(own, { name: 'Prof Mehta' }).id; S.subject.create(own, { name: 'Accounts', level: 'foundation' });
  const u = await t.reg(t.user(42)); const subjId = S.subject.list(own, { size: 50 }).items.find((x) => x.name === 'Accounts').id;
  const r = await A(t, 'POST', `/subjects/${subjId}/teachers`, { facultyId: fid, label: 'May 2027' }); assert.equal(r.status, 200); const bid = r.json.data.batchId;
  const seen = async () => { const d = (await t.call(u, 'GET', '/api/app/tree?level=foundation')).json.data; const s = d.subjects.find((x) => x.name === 'Accounts'); return s ? s.faculties.reduce((n, f) => n + f.batches.length, 0) : 0; };
  assert.equal(await seen(), 1);
  let at = (await A(t, 'GET', `/subjects/${subjId}/attempts`)).json.data; assert.equal(at[0].isPublic, true);
  assert.equal((await A(t, 'POST', `/batches/${bid}/visibility`, { public: false })).json.data.isPublic, false); assert.equal(await seen(), 0);
  at = (await A(t, 'GET', `/subjects/${subjId}/attempts`)).json.data; assert.equal(at[0].isPublic, false);
  await A(t, 'POST', `/batches/${bid}/visibility`, { public: true }); assert.equal(await seen(), 1);
  assert.equal((await A(t, 'POST', `/faculties/${fid}/visibility`, { public: false })).json.data.isPublic, false); assert.equal(await seen(), 0);
  assert.equal(S.faculty.get(own, fid).isPublic, false); await A(t, 'POST', `/faculties/${fid}/visibility`, { public: true }); assert.equal(await seen(), 1);
  const priv = await A(t, 'POST', `/subjects/${subjId}/teachers`, { facultyId: fid, label: 'Nov 2027', isPublic: false }); assert.equal(priv.json.data.batchId && S.batch.get(own, priv.json.data.batchId).isPublic, false); assert.equal(await seen(), 1);
});

test('planner PDF carries a light @FocusXCA watermark behind the content', () => {
  const { Page, build } = require('../src/pdf'); const p = new Page(); p.text(40, 40, 10, 'Hello'); const buf = build([p], { watermark: '@FocusXCA' }).toString('latin1');
  assert.match(buf, /\(@FocusXCA\) Tj/); assert.match(buf, /0\.93 0\.93 0\.95 rg/); assert.ok(buf.indexOf('@FocusXCA') < buf.indexOf('Hello'));
  assert.ok(!/FocusXCA/.test(build([p]).toString('latin1')));
  assert.match(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'planner.js'), 'utf8'), /watermark: '@FocusXCA'/);
});

test('reminder lecture button: delivery bot not started → "Open delivery bot" prompt; started → strict delivery-bot send + Open button', async () => {
  const t = await boot({ config: { deliveryBotToken: '555:delivery' } }); const u = await t.reg(t.user(51)); const id = String(u.id);
  t.app.planner.get = () => ({ days: [{ date: '2026-11-18', items: [{ chapter: 'Ch One', chapterId: 'c1', lectures: [{ id: 'l1' }] }] }], done: {} });
  const calls = []; t.app.access.deliverLectures = async (uid, ids, opts) => { calls.push({ ids, opts }); return { sent: 1, failed: [], quota: { left: 14 } }; };
  t.tg.clear(); await t.press(u, 'rl:2026-11-18:0'); const m = t.tg.last('sendMessage'); assert.match(m.text, /Open the delivery bot first/); assert.equal(calls.length, 0);
  t.app.db.kv.set('dstart:' + id, '1'); t.tg.clear(); await t.press(u, 'rl:2026-11-18:0'); assert.equal(calls.length, 1); assert.equal(calls[0].opts.strict, true); assert.match(t.tg.last('sendMessage').text, /sent to the delivery bot/);
});

const mkMedia = () => { let mid = 9000; return { video: (d, cap) => ({ message_id: ++mid, chat: { id: owner.id, type: 'private' }, from: owner, video: { file_id: 'v' + mid, file_unique_id: 'u' + mid, duration: d }, caption: cap }) }; };

test('updates of one person are handled in arrival order: a file sent right after the chapter name is never dropped', async () => {
  const t = await boot(); t.add('Hardik Sep 2026', 'foundation', ['Accounts']); const m = mkMedia();
  await t.say(owner, '/upload'); await t.press(owner, 'wl:0'); await t.press(owner, 'ws:0'); await t.press(owner, 'wt:0'); await t.press(owner, 'wf:0'); await t.press(owner, 'wa:0'); await t.press(owner, 'un'); t.tg.clear();
  // webhook mode delivers these at the same moment
  await Promise.all([t.say(owner, 'Ch Race'), t.send(owner, m.video(600, 'L1')), t.send(owner, m.video(700, 'L2'))]);
  assert.equal(t.tg.of('copyMessage').length, 2);
});

test('upload wizard: "➕ New attempt" and "➕ Add a teacher" create the batch inside the bot, no panel needed', async () => {
  const t = await boot(); const S = t.app.service; const f1 = S.faculty.create(own, { name: 'Prof One' }).id; const f2 = S.faculty.create(own, { name: 'Prof Two' }).id; S.subject.create(own, { name: 'Accounts', level: 'foundation' });
  const sid = S.subject.list(own, { size: 50 }).items[0].id; const r0 = await A_(t, `/subjects/${sid}/teachers`, { facultyId: f1, label: 'Nov 2026', type: 'fastrack' }); assert.equal(r0.status, 200);
  await t.say(owner, '/upload'); await t.press(owner, 'wl:0'); await t.press(owner, 'ws:0'); await t.press(owner, 'wt:1'); await t.press(owner, 'wf:0');
  assert.match(JSON.stringify(t.tg.last('editMessageText').reply_markup), /wna/); t.tg.clear(); await t.press(owner, 'wna'); assert.match(t.tg.last('editMessageText').text, /attempt name/); await t.say(owner, 'May 2027');
  const bs = S.uploadBatches().filter((b) => b.type === 'fastrack'); assert.equal(bs.length, 2); assert.ok(bs.some((b) => b.label === 'May 2027' && b.facultyId === String(f1)));
  assert.match(t.tg.last('sendMessage').text, /Chapter|chapter|Created|Select/);
  await t.say(owner, '/cancel'); await t.say(owner, '/upload'); await t.press(owner, 'wl:0'); await t.press(owner, 'ws:0'); await t.press(owner, 'wt:1'); await t.press(owner, 'wnt'); await t.press(owner, 'wnf:1'); await t.say(owner, '-');
  const b2 = S.uploadBatches().filter((b) => b.type === 'fastrack' && b.facultyId === String(f2)); assert.equal(b2.length, 1);
});
const A_ = (t, p, b) => t.call(owner, 'POST', '/api/admin' + p, b);

test('copy chapters/units between Regular and Fastrack: pick chapters, single units, optional lectures', async () => {
  const t = await boot(); const S = t.app.service, C = t.app.content; const f = S.faculty.create(own, { name: 'Prof' }).id; S.subject.create(own, { name: 'Law', level: 'foundation' }); const sid = S.subject.list(own, { size: 50 }).items[0].id;
  const reg = (await A_(t, `/subjects/${sid}/teachers`, { facultyId: f, label: 'R', type: 'regular' })).json.data; const fx = (await A_(t, `/subjects/${sid}/teachers`, { facultyId: f, label: 'F', type: 'fastrack' })).json.data;
  const c1 = C.addChapter(reg.batchId, reg.subjectId, 'Contract'); const c2 = C.addChapter(reg.batchId, reg.subjectId, 'Sale'); const u1 = C.addUnit(reg.batchId, reg.subjectId, c1._id, 'Offer'); C.addUnit(reg.batchId, reg.subjectId, c1._id, 'Acceptance'); const u3 = C.addUnit(reg.batchId, reg.subjectId, c2._id, 'Goods');
  const post = (b) => t.call(owner, 'POST', `/api/admin/batches/${fx.batchId}/subjects/${fx.subjectId}/copy-structure`, { fromBatchId: reg.batchId, fromSubjectId: reg.subjectId, ...b });
  const shape = () => (t.app.db.batch.getOne(fx.batchId).subjects[0].chapters || []).map((c) => c.name + ':' + (c.units || []).map((u) => u.name).join('+'));
  let r = await post({ chapterIds: [c1._id], units: false }); assert.equal(r.status, 200); assert.deepEqual(shape(), ['Contract:']);
  r = await post({ unitKeys: [c2._id + ':' + u3._id] }); assert.deepEqual(shape(), ['Contract:', 'Sale:Goods']);
  r = await post({ chapterIds: [c1._id] }); assert.deepEqual(shape(), ['Contract:Offer+Acceptance', 'Sale:Goods']);
  r = await post({}); assert.equal(r.json.data.chapters, 0); assert.deepEqual(shape().length, 2);
  const m = t.app.db.batch.getOne(reg.batchId); const ch = m.subjects[0].chapters[0]; ch.lectures = [{ _id: 'lx1', name: 'L1', unitId: u1._id, messageId: 5, duration: 60 }]; t.app.db.batch.upsert(m); t.app.content.onChange && 0;
  r = await post({ chapterIds: [c1._id], files: true }); assert.equal(r.json.data.lectures, 1); const cp = t.app.db.batch.getOne(fx.batchId).subjects[0].chapters[0]; assert.equal(cp.lectures.length, 1); assert.notEqual(cp.lectures[0]._id, 'lx1'); assert.equal(cp.lectures[0].unitId, cp.units.find((u) => u.name === 'Offer')._id);
});

test('force-join: id-only channels are kept, Mini App API refuses non-members, live check lets members in', async () => {
  const keep = process.env.JOIN_CHANNELS_FOUNDATION; process.env.JOIN_CHANNELS_FOUNDATION = '-1005555';
  try {
    const t = await boot(); const u = await t.reg(t.user(61)); await t.call(u, 'POST', '/api/app/level', { level: 'foundation' });
    t.tg.members['-1005555:' + u.id] = 'left';
    const r = await t.call(u, 'GET', '/api/app/access'); assert.equal(r.status, 403); assert.equal(r.json.joinRequired, true);
    assert.equal((await t.call(u, 'GET', '/api/app/me')).status, 200);
    const j = (await t.call(u, 'GET', '/api/app/join')).json.data; assert.equal(j.required, true); assert.equal(j.allJoined, false);
    t.tg.members['-1005555:' + u.id] = 'member'; const v = (await t.call(u, 'POST', '/api/app/join/verify', {})).json.data; assert.equal(v.allJoined, true);
    assert.equal((await t.call(u, 'GET', '/api/app/access')).status, 200);
  } finally { if (keep === undefined) delete process.env.JOIN_CHANNELS_FOUNDATION; else process.env.JOIN_CHANNELS_FOUNDATION = keep; }
});
