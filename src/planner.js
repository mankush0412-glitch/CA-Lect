'use strict';
const { HttpError } = require('./service'); const { Page, build } = require('./pdf');
const bad = (m) => new HttpError(400, m); const nf = (m) => new HttpError(404, m);
const TZ = 330 * 60000; const FALLBACK_SEC = 5400; const MAX_DAYS = 900;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d));
const hm = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m`; };
const examDate = (label) => { const m = /^(\w+)\s+(\d{4})$/.exec(label || ''); if (!m) return null; const i = MONTHS.indexOf(m[1]); return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, '0')}-01`; };

function createPlanner({ db, content, now = () => Date.now() }) {
  const today = () => new Date(now() + TZ).toISOString().slice(0, 10);
  const load = (uid) => { const r = db.q('SELECT data FROM plans WHERE userId=?').get(String(uid)); return r ? JSON.parse(r.data) : null; };
  const save = (uid, p) => { db.q('INSERT INTO plans(userId,data,updatedAt) VALUES(?,?,?) ON CONFLICT(userId) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt').run(String(uid), JSON.stringify(p), now()); return p; };

  function clean(inp) {
    if (!inp || typeof inp !== 'object') throw bad('Invalid plan settings');
    const subjects = Array.isArray(inp.subjects) ? inp.subjects : []; if (!subjects.length) throw bad('Choose at least one subject'); if (subjects.length > 12) throw bad('Too many subjects');
    const out = { level: inp.level === 'foundation' ? 'foundation' : 'intermediate', mode: inp.mode === 'block' ? 'block' : 'mixed', perDay: Math.min(4, Math.max(1, parseInt(inp.perDay) || 1)), pinned: Array.isArray(inp.pinned) ? inp.pinned.map(String).slice(0, 4) : [], examMonth: String(inp.examMonth || '').slice(0, 30), startDate: validDate(inp.startDate) ? inp.startDate : today(), finishBy: validDate(inp.finishBy) ? inp.finishBy : '', dailyHours: Math.min(14, Math.max(1, Number(inp.dailyHours) || 4)), weekendHours: inp.weekendHours ? Math.min(14, Math.max(1, Number(inp.weekendHours))) : 0, restDays: [...new Set((inp.restDays || []).map(Number).filter((n) => n >= 0 && n <= 6))], daysOff: [...new Set((inp.daysOff || []).filter(validDate))].slice(0, 120), subjects: [] };
    if (out.startDate < addDays(today(), -1)) out.startDate = today();
    if (out.restDays.length >= 7) throw bad('You need at least one study day each week');
    for (const s of subjects) {
      const v = content.view(String(s.batchId), String(s.subjectId)); const fin = new Set((s.finished || []).map(String));
      const order = Array.isArray(s.order) && s.order.length ? s.order.map(String).filter((id) => v.chapters.some((c) => c.id === id)) : v.chapters.map((c) => c.id); v.chapters.forEach((c) => { if (!order.includes(c.id)) order.push(c.id); });
      const allL = new Set(v.chapters.flatMap((c) => c.lectures.map((l) => l.id))); out.subjects.push({ name: v.subject, batchId: v.batchId, subjectId: v.subjectId, finished: [...fin].filter((id) => v.chapters.some((c) => c.id === id)), watched: [...new Set((s.watched || []).map(String))].filter((id) => allL.has(id)), partial: (s.partial || []).map(String), order });
    }
    return out;
  }
  function queues(cfg, doneSet) {
    return cfg.subjects.map((s) => { const v = content.view(s.batchId, s.subjectId); const byId = new Map(v.chapters.map((c) => [c.id, c])); const q = [];
      for (const cid of s.order) { const c = byId.get(cid); if (!c || s.finished.includes(cid)) continue; for (const l of c.lectures) if (!doneSet.has(l.id) && !(s.watched || []).includes(l.id)) q.push({ id: l.id, number: l.number, name: l.name, seconds: l.duration || FALLBACK_SEC, chapterId: c.id, chapter: c.name, subject: s.name }); }
      return { name: s.name, q }; });
  }
  const isStudyDay = (cfg, d) => !cfg.restDays.includes(dow(d)) && !cfg.daysOff.includes(d);
  const budgetFor = (cfg, d, hours) => { const we = [0, 6].includes(dow(d)); return (we && cfg.weekendHours ? cfg.weekendHours : hours) * 3600; };
  function recommendHours(cfg, total) { if (!cfg.finishBy) return null; let n = 0; for (let d = cfg.startDate; d <= cfg.finishBy && n < 2000; d = addDays(d, 1)) if (isStudyDay(cfg, d)) n++; if (!n) throw bad('There are no study days before your finish date'); return Math.max(1, Math.ceil(total / n / 360) / 10); }
  function schedule(cfg, doneSet = new Set(), from) {
    const qs = queues(cfg, doneSet); const total = qs.reduce((a, s) => a + s.q.reduce((x, l) => x + l.seconds, 0), 0); const count = qs.reduce((a, s) => a + s.q.length, 0);
    const rec = recommendHours(cfg, total); const hours = rec || cfg.dailyHours; const days = []; let rot = 0, blockI = 0; let d = from || cfg.startDate;
    for (let guard = 0; guard < MAX_DAYS && qs.some((s) => s.q.length); d = addDays(d, 1), guard++) {
      if (!isStudyDay(cfg, d)) continue; const budget = budgetFor(cfg, d, hours); let chosen = [];
      if (cfg.mode === 'block') { while (blockI < qs.length && !qs[blockI].q.length) blockI++; if (blockI < qs.length) chosen = [qs[blockI]]; }
      else { const pins = qs.filter((s) => cfg.pinned.includes(s.name) && s.q.length); const others = qs.filter((s) => !cfg.pinned.includes(s.name) && s.q.length); const need = Math.max(0, cfg.perDay - pins.length); chosen = pins.slice(0, cfg.perDay); for (let k = 0; k < need && others.length; k++) chosen.push(others[(rot + k) % others.length]); rot += need; if (!chosen.length) chosen = qs.filter((s) => s.q.length).slice(0, 1); }
      const items = []; let used = 0; let carry = 0;
      chosen.forEach((s, i) => { let share = budget / chosen.length + carry; carry = 0; const taken = []; let sub = 0; while (s.q.length && (sub === 0 || sub + s.q[0].seconds <= share + 600)) { const l = s.q.shift(); taken.push(l); sub += l.seconds; } carry = Math.max(0, share - sub); used += sub; if (taken.length) { const by = new Map(); taken.forEach((l) => { if (!by.has(l.chapterId)) by.set(l.chapterId, { subject: s.name, chapterId: l.chapterId, chapter: l.chapter, lectures: [] }); by.get(l.chapterId).lectures.push({ id: l.id, number: l.number, name: l.name, seconds: l.seconds }); }); by.forEach((g) => { g.seconds = g.lectures.reduce((x, l) => x + l.seconds, 0); items.push(g); }); } });
      if (items.length) days.push({ date: d, seconds: used, items });
    }
    if (qs.some((s) => s.q.length)) throw bad('This plan runs longer than 2 years. Increase daily hours or remove subjects.');
    return { days, total, count, hours, finishDate: days.length ? days[days.length - 1].date : cfg.startDate, feasible: !cfg.finishBy || !rec || rec <= 14 };
  }
  const api = {
    preview(inp) { const cfg = clean(inp); const s = schedule(cfg); return { lecturesLeft: s.count, contentSeconds: s.total, hoursPerDay: s.hours, finishDate: s.finishDate, studyDays: s.days.length, perSubject: cfg.subjects.map((x) => ({ name: x.name, lectures: queues(cfg, new Set()).find((q) => q.name === x.name).q.length })), beforeExam: !examDate(cfg.examMonth) || s.finishDate < examDate(cfg.examMonth), recommended: cfg.finishBy ? s.hours : null, feasible: s.feasible }; },
    create(uid, inp, prev) { const cfg = clean(inp); const s = schedule(cfg); if (!s.feasible) throw bad(`Not possible by that date: you would need ${s.hours}h of study every day. Choose a later finish date.`); const old = prev || load(uid); const plan = { id: Date.now().toString(36), cfg, days: s.days, total: s.total, count: s.count, finishDate: s.finishDate, done: {}, createdAt: now(), reminders: { daily: old ? old.reminders.daily : false, at: old ? old.reminders.at : '10:00', newLectures: old ? old.reminders.newLectures : false } }; return save(uid, plan); },
    get(uid) { return load(uid); },
    remove(uid) { db.q('DELETE FROM plans WHERE userId=?').run(String(uid)); return { deleted: true }; },
    view(uid) {
      const p = load(uid); if (!p) return null; const t = today(); const done = p.done; const all = p.days.flatMap((d) => d.items.flatMap((i) => i.lectures)); const doneN = all.filter((l) => done[l.id]).length; const left = all.filter((l) => !done[l.id]).reduce((x, l) => x + l.seconds, 0);
      const ex = examDate(p.cfg.examMonth); const doneDays = new Set(Object.values(done).map((ts) => new Date(ts + TZ).toISOString().slice(0, 10))); let streak = 0; for (let d = doneDays.has(t) ? t : addDays(t, -1); doneDays.has(d); d = addDays(d, -1)) streak++;
      const mapDay = (d) => ({ date: d.date, seconds: d.seconds, doneCount: d.items.reduce((x, i) => x + i.lectures.filter((l) => done[l.id]).length, 0), count: d.items.reduce((x, i) => x + i.lectures.length, 0), items: d.items.map((i) => ({ ...i, lectures: i.lectures.map((l) => ({ ...l, done: !!done[l.id] })) })) });
      const overdue = p.days.filter((d) => d.date < t && d.items.some((i) => i.lectures.some((l) => !done[l.id]))).length;
      return { id: p.id, level: p.cfg.level, examMonth: p.cfg.examMonth, finishDate: p.finishDate, total: p.count, done: doneN, pct: p.count ? Math.round(doneN / p.count * 100) : 0, secondsLeft: left, daysToExam: ex ? Math.max(0, Math.round((Date.parse(ex) - Date.parse(t)) / 864e5)) : null, streak, today: p.days.find((d) => d.date === t) ? mapDay(p.days.find((d) => d.date === t)) : null, nextDay: p.days.find((d) => d.date > t) ? mapDay(p.days.find((d) => d.date > t)) : null, upcoming: p.days.filter((d) => d.date > t).slice(0, 14).map(mapDay), overdue, daysOff: p.cfg.daysOff, reminders: p.reminders, subjects: p.cfg.subjects.map((s) => s.name), todayDate: t, start: p.cfg.startDate, hoursPerDay: p.cfg.dailyHours };
    },
    mark(uid, lectureId, doneFlag) { const p = load(uid); if (!p) throw nf('No plan'); if (!p.days.some((d) => d.items.some((i) => i.lectures.some((l) => l.id === lectureId)))) throw nf('Lecture is not in your plan'); if (doneFlag) p.done[lectureId] = now(); else delete p.done[lectureId]; save(uid, p); return api.view(uid); },
    markMany(uid, ids, flag) { const p = load(uid); if (!p) throw nf('No plan'); const valid = new Set(p.days.flatMap((d) => d.items.flatMap((i) => i.lectures.map((l) => l.id)))); ids.filter((i) => valid.has(i)).forEach((i) => { if (flag) p.done[i] = now(); else delete p.done[i]; }); save(uid, p); return api.view(uid); },
    reschedule(uid, patch = {}) { const p = load(uid); if (!p) throw nf('No plan'); const cfg = clean({ ...p.cfg, ...patch, startDate: today(), subjects: p.cfg.subjects }); const doneSet = new Set(Object.keys(p.done)); const s = schedule(cfg, doneSet, today()); const past = p.days.filter((d) => d.date < today() && d.items.some((i) => i.lectures.some((l) => p.done[l.id]))).map((d) => ({ ...d, items: d.items.map((i) => ({ ...i, lectures: i.lectures.filter((l) => p.done[l.id]) })).filter((i) => i.lectures.length) })); p.cfg = { ...cfg, startDate: p.cfg.startDate }; p.days = past.concat(s.days); p.finishDate = s.finishDate; p.count = Object.keys(p.done).length + s.count; save(uid, p); return api.view(uid); },
    addDayOff(uid, date) { if (!validDate(date)) throw bad('Invalid date'); const p = load(uid); if (!p) throw nf('No plan'); return api.reschedule(uid, { daysOff: [...new Set([...p.cfg.daysOff, date])] }); },
    removeDayOff(uid, date) { const p = load(uid); if (!p) throw nf('No plan'); return api.reschedule(uid, { daysOff: p.cfg.daysOff.filter((d) => d !== date) }); },
    addSubject(uid, s) { const p = load(uid); if (!p) throw nf('No plan'); if (p.cfg.subjects.some((x) => x.name === s.name)) throw bad('That subject is already in your plan'); const ns = [...p.cfg.subjects, s]; const cfg = clean({ ...p.cfg, subjects: ns, startDate: today() }); const done = new Set(Object.keys(p.done)); const sc = schedule(cfg, done, today()); p.cfg = { ...cfg, startDate: p.cfg.startDate }; p.days = p.days.filter((d) => d.date < today()).concat(sc.days); p.finishDate = sc.finishDate; p.count = done.size + sc.count; save(uid, p); return api.view(uid); },
    changeToday(uid, subjectName) { const p = load(uid); if (!p) throw nf('No plan'); if (!p.cfg.subjects.some((s) => s.name === subjectName)) throw bad('Unknown subject'); return api.reschedule(uid, { pinned: [subjectName], perDay: 1, mode: 'mixed' }); },
    setReminders(uid, r) { const p = load(uid); if (!p) throw nf('No plan'); if (r.at !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.at)) throw bad('Time must be HH:MM'); p.reminders = { daily: r.daily === undefined ? p.reminders.daily : !!r.daily, at: r.at || p.reminders.at, newLectures: r.newLectures === undefined ? p.reminders.newLectures : !!r.newLectures }; save(uid, p); return api.view(uid); },
    dueReminders(hhmm, day) { const out = []; for (const r of db.q('SELECT userId,data FROM plans').all()) { const p = JSON.parse(r.data); if (p.reminders && p.reminders.daily && p.reminders.at === hhmm && db.kv.get(`remind:${r.userId}:${day}`) !== '1') { const d = p.days.find((x) => x.date === day); if (d) out.push({ userId: r.userId, day: d, level: p.cfg.level }); } } return out; },
    plansWithAlerts(batchId) { return db.q('SELECT userId,data FROM plans').all().filter((r) => { const p = JSON.parse(r.data); return p.reminders && p.reminders.newLectures && p.cfg.subjects.some((s) => s.batchId === batchId); }).map((r) => r.userId); },
    pdf(uid) {
      const v = api.view(uid); const p = load(uid); if (!v) throw nf('No plan'); const pages = []; let pg, y; const CR = [0.6, 0.2, 0.33];
      const head = () => { pg = new Page(); pages.push(pg); y = 0; if (pages.length === 1) { pg.rect(0, 0, 595, 64, CR); pg.text(40, 22, 20, `${p.cfg.level === 'foundation' ? 'CA Foundation' : 'CA Intermediate'} Study Plan`, { bold: true, rgb: [1, 1, 1] }); pg.text(40, 80, 9, `Exam: ${p.cfg.examMonth || '-'}`, { rgb: [0.35, 0.35, 0.4] }); pg.text(40, 93, 9, `Generated: ${new Date(now() + TZ).toISOString().slice(0, 10)}`, { rgb: [0.35, 0.35, 0.4] }); pg.rect(40, 112, 515, 44, [0.99, 0.93, 0.95]); pg.text(52, 121, 10, `Progress: ${v.done}/${v.total} lectures (${v.pct}%)`, { bold: true, rgb: CR }); pg.text(52, 137, 9, `Total content: ${hm(p.days.reduce((x, d) => x + d.seconds, 0))}  |  Finish: ${p.finishDate}`, { rgb: [0.35, 0.35, 0.4] }); y = 176; } else y = 40; };
      head();
      for (const d of p.days) { const need = 30 + d.items.reduce((x, i) => x + 16 + i.lectures.length * 14, 0); if (y + need > 790) head(); pg.rect(40, y, 515, 18, [0.96, 0.96, 0.98]); const dt = new Date(d.date + 'T00:00:00Z'); pg.text(46, y + 4, 10, dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }), { bold: true }); pg.text(500, y + 5, 8, `${(d.seconds / 3600).toFixed(1)}h total`, { rgb: [0.5, 0.5, 0.55] }); y += 24;
        for (const i of d.items) { pg.text(46, y, 9, `${i.subject}: ${i.chapter}`, { bold: true, rgb: CR }); y += 14; for (const l of i.lectures) { pg.box(54, y + 1, 8); pg.text(70, y, 8.5, `Lecture ${String(l.number).padStart(2, '0')}  (${hm(l.seconds)})`); y += 13; } y += 3; } pg.line(40, y, 555); y += 8; }
      pages.forEach((x, i) => x.text(240, 818, 8, `${p.cfg.level === 'foundation' ? 'CA Foundation' : 'CA Intermediate'} Planner - Page ${i + 1} of ${pages.length}`, { rgb: [0.6, 0.6, 0.65] })); return build(pages);
    },
  };
  return api;
}
module.exports = { createPlanner, examDate, MONTHS };
