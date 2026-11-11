'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { boot, owner, OWNER, closeAll } = require('./helpers'); test.afterEach(closeAll);
const own = { id: String(OWNER), name: 'o', role: 'super_admin', perms: new Set(['*']) };
const START = Date.UTC(2026, 10, 6, 4, 0, 0); // Fri 6 Nov 2026, 09:30 IST
/** subjects: { Accounts: [[chapterName, [durations...]], ...] } */
function build(t, subjects) { const bid = t.add('Plan batch', 'foundation', Object.keys(subjects)); const b = t.app.db.batch.getOne(bid); const out = []; b.subjects.forEach((s) => { const chs = []; subjects[s.name].forEach(([cn, durs]) => { const c = t.app.content.addChapter(bid, s._id, cn); const ls = durs.map((d, i) => t.app.content.addLecture(bid, s._id, c._id, { name: `Lecture ${i + 1}`, duration: d, channelMsgId: 9000 + Math.floor(Math.random() * 1e6) })); chs.push({ id: c._id, lectures: ls.map((l) => l._id) }); }); out.push({ name: s.name, batchId: bid, subjectId: s._id, chs }); }); return out; }
const H = 3600;
const inp = (subs, o = {}) => ({ level: 'foundation', subjects: subs.map((s) => ({ batchId: s.batchId, subjectId: s.subjectId, finished: s.finished || [] })), startDate: '2026-11-06', dailyHours: 4, mode: 'mixed', perDay: 1, examMonth: 'September 2027', ...o });

test('preview and schedule: budget per day, lecture order kept, finished chapters skipped, rest days + days off skipped', async () => {
  const t = await boot({ start: START }); const [acc] = build(t, { Accounts: [['Basics', [2 * H, 2 * H]], ['Journal', [2 * H, 2 * H, 2 * H]], ['Ledger', [2 * H]]] }); const u = await t.reg(t.user(1));
  let p = (await t.call(u, 'POST', '/api/app/plan/preview', inp([acc]))).json.data; assert.equal(p.lecturesLeft, 6 + 0 + 0 + 0 + 0 + 0 + 0 === 6 ? 6 : 6); assert.equal(p.contentSeconds, 12 * H); assert.equal(p.hoursPerDay, 4); assert.equal(p.finishDate, '2026-11-08'); assert.equal(p.studyDays, 3);
  p = (await t.call(u, 'POST', '/api/app/plan/preview', inp([{ ...acc, finished: [acc.chs[0].id] }]))).json.data; assert.equal(p.lecturesLeft, 4); assert.equal(p.contentSeconds, 8 * H);
  const r = await t.call(u, 'POST', '/api/app/plan', inp([acc], { restDays: [6, 0], daysOff: ['2026-11-10'] })); assert.equal(r.status, 200); const v = r.json.data; assert.equal(v.total, 6); assert.equal(v.todayDate, '2026-11-06');
  await new Promise((r) => setTimeout(r, 150)); const auto = t.tg.calls.find((c) => c.method === 'sendDocument'); assert.ok(auto, 'PDF is sent to Telegram right after generating'); assert.match(auto.body.filename, /^study-plan-/);
  const days = t.app.planner.get(String(u.id)).days; assert.deepEqual(days.map((d) => d.date), ['2026-11-06', '2026-11-09', '2026-11-11']); // Sat/Sun rest, 10th off
  assert.ok(days.every((d) => d.seconds <= 4 * H + 600)); const order = days.flatMap((d) => d.items.flatMap((i) => i.lectures.map((l) => l.id))); assert.deepEqual(order, acc.chs.flatMap((c) => c.lectures)); assert.equal(v.today.items[0].chapter, 'Basics'); assert.equal(v.finishDate, '2026-11-11');
  assert.equal((await t.call(u, 'POST', '/api/app/plan', inp([acc], { restDays: [0, 1, 2, 3, 4, 5, 6] }))).status, 400); assert.equal((await t.call(u, 'POST', '/api/app/plan/preview', inp([]))).status, 400); assert.equal((await t.call(u, 'POST', '/api/app/plan/preview', { ...inp([acc]), subjects: [{ batchId: 'zz', subjectId: 'zz' }] })).status, 404);
});
test('mixed mode rotates subjects, pinned subjects appear daily, block mode finishes one subject first', async () => {
  const t = await boot({ start: START }); const [a, l, e] = build(t, { Accounts: [['A1', [H, H, H, H]]], Laws: [['L1', [H, H, H, H]]], Economics: [['E1', [H, H, H, H]]] }); const u = await t.reg(t.user(1)); const id = String(u.id);
  t.app.planner.create(id, inp([a, l, e], { dailyHours: 2, perDay: 1 })); let days = t.app.planner.get(id).days; assert.deepEqual(days.slice(0, 3).map((d) => d.items.map((i) => i.subject)), [['Accounts'], ['Laws'], ['Economics']]);
  t.app.planner.create(id, inp([a, l, e], { dailyHours: 2, perDay: 2, pinned: ['Economics'] })); days = t.app.planner.get(id).days; assert.ok(days.slice(0, 5).every((d) => d.items.some((i) => i.subject === 'Economics')) || days.slice(0, 2).every((d) => d.items.some((i) => i.subject === 'Economics'))); assert.ok(days[0].items.length === 2);
  t.app.planner.create(id, inp([a, l, e], { dailyHours: 4, mode: 'block' })); days = t.app.planner.get(id).days; const seq = days.flatMap((d) => d.items.map((i) => i.subject)); assert.deepEqual(seq, ['Accounts', 'Laws', 'Economics']); assert.equal(days.length, 3);
  t.app.planner.create(id, inp([a, l, e], { dailyHours: 2, weekendHours: 6, perDay: 1, restDays: [] })); days = t.app.planner.get(id).days; const sat = days.find((d) => d.date === '2026-11-07'); assert.ok(sat.seconds >= 4 * H); // weekend budget used
});
test('finish-by date recommends daily hours (and flags impossible plans)', async () => {
  const t = await boot({ start: START }); const [a] = build(t, { Accounts: [['A', Array(20).fill(H)]] }); const u = await t.reg(t.user(1));
  let p = (await t.call(u, 'POST', '/api/app/plan/preview', inp([a], { finishBy: '2026-11-15' }))).json.data; assert.equal(p.recommended, 2); assert.equal(p.feasible, true); assert.ok(p.finishDate <= '2026-11-15');
  p = (await t.call(u, 'POST', '/api/app/plan/preview', inp([a], { finishBy: '2026-11-06' }))).json.data; assert.equal(p.feasible, false); const bad = await t.call(u, 'POST', '/api/app/plan', inp([a], { finishBy: '2026-11-06' })); assert.equal(bad.status, 400); assert.match(bad.json.error, /Not possible/); assert.equal((await t.call(u, 'POST', '/api/app/plan/preview', inp([a], { finishBy: '2026-11-06', restDays: [5] }))).status, 400);
});
test('progress, streak, reschedule, days off, add subject, change today, undo', async () => {
  const t = await boot({ start: START }); const [a, l] = build(t, { Accounts: [['A', [2 * H, 2 * H, 2 * H, 2 * H]]], Laws: [['L', [2 * H, 2 * H]]] }); const u = await t.reg(t.user(1)); const id = String(u.id);
  await t.call(u, 'POST', '/api/app/plan', inp([a], { dailyHours: 4 })); let v = (await t.call(u, 'GET', '/api/app/plan')).json.data.plan; assert.equal(v.pct, 0); assert.equal(v.done, 0); assert.equal(v.today.count, 2); assert.equal(v.daysToExam, 299); assert.equal(v.streak, 0);
  const ids = v.today.items[0].lectures.map((x) => x.id); v = (await t.call(u, 'POST', '/api/app/plan/mark', { id: ids[0] })).json.data; assert.equal(v.done, 1); assert.equal(v.pct, 25); assert.equal(v.streak, 1); assert.equal(v.today.doneCount, 1); assert.equal(Math.round(v.secondsLeft / H), 6);
  v = (await t.call(u, 'POST', '/api/app/plan/mark', { id: ids[0], done: false })).json.data; assert.equal(v.done, 0); assert.equal((await t.call(u, 'POST', '/api/app/plan/mark', { id: 'nope' })).status, 404); v = (await t.call(u, 'POST', '/api/app/plan/mark', { ids, done: true })).json.data; assert.equal(v.done, 2);
  // next day: yesterday's work stays done, remaining lectures move on
  t.clock.t += 24 * 3600e3; v = (await t.call(u, 'POST', '/api/app/plan/reschedule')).json.data; assert.equal(v.todayDate, '2026-11-07'); assert.equal(v.done, 2); assert.equal(v.today.count, 2); assert.equal(v.total, 4);
  v = (await t.call(u, 'POST', '/api/app/plan/dayoff', { date: '2026-11-07' })).json.data; assert.equal(v.today, null); assert.deepEqual(v.daysOff, ['2026-11-07']); assert.equal(v.nextDay.date, '2026-11-08'); v = (await t.call(u, 'POST', '/api/app/plan/dayoff', { date: '2026-11-07', remove: true })).json.data; assert.ok(v.today);
  assert.equal((await t.call(u, 'POST', '/api/app/plan/dayoff', { date: 'bad' })).status, 400);
  v = (await t.call(u, 'POST', '/api/app/plan/add-subject', { batchId: l.batchId, subjectId: l.subjectId })).json.data; assert.deepEqual(v.subjects, ['Accounts', 'Laws']); assert.equal(v.total, 6); assert.equal((await t.call(u, 'POST', '/api/app/plan/add-subject', { batchId: l.batchId, subjectId: l.subjectId })).status, 400);
  v = (await t.call(u, 'POST', '/api/app/plan/change-today', { subject: 'Laws' })).json.data; assert.equal(v.today.items[0].subject, 'Laws'); assert.equal((await t.call(u, 'POST', '/api/app/plan/change-today', { subject: 'Nope' })).status, 400);
  assert.equal((await t.call(u, 'DELETE', '/api/app/plan')).json.data.deleted, true); assert.equal((await t.call(u, 'GET', '/api/app/plan')).json.data.plan, null); assert.equal((await t.call(u, 'POST', '/api/app/plan/mark', { id: 'x' })).status, 404);
});
test('reminders: daily message at the chosen time (once per day) and new-lecture alerts', async () => {
  const t = await boot({ start: START }); const [a] = build(t, { Accounts: [['A', [H, H]]] }); const u = await t.reg(t.user(1)); const id = String(u.id);
  await t.call(u, 'POST', '/api/app/plan', inp([a])); assert.equal((await t.call(u, 'PATCH', '/api/app/plan/reminders', { daily: true, at: '25:00' })).status, 400);
  await t.call(u, 'PATCH', '/api/app/plan/reminders', { daily: true, at: '09:30', newLectures: true }); t.tg.clear(); assert.equal(await t.app.bot.tick(), 1); const m = t.tg.last('sendMessage'); assert.equal(String(m.chat_id), id); assert.match(m.text, /Your study plan for today/); assert.match(m.text, /Accounts<\/b> · A/); assert.match(m.text, /2 lectures/); const rows = m.reply_markup.inline_keyboard; assert.match(rows[0][0].callback_data, /^rl:\d{4}-\d{2}-\d{2}:0$/); assert.match(rows[1][0].callback_data, /^rn:/); assert.equal(rows[rows.length - 1][0].web_app.url, 'https://app.example.com/app/'); assert.equal(await t.app.bot.tick(), 0); // not twice
  t.clock.t += 60000; assert.equal(await t.app.bot.tick(), 0); // wrong minute
  assert.deepEqual(t.app.planner.plansWithAlerts(a.batchId), [id]); t.tg.clear(); await t.say(owner, '/upload'); await t.press(owner, 'ub:0'); await t.press(owner, 'us:0'); await t.press(owner, 'uh:0'); await t.send(owner, { video: { file_id: 'v', duration: 100 } }); await t.say(owner, '/done'); assert.ok(t.tg.of('sendMessage').some((x) => String(x.chat_id) === id && /New lectures added/.test(x.text)));
});
test('PDF export is a valid PDF with correct xref table and is delivered via Telegram', async () => {
  const t = await boot({ start: START }); const [a] = build(t, { Accounts: [['Basics of Accounts', Array(30).fill(H)]] }); const u = await t.reg(t.user(1)); await t.call(u, 'POST', '/api/app/plan', inp([a], { dailyHours: 1 })); t.tg.clear();
  assert.equal((await t.call(u, 'POST', '/api/app/plan/pdf')).json.data.sent, true); const doc = t.tg.calls.find((c) => c.method === 'sendDocument').body; assert.match(doc.filename, /^study-plan-[A-Za-z]+-\d{4}\.pdf$/); assert.ok(doc.size > 3000);
  const buf = t.app.planner.pdf(String(u.id)); const s = buf.toString('latin1'); assert.ok(s.startsWith('%PDF-1.4')); assert.ok(s.trimEnd().endsWith('%%EOF')); const sx = parseInt(/startxref\n(\d+)/.exec(s)[1], 10); assert.equal(s.slice(sx, sx + 4), 'xref'); const n = parseInt(/xref\n0 (\d+)/.exec(s)[1], 10); const offs = [...s.slice(sx).matchAll(/(\d{10}) 00000 n/g)].map((m) => parseInt(m[1], 10)); assert.equal(offs.length, n - 1); offs.forEach((o, i) => assert.equal(s.slice(o).startsWith(`${i + 1} 0 obj`), true));
  assert.ok((s.match(/\/Type \/Page /g) || []).length >= 2); assert.ok(s.includes('Study Plan') && s.includes('Lecture 01')); assert.equal((await t.call(owner, 'POST', '/api/app/plan/pdf')).status, 404);
});

test('lectures already watched (partly watched chapters) are left out of the plan', async () => {
  const t = await boot({ start: START }); const [a] = build(t, { Accounts: [['Basics', [H, H, H, H]]] }); const u = await t.reg(t.user(1)); const ls = a.chs[0].lectures;
  const p = (await t.call(u, 'POST', '/api/app/plan/preview', { ...inp([a]), subjects: [{ batchId: a.batchId, subjectId: a.subjectId, watched: [ls[0], ls[1], 'bogus'] }] })).json.data; assert.equal(p.lecturesLeft, 2); assert.equal(p.contentSeconds, 2 * H);
});
