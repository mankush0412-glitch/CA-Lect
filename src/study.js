'use strict';
/**
 * Study tracker: timer, daily goal, streaks, badges, leaderboards, live view, recap, profile, groups + chat.
 * Time is counted SERVER-SIDE from start→stop/heartbeat; the client never sends durations.
 * Day boundaries use IST (UTC+5:30). A day "counts" for streaks when >= 30 minutes were studied.
 */
const crypto = require('crypto');
const chatSeen = new Map();
const { HttpError } = require('./service');
const bad = (m) => new HttpError(400, m); const nf = (m) => new HttpError(404, m); const forbidden = (m) => new HttpError(403, m || 'Forbidden');

const TZ_MIN = 330, STREAK_MIN_SEC = 1800, BEAT_GRACE_MS = 90e3, STALE_MS = 150e3, MAX_SESSION_SEC = 14 * 3600;
const DEFAULT_SUBJECTS = { foundation: ['Accounts', 'Laws', 'Economics', 'Quant'], intermediate: ['Adv. Accounts', 'Corp. Laws', 'Costing', 'Auditing', 'FM', 'SM', 'Income Tax', 'GST'] };
const BADGES = [
  { id: 'd1', group: 'Daily', name: '1h Day', icon: 'clock', kind: 'best_day', target: 3600, unit: 'm' },
  { id: 'd4', group: 'Daily', name: '4h Day', icon: 'flame', kind: 'best_day', target: 4 * 3600, unit: 'h' },
  { id: 'd8', group: 'Daily', name: '8h Champion', icon: 'crown', kind: 'best_day', target: 8 * 3600, unit: 'h' },
  { id: 's3', group: 'Streak', name: '3-Day Streak', icon: 'bolt', kind: 'streak', target: 3 },
  { id: 's7', group: 'Streak', name: 'Week Warrior', icon: 'calendar', kind: 'streak', target: 7 },
  { id: 's30', group: 'Streak', name: 'Iron Will', icon: 'shield', kind: 'streak', target: 30 },
  { id: 't10', group: 'Total hours', name: '10h Club', icon: 'plant', kind: 'total', target: 10 * 3600 },
  { id: 't50', group: 'Total hours', name: '50h Scholar', icon: 'book', kind: 'total', target: 50 * 3600 },
  { id: 't100', group: 'Total hours', name: '100h Centurion', icon: 'target', kind: 'total', target: 100 * 3600 },
  { id: 't500', group: 'Total hours', name: 'Legend', icon: 'star', kind: 'total', target: 500 * 3600 },
  { id: 't1000', group: 'Total hours', name: '1000h Titan', icon: 'trophy', kind: 'total', target: 1000 * 3600 },
  { id: 't2000', group: 'Total hours', name: '2000h Elite', icon: 'diamond', kind: 'total', target: 2000 * 3600 },
  { id: 't5000', group: 'Total hours', name: '5000h Immortal', icon: 'infinity', kind: 'total', target: 5000 * 3600 },
  { id: 'all', group: 'Special', name: 'All-Rounder', icon: 'gift', kind: 'subjects_day', target: 0 },
];
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max);

function createStudy({ sqlite, store, userDb, banDb, isStaff, subjectCatalog, now = () => Date.now(), mirror, mirrorDel }) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS study_day (userId TEXT NOT NULL, day TEXT NOT NULL, subject TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (userId, day, subject));
    CREATE INDEX IF NOT EXISTS idx_study_day_day ON study_day(day, userId);
    CREATE TABLE IF NOT EXISTS study_active (userId TEXT PRIMARY KEY, subject TEXT NOT NULL, startedAt INTEGER NOT NULL, lastBeat INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS study_member (groupId TEXT NOT NULL, userId TEXT NOT NULL, joinedAt INTEGER NOT NULL, lastRead INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (groupId, userId));
    CREATE INDEX IF NOT EXISTS idx_study_member_user ON study_member(userId);
    CREATE TABLE IF NOT EXISTS study_msg (id INTEGER PRIMARY KEY AUTOINCREMENT, groupId TEXT NOT NULL, userId TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, replyTo INTEGER, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_study_msg_group ON study_msg(groupId, id);
  `);
  const q = (sql) => sqlite.prepare(sql);
  const dayOf = (ts) => new Date(ts + TZ_MIN * 60000).toISOString().slice(0, 10);
  const dayStartMs = (day) => Date.parse(day + 'T00:00:00Z') - TZ_MIN * 60000;
  const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const weekStart = (day) => addDays(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));
  const validDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d));
  const bump = (uid, day, subject, sec) => {
    q('INSERT INTO study_day(userId,day,subject,seconds) VALUES(?,?,?,?) ON CONFLICT(userId,day,subject) DO UPDATE SET seconds=seconds+excluded.seconds').run(uid, day, subject, sec);
    if (mirror) { const r = q('SELECT seconds FROM study_day WHERE userId=? AND day=? AND subject=?').get(uid, day, subject); mirror('study_day', `${uid}|${day}|${subject}`, { userId: uid, day, subject, seconds: r.seconds }); }
  };

  // ── profile ────────────────────────────────────────────────────────────────
  const profileOf = (uid) => store.get('study_profile', uid) || { id: uid, displayName: '', goalMin: 240, customSubjects: [], pomodoro: false };
  function displayName(uid) {
    const p = store.get('study_profile', uid); if (p && p.displayName) return p.displayName;
    const u = userDb.findOne(uid) || {}; const n = clean([u.firstName, (u.lastName || '')[0] ? u.lastName[0] + '.' : ''].filter(Boolean).join(' '), 24);
    return n || 'Student ' + String(uid).slice(-4);
  }
  function subjectsFor(uid, level) {
    const lv = level === 'foundation' ? 'foundation' : 'intermediate'; let base = subjectCatalog ? subjectCatalog(lv) : [];
    if (!base.length) base = DEFAULT_SUBJECTS[lv]; return [...base, ...profileOf(uid).customSubjects];
  }

  // ── timer ──────────────────────────────────────────────────────────────────
  function finalize(uid, endTs) {
    const a = q('SELECT * FROM study_active WHERE userId=?').get(uid); if (!a) return 0;
    const end = Math.min(endTs, a.lastBeat + BEAT_GRACE_MS); let t = a.startedAt, total = 0;
    if (end > t) { const cap = a.startedAt + MAX_SESSION_SEC * 1000; const e = Math.min(end, cap);
      while (t < e) { const d = dayOf(t); const nextMid = dayStartMs(addDays(d, 1)); const segEnd = Math.min(e, nextMid); const sec = Math.round((segEnd - t) / 1000); if (sec > 0) { bump(uid, d, a.subject, sec); total += sec; } t = segEnd; } }
    q('DELETE FROM study_active WHERE userId=?').run(uid); return total;
  }
  function reap() { const cut = now() - STALE_MS; q('SELECT userId FROM study_active WHERE lastBeat < ?').all(cut).forEach((r) => finalize(r.userId, now())); }
  const runningSec = (a) => a ? Math.max(0, Math.min(Math.round((Math.min(now(), a.lastBeat + BEAT_GRACE_MS) - a.startedAt) / 1000), MAX_SESSION_SEC)) : 0;
  function start(uid, subject, level) {
    subject = clean(subject, 24); if (!subject) throw bad('Choose a subject');
    if (!subjectsFor(uid, level).some((s) => s.toLowerCase() === subject.toLowerCase())) throw bad('Unknown subject');
    finalize(uid, now()); q('INSERT INTO study_active(userId,subject,startedAt,lastBeat) VALUES(?,?,?,?)').run(uid, subject, now(), now()); return state(uid, level);
  }
  function beat(uid, level) { const r = q('UPDATE study_active SET lastBeat=? WHERE userId=?').run(now(), uid); return state(uid, level); }
  function stop(uid, level) { finalize(uid, now()); return state(uid, level); }
  function rows(uid, fromDay, toDay) { return q('SELECT day,subject,seconds FROM study_day WHERE userId=? AND day>=? AND day<=?').all(uid, fromDay, toDay); }
  function dayTotals(uid) { return q('SELECT day, SUM(seconds) s, COUNT(DISTINCT subject) n FROM study_day WHERE userId=? GROUP BY day ORDER BY day').all(uid); }
  function streaks(list, today) {
    const ok = new Set(list.filter((d) => d.s >= STREAK_MIN_SEC).map((d) => d.day)); if (!ok.size) return { current: 0, best: 0 };
    let cur = 0, d = ok.has(today) ? today : addDays(today, -1); while (ok.has(d)) { cur++; d = addDays(d, -1); }
    let best = 0, run = 0, prev = null; [...ok].sort().forEach((x) => { run = prev && addDays(prev, 1) === x ? run + 1 : 1; best = Math.max(best, run); prev = x; }); return { current: cur, best };
  }
  function state(uid, level) {
    reap(); const today = dayOf(now()); const a = q('SELECT * FROM study_active WHERE userId=?').get(uid); const p = profileOf(uid);
    const todayRows = rows(uid, today, today); const per = {}; todayRows.forEach((r) => { per[r.subject] = (per[r.subject] || 0) + r.seconds; });
    if (a) per[a.subject] = (per[a.subject] || 0) + runningSec(a);
    const total = Object.values(per).reduce((x, y) => x + y, 0); const st = streaks(dayTotals(uid), today);
    return { today, serverTime: now(), todaySeconds: total, goalSeconds: p.goalMin * 60, goalPct: Math.min(100, Math.round(total / (p.goalMin * 60) * 100)), active: a ? { subject: a.subject, startedAt: a.startedAt, runningSeconds: runningSec(a) } : null, pomodoro: !!p.pomodoro, streak: st.current, bestStreak: st.best,
      subjects: subjectsFor(uid, level).map((s) => ({ name: s, seconds: per[s] || 0, custom: p.customSubjects.includes(s) })) };
  }

  // ── leaderboard / live ─────────────────────────────────────────────────────
  function range(period) { const t = dayOf(now()); if (period === 'today') return [t, t]; if (period === 'week') return [weekStart(t), addDays(weekStart(t), 6)]; if (period === 'all') return ['0000-00-00', '9999-12-31']; throw bad('period must be today, week or all'); }
  function decorate(list, uid) {
    if (!list.length) return [];
    const ids = list.map((r) => r.userId); const ph = ids.map(() => '?').join(','); const today = dayOf(now());
    const days = q(`SELECT userId, day, SUM(seconds) s FROM study_day WHERE userId IN (${ph}) GROUP BY userId, day`).all(...ids); const tot = {}, byU = {};
    days.forEach((d) => { (byU[d.userId] = byU[d.userId] || []).push({ day: d.day, s: d.s }); tot[d.userId] = (tot[d.userId] || 0) + d.s; });
    const act = {}; q(`SELECT * FROM study_active WHERE userId IN (${ph})`).all(...ids).forEach((a) => { if (a.lastBeat > now() - STALE_MS) act[a.userId] = a; });
    return list.map((r, i) => { const t = tot[r.userId] || 0; const st = streaks(byU[r.userId] || [], today); return { rank: r.rank || i + 1, userId: r.userId, name: displayName(r.userId), seconds: r.seconds, live: !!act[r.userId], subject: act[r.userId] ? act[r.userId].subject : null, streak: st.current, badges: { hours: t >= 10 * 3600, streak: st.current >= 3 || st.best >= 3, crown: t >= 100 * 3600 }, me: r.userId === uid }; });
  }
  /** Course-wise scope: ids of students whose chosen course is `level` (unset counts as intermediate). */
  function levelIds(level) { if (level !== 'foundation' && level !== 'intermediate') return null; try { return new Set(q("SELECT userId FROM users WHERE COALESCE(NULLIF(level,''),'intermediate')=?").all(level).map((r) => r.userId)); } catch (e) { return null; } }
  function leaderboard(uid, period, userIds, level) {
    reap(); const [a, b] = range(period); const live = {}; q('SELECT * FROM study_active').all().forEach((x) => { live[x.userId] = runningSec(x); });
    let base = q(`SELECT userId, SUM(seconds) seconds FROM study_day WHERE day>=? AND day<=? ${userIds ? 'AND userId IN (' + userIds.map(() => '?').join(',') + ')' : ''} GROUP BY userId`).all(a, b, ...(userIds || []));
    const lvSet = userIds ? null : levelIds(level); if (lvSet) base = base.filter((r) => lvSet.has(r.userId)); const m = new Map(base.map((r) => [r.userId, r.seconds])); const inScope = (id) => (userIds ? userIds.includes(id) : !lvSet || lvSet.has(id));
    Object.entries(live).forEach(([id, s]) => { if (inScope(id) && (period === 'today' || period === 'week' || period === 'all')) m.set(id, (m.get(id) || 0) + s); });
    const all = [...m.entries()].filter(([, s]) => s > 0).map(([userId, seconds]) => ({ userId, seconds })).sort((x, y) => y.seconds - x.seconds || x.userId.localeCompare(y.userId));
    all.forEach((r, i) => { r.rank = i + 1; }); const top = all.slice(0, 50); const mine = all.find((r) => r.userId === uid);
    const dec = decorate(top.concat(mine && mine.rank > 50 ? [mine] : []), uid); return { period, students: all.length, rows: dec.filter((r) => r.rank <= 50), me: dec.find((r) => r.me) || null };
  }
  function liveNow(uid, level) {
    reap(); const today = dayOf(now()); const lvSet = levelIds(level); const act = q('SELECT * FROM study_active WHERE lastBeat >= ? ORDER BY startedAt').all(now() - STALE_MS).filter((a) => !lvSet || lvSet.has(a.userId));
    const tod = {}; q('SELECT userId, SUM(seconds) s FROM study_day WHERE day=? GROUP BY userId').all(today).forEach((r) => { tod[r.userId] = r.s; });
    const list = decorate(act.map((a) => ({ userId: a.userId, seconds: (tod[a.userId] || 0) + runningSec(a) })), uid).sort((x, y) => y.seconds - x.seconds); return { online: list.length, students: list };
  }

  // ── recap / history / badges ───────────────────────────────────────────────
  function recap(uid, period, ref) {
    reap(); const t = ref && validDay(ref) ? ref : dayOf(now()); let from, to, label;
    if (period === 'day') { from = to = t; label = t; } else if (period === 'week') { from = weekStart(t); to = addDays(from, 6); label = from + ' → ' + to; }
    else if (period === 'month') { from = t.slice(0, 8) + '01'; const d = new Date(from + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); to = addDays(d.toISOString().slice(0, 10), -1); label = t.slice(0, 7); }
    else if (period === 'all') { const f = q('SELECT MIN(day) d FROM study_day WHERE userId=?').get(uid).d; from = f || t; to = t; label = 'All time'; } else throw bad('period must be day, week, month or all');
    const rs = rows(uid, from, to); const a = q('SELECT * FROM study_active WHERE userId=?').get(uid); if (a && dayOf(now()) >= from && dayOf(now()) <= to) rs.push({ day: dayOf(now()), subject: a.subject, seconds: runningSec(a) });
    const byDay = {}, bySub = {}; rs.forEach((r) => { byDay[r.day] = (byDay[r.day] || 0) + r.seconds; bySub[r.subject] = (bySub[r.subject] || 0) + r.seconds; });
    const total = Object.values(byDay).reduce((x, y) => x + y, 0); const goal = profileOf(uid).goalMin * 60; const days = []; for (let d = from; d <= to && days.length < 400; d = addDays(d, 1)) days.push({ day: d, seconds: byDay[d] || 0 });
    const spanDays = Math.max(1, Math.min(days.length, period === 'all' ? days.length : Math.round((Math.min(Date.parse(to), Date.parse(t)) - Date.parse(from)) / 864e5) + 1));
    return { period, from, to, label, totalSeconds: total, daysActive: days.filter((d) => d.seconds > 0).length, daysInRange: days.length, avgSeconds: Math.round(total / spanDays), goalsHit: days.filter((d) => d.seconds >= goal && goal > 0).length, daily: period === 'all' ? [] : days, subjects: Object.entries(bySub).map(([name, seconds]) => ({ name, seconds })).sort((x, y) => y.seconds - x.seconds) };
  }
  function history(uid, month) {
    const m = /^\d{4}-\d{2}$/.test(month || '') ? month : dayOf(now()).slice(0, 7); const from = m + '-01'; const d = new Date(from + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); const to = addDays(d.toISOString().slice(0, 10), -1);
    const by = {}; rows(uid, from, to).forEach((r) => { by[r.day] = (by[r.day] || 0) + r.seconds; }); return { month: m, days: by };
  }
  function dayDetail(uid, day) { if (!validDay(day)) throw bad('Invalid day'); return { day, subjects: rows(uid, day, day).map((r) => ({ name: r.subject, seconds: r.seconds })).sort((a, b) => b.seconds - a.seconds) }; }
  function badges(uid) {
    reap(); const list = dayTotals(uid); const total = list.reduce((x, y) => x + y.s, 0); const today = dayOf(now()); const st = streaks(list, today); const bestDay = Math.max(0, ...list.map((d) => d.s)); const todayRow = list.find((d) => d.day === today) || { s: 0, n: 0 };
    const allTarget = Math.max(2, subjectsFor(uid, null).length); const maxSub = Math.max(0, ...list.map((d) => d.n));
    const out = BADGES.map((b) => { let have, target = b.target; if (b.kind === 'best_day') have = bestDay; else if (b.kind === 'streak') have = Math.max(st.best, st.current); else if (b.kind === 'total') have = total; else { have = maxSub; target = allTarget; }
      const pct = Math.min(100, Math.round(have / target * 100)); const left = Math.max(0, target - have); let hint;
      if (b.kind === 'streak') hint = pct >= 100 ? 'Earned' : `${left} more days`; else if (b.kind === 'subjects_day') hint = pct >= 100 ? 'Earned' : `${left} more subjects today`; else hint = pct >= 100 ? 'Earned' : (left >= 3600 ? `${Math.ceil(left / 3600)}h to go` : `${Math.ceil(left / 60)}m more`);
      return { id: b.id, group: b.group, name: b.name, icon: b.icon, earned: pct >= 100, pct, hint }; });
    return { earned: out.filter((b) => b.earned).length, total: out.length, badges: out, totalSeconds: total, today: todayRow.s, streak: st.current, bestStreak: st.best };
  }
  const profile = {
    get(uid, level) { const p = profileOf(uid); const st = streaks(dayTotals(uid), dayOf(now())); return { displayName: displayName(uid), hasCustomName: !!p.displayName, goalMin: p.goalMin, customSubjects: p.customSubjects, customLimit: 4, pomodoro: !!p.pomodoro, streak: st.current, bestStreak: st.best, today: state(uid, level).todaySeconds }; },
    update(uid, b) {
      const p = { ...profileOf(uid) };
      if (b.displayName !== undefined) { const n = clean(b.displayName, 24); if (n && n.length < 2) throw bad('Name must be at least 2 characters'); p.displayName = n; }
      if (b.goalMin !== undefined) { const g = Math.round(Number(b.goalMin)); if (!(g >= 15 && g <= 960)) throw bad('Goal must be between 15 minutes and 16 hours'); p.goalMin = g; }
      if (b.pomodoro !== undefined) p.pomodoro = !!b.pomodoro;
      if (b.customSubjects !== undefined) { if (!Array.isArray(b.customSubjects)) throw bad('customSubjects must be a list'); const l = [...new Set(b.customSubjects.map((s) => clean(s, 20)).filter(Boolean))]; if (l.length > 4) throw bad('Up to 4 custom subjects'); p.customSubjects = l; }
      store.put('study_profile', uid, p); return profile.get(uid);
    },
    clearToday(uid) { finalize(uid, now()); const d = dayOf(now()); const rs = q('SELECT subject FROM study_day WHERE userId=? AND day=?').all(uid, d); q('DELETE FROM study_day WHERE userId=? AND day=?').run(uid, d); if (mirrorDel) rs.forEach((r) => mirrorDel('study_day', `${uid}|${d}|${r.subject}`)); return { cleared: true }; },
    deleteAll(uid) { q('DELETE FROM study_active WHERE userId=?').run(uid); const rs = q('SELECT day,subject FROM study_day WHERE userId=?').all(uid); q('DELETE FROM study_day WHERE userId=?').run(uid); if (mirrorDel) rs.forEach((r) => mirrorDel('study_day', `${uid}|${r.day}|${r.subject}`)); store.del('study_profile', uid); return { deleted: true }; },
  };

  // ── groups & chat ──────────────────────────────────────────────────────────
  const CODE_CH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const newCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_CH[b % CODE_CH.length]).join('');
  const groups = () => store.list('study_group'); const memberCount = (gid) => q('SELECT COUNT(*) c FROM study_member WHERE groupId=?').get(gid).c;
  const isMember = (gid, uid) => !!q('SELECT 1 x FROM study_member WHERE groupId=? AND userId=?').get(gid, uid);
  const memberIds = (gid) => q('SELECT userId FROM study_member WHERE groupId=?').all(gid).map((r) => r.userId);
  function join(uid, gid) { if (!isMember(gid, uid)) { const last = q('SELECT COALESCE(MAX(id),0) m FROM study_msg WHERE groupId=?').get(gid).m; q('INSERT INTO study_member(groupId,userId,joinedAt,lastRead) VALUES(?,?,?,?)').run(gid, uid, now(), last); if (mirror) mirror('study_member', `${gid}|${uid}`, { groupId: gid, userId: uid, joinedAt: now() }); } }
  function ensureOfficial(uid, level) {
    for (const lv of ['foundation', 'intermediate']) { const id = 'official_' + lv; if (!store.get('study_group', id)) store.put('study_group', id, { name: lv === 'foundation' ? 'CA Foundation' : 'CA Intermediate', isPublic: true, official: true, code: lv === 'foundation' ? 'CAFOUN' : 'CAINTR', createdBy: 'system', createdAt: now() }); }
    if (uid && level) join(uid, 'official_' + (level === 'foundation' ? 'foundation' : 'intermediate'));
  }
  function liveIn(ids) { if (!ids.length) return 0; const act = q('SELECT userId FROM study_active WHERE lastBeat >= ?').all(now() - STALE_MS); const set = new Set(ids); return act.filter((a) => set.has(a.userId)).length; }
  function groupBrief(g, uid) {
    const ids = memberIds(g.id); const last = q('SELECT * FROM study_msg WHERE groupId=? ORDER BY id DESC LIMIT 1').get(g.id); const mem = uid ? q('SELECT lastRead FROM study_member WHERE groupId=? AND userId=?').get(g.id, uid) : null;
    const unread = mem ? q('SELECT COUNT(*) c FROM study_msg WHERE groupId=? AND id>? AND userId<>?').get(g.id, mem.lastRead, uid).c : 0;
    return { id: g.id, name: g.name, isPublic: g.isPublic, official: !!g.official, members: ids.length, studying: liveIn(ids), unread, last: last ? { name: last.name, text: last.text.slice(0, 80), at: last.at } : null };
  }
  const groupsApi = {
    list(uid, level) { ensureOfficial(uid, level); const mine = groups().filter((g) => isMember(g.id, uid)).map((g) => groupBrief(g, uid)).sort((a, b) => ((b.last && b.last.at) || 0) - ((a.last && a.last.at) || 0));
      const pub = groups().filter((g) => g.isPublic && !isMember(g.id, uid)).map((g) => groupBrief(g, uid)).sort((a, b) => b.members - a.members).slice(0, 30); return { mine, public: pub, unread: mine.reduce((x, g) => x + g.unread, 0) }; },
    unread(uid) { return groups().filter((g) => isMember(g.id, uid)).reduce((x, g) => x + groupBrief(g, uid).unread, 0); },
    create(uid, b) {
      const name = clean(b.name, 30); if (name.length < 2) throw bad('Group name must be at least 2 characters');
      if (groups().filter((g) => g.createdBy === uid).length >= 3) throw bad('You can create up to 3 groups');
      if (q('SELECT COUNT(*) c FROM study_member WHERE userId=?').get(uid).c >= 15) throw bad('You can be in up to 15 groups');
      let code; do { code = newCode(); } while (groups().some((g) => g.code === code)); const id = crypto.randomBytes(6).toString('hex');
      store.put('study_group', id, { name, isPublic: !!b.isPublic, code, createdBy: uid, createdAt: now() }); join(uid, id); return groupsApi.info(uid, id);
    },
    joinByCode(uid, code) { code = clean(code, 8).toUpperCase(); const g = groups().find((x) => x.code === code); if (!g) throw nf('No group with this code'); if (q('SELECT COUNT(*) c FROM study_member WHERE userId=?').get(uid).c >= 15 && !isMember(g.id, uid)) throw bad('You can be in up to 15 groups'); join(uid, g.id); return groupsApi.info(uid, g.id); },
    joinPublic(uid, gid) { const g = store.get('study_group', gid); if (!g || !g.isPublic) throw nf('Group not found'); join(uid, gid); return groupsApi.info(uid, gid); },
    info(uid, gid, period = 'today') { const g = store.get('study_group', gid); if (!g) throw nf('Group not found'); if (!isMember(gid, uid) && !g.isPublic) throw forbidden('Join this group first');
      const ids = memberIds(gid); const member = isMember(gid, uid); const lb = leaderboard(uid, period, ids.length ? ids : ['-']); const todayAll = leaderboard(uid, 'today', ids.length ? ids : ['-']);
      const liveList = decorate(q('SELECT userId FROM study_active WHERE lastBeat >= ?').all(now() - STALE_MS).filter((a) => ids.includes(a.userId)).map((a) => ({ userId: a.userId, seconds: 0 })), uid);
      return { ...groupBrief(g, uid), member, code: member ? g.code : null, todaySeconds: todayAll.rows.reduce((x, r) => x + r.seconds, 0), studyingNow: liveList.map((r) => ({ name: r.name, subject: r.subject })), leaderboard: lb.rows.slice(0, 20), canDelete: g.createdBy === uid }; },
    leave(uid, gid) { const g = store.get('study_group', gid); if (!g) throw nf('Group not found'); if (g.official) throw bad('You cannot leave the official group'); q('DELETE FROM study_member WHERE groupId=? AND userId=?').run(gid, uid); if (mirrorDel) mirrorDel('study_member', `${gid}|${uid}`); return { left: true }; },
    messages(uid, gid, after = 0) { const g = store.get('study_group', gid); if (!g) throw nf('Group not found'); if (!isMember(gid, uid)) throw forbidden('Join this group to read the chat'); after = parseInt(after) || 0;
      let seen = chatSeen.get(gid); if (!seen) chatSeen.set(gid, seen = new Map()); seen.set(uid, Date.now()); for (const [k, t] of seen) if (Date.now() - t > 45000) seen.delete(k);
      const rowsM = after ? q('SELECT * FROM study_msg WHERE groupId=? AND id>? ORDER BY id LIMIT 100').all(gid, after) : q('SELECT * FROM (SELECT * FROM study_msg WHERE groupId=? ORDER BY id DESC LIMIT 60) ORDER BY id').all(gid);
      if (rowsM.length) q('UPDATE study_member SET lastRead=MAX(lastRead,?) WHERE groupId=? AND userId=?').run(rowsM[rowsM.length - 1].id, gid, uid);
      const byId = new Map(rowsM.map((m) => [m.id, m])); const msgs = rowsM.map((m) => { const r = m.replyTo ? (byId.get(m.replyTo) || q('SELECT * FROM study_msg WHERE id=? AND groupId=?').get(m.replyTo, gid)) : null; return { id: m.id, userId: m.userId, name: m.name, text: m.text, at: m.at, mine: m.userId === uid, admin: m.userId === g.createdBy || !!(isStaff && isStaff(m.userId)), reply: r ? { name: r.name, text: r.text.slice(0, 120) } : null }; });
      return { group: { id: g.id, name: g.name, members: memberCount(gid), online: liveIn(memberIds(gid)), chatNow: seen.size }, messages: msgs }; },
    post(uid, gid, b) { const g = store.get('study_group', gid); if (!g) throw nf('Group not found'); if (!isMember(gid, uid)) throw forbidden('Join this group first');
      const text = clean(b.text, 500); if (!text) throw bad('Message is empty'); const last = q('SELECT at FROM study_msg WHERE groupId=? AND userId=? ORDER BY id DESC LIMIT 1').get(gid, uid); if (last && now() - last.at < 1200) throw new HttpError(429, 'You are sending messages too fast');
      let replyTo = null; if (b.replyTo) { const r = q('SELECT id FROM study_msg WHERE id=? AND groupId=?').get(parseInt(b.replyTo), gid); if (r) replyTo = r.id; }
      const info = q('INSERT INTO study_msg(groupId,userId,name,text,replyTo,at) VALUES(?,?,?,?,?,?)').run(gid, uid, displayName(uid), text, replyTo, now());
      if (Math.random() < 0.02) q('DELETE FROM study_msg WHERE groupId=? AND id <= (SELECT MAX(id)-1500 FROM study_msg WHERE groupId=?)').run(gid, gid); // keep the last ~1500 per group
      return { id: Number(info.lastInsertRowid) }; },
  };

  // ── admin helpers ──────────────────────────────────────────────────────────
  const admin = {
    overview() { reap(); const today = dayOf(now()); const act = q('SELECT COUNT(*) c FROM study_active WHERE lastBeat >= ?').get(now() - STALE_MS).c; const tot = q('SELECT COALESCE(SUM(seconds),0) s, COUNT(DISTINCT userId) u FROM study_day WHERE day=?').get(today);
      const trend = []; for (let i = 13; i >= 0; i--) { const d = addDays(today, -i); const r = q('SELECT COALESCE(SUM(seconds),0) s, COUNT(DISTINCT userId) u FROM study_day WHERE day=?').get(d); trend.push({ day: d, seconds: r.s, students: r.u }); }
      const subs = q('SELECT subject, SUM(seconds) s FROM study_day WHERE day>=? GROUP BY subject ORDER BY s DESC LIMIT 10').all(addDays(today, -6));
      return { liveNow: act, studentsToday: tot.u, secondsToday: tot.s, totalStudentsEver: q('SELECT COUNT(DISTINCT userId) c FROM study_day').get().c, groups: groups().length, messagesTotal: q('SELECT COUNT(*) c FROM study_msg').get().c, trend, subjects7d: subs.map((r) => ({ name: r.subject, seconds: r.s })), topToday: leaderboard('', 'today').rows.slice(0, 10) }; },
    live() { return liveNow(''); },
    groups() { return groups().map((g) => ({ ...groupBrief(g, null), code: g.code, createdBy: g.createdBy, createdAt: g.createdAt })); },
    messages(gid, after) { const g = store.get('study_group', gid); if (!g) throw nf('Group not found'); const rs = q('SELECT * FROM (SELECT * FROM study_msg WHERE groupId=? ORDER BY id DESC LIMIT 100) ORDER BY id').all(gid); return { group: { id: g.id, name: g.name, members: memberCount(gid) }, messages: rs }; },
    deleteMessage(gid, mid) { const r = q('DELETE FROM study_msg WHERE id=? AND groupId=?').run(parseInt(mid), gid); if (!r.changes) throw nf('Message not found'); return { deleted: true }; },
    members(gid) { return q('SELECT userId FROM study_member WHERE groupId=?').all(gid).map((m) => ({ userId: m.userId, name: displayName(m.userId) })); },
    removeMember(gid, uid) { const g = store.get('study_group', gid); if (!g) throw nf('Group not found'); q('DELETE FROM study_member WHERE groupId=? AND userId=?').run(gid, uid); if (mirrorDel) mirrorDel('study_member', `${gid}|${uid}`); return { removed: true }; },
    deleteGroup(gid) { const g = store.get('study_group', gid); if (!g) throw nf('Group not found'); if (g.official) throw bad('Official groups cannot be deleted'); q('DELETE FROM study_msg WHERE groupId=?').run(gid); memberIds(gid).forEach((u) => mirrorDel && mirrorDel('study_member', `${gid}|${u}`)); q('DELETE FROM study_member WHERE groupId=?').run(gid); store.del('study_group', gid); return { deleted: true }; },
    student(uid) { const l = dayTotals(uid); const st = streaks(l, dayOf(now())); return { totalSeconds: l.reduce((x, y) => x + y.s, 0), daysStudied: l.length, streak: st.current, bestStreak: st.best, last7: recap(uid, 'week').daily }; },
    resetStudent(uid) { return profile.deleteAll(uid); },
  };

  /** Restore study rows from the Mongo mirror on a fresh disk. */
  function restore(rowsIn) { let n = 0; for (const r of rowsIn) { const d = r.data || {}; if (r.kind === 'study_day' && d.userId && d.day && d.subject) { q('INSERT OR IGNORE INTO study_day(userId,day,subject,seconds) VALUES(?,?,?,?)').run(d.userId, d.day, d.subject, d.seconds | 0); n++; } else if (r.kind === 'study_member' && d.groupId && d.userId) { q('INSERT OR IGNORE INTO study_member(groupId,userId,joinedAt,lastRead) VALUES(?,?,?,0)').run(d.groupId, d.userId, d.joinedAt || 0); n++; } } return n; }

  return { state, start, beat, stop, leaderboard, liveNow, recap, history, dayDetail, badges, profile, groups: groupsApi, admin, restore, constants: { BADGES, DEFAULT_SUBJECTS, STREAK_MIN_SEC }, _t: { dayOf, weekStart } };
}
module.exports = { createStudy };
