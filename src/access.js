'use strict';
const crypto = require('crypto');
const { HttpError } = require('./service');
const { resolveActor } = require('./rbac');
const bad = (m, c = 400) => new HttpError(c, m); const nf = (m) => new HttpError(404, m);
const TZ = 330 * 60000; const HOUR = 3600e3;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hm = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m`; };

function createAccess({ db, store, service, content, tg, ownerId, now = () => Date.now(), botUsername = () => '', storageChannelId = '', sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const dayOf = (t = now()) => new Date(t + TZ).toISOString().slice(0, 10);
  const cfg = () => service.config.get();
  const isStaff = (uid) => !!resolveActor({ id: uid }, ownerId, store);

  // ── ad servers (admin-managed) ───────────────────────────────────────────
  const servers = () => store.list('adserver').filter((s) => s.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  const claimedToday = (uid, sid) => db.q('SELECT COUNT(*) c FROM ad_claims WHERE userId=? AND serverId=? AND claimedAt IS NOT NULL AND claimedAt>=?').get(String(uid), sid, Date.parse(dayOf() + 'T00:00:00Z') - TZ).c;
  const adminServers = {
    list: () => store.list('adserver').sort((a, b) => (a.order || 0) - (b.order || 0)),
    save(b, id) {
      const cur = id ? store.get('adserver', id) : null; if (id && !cur) throw nf('Ad server not found');
      const name = String(b.name == null ? (cur && cur.name) : b.name).trim().slice(0, 40); if (!name) throw bad('Name is required');
      const url = String(b.url == null ? (cur && cur.url) || '' : b.url).trim(); if (!/^https:\/\//i.test(url)) throw bad('Ad URL must start with https://');
      const type = (b.type || (cur && cur.type) || 'access'); if (!['access', 'lectures', 'downloads'].includes(type)) throw bad('type must be access, lectures or downloads');
      const num = (v, d, lo, hi, nm) => { const n = v === undefined ? d : Number(v); if (!(n >= lo && n <= hi)) throw bad(`${nm} must be ${lo}-${hi}`); return Math.round(n); };
      const rec = { name, url, type, hours: num(b.hours, cur ? cur.hours : 12, 1, 168, 'hours'), extraLectures: num(b.extraLectures, cur ? cur.extraLectures : 3, 1, 100, 'extraLectures'), extraDownloads: num(b.extraDownloads, cur && cur.extraDownloads ? cur.extraDownloads : 3, 1, 100, 'extraDownloads'), perDay: num(b.perDay, cur ? cur.perDay : 3, 1, 20, 'perDay'), icon: ['tv', 'target', 'book', 'rocket', 'download'].includes(b.icon) ? b.icon : (cur ? cur.icon : (type === 'lectures' ? 'book' : type === 'downloads' ? 'download' : 'tv')), order: num(b.order, cur ? cur.order : store.count('adserver'), 0, 999, 'order'), active: b.active === undefined ? (cur ? cur.active !== false : true) : !!b.active };
      return store.put('adserver', id || crypto.randomBytes(5).toString('hex'), rec);
    },
    remove(id) { if (!store.get('adserver', id)) throw nf('Ad server not found'); store.del('adserver', id); return { deleted: true }; },
  };

  // ── quota & access window ────────────────────────────────────────────────
  function quota(uid) { const u = db.usage.get(uid, dayOf()); const limit = cfg().dailyLectureLimit + u.extra; return { limit, used: u.lectures, left: Math.max(0, limit - u.lectures), ads: u.ads, adsLimit: cfg().dailyAdLimit, downloadsLeft: Math.max(0, (u.dl || 0) - (u.dlUsed || 0)) }; }
  function window_(uid) { const a = db.access.findOne(uid); const t = now(); const rem = a ? Math.max(0, a.expiresMs - t) : 0; return { active: rem > 0, expiresAt: a && rem > 0 ? a.expiresAt : null, remainingMs: rem, windowMs: a ? a.windowMs : 0, pct: a && a.windowMs ? Math.min(100, Math.round(rem / a.windowMs * 100)) : 0 }; }
  function grantHours(uid, hours, reason) {
    const cur = db.access.findOne(uid); const t = now(); const base = cur && cur.expiresMs > t ? cur.expiresMs : t; const cap = t + cfg().maxAccessHours * HOUR;
    const exp = Math.min(base + hours * HOUR, cap); db.access.upsert({ userId: uid, expiresMs: exp, windowMs: Math.max(exp - t, 0) }); return window_(uid);
  }
  function state(uid) {
    const w = window_(uid); const q = quota(uid); const c = cfg();
    const mk = (s) => ({ id: s.id, name: s.name, icon: s.icon, hours: s.hours, extraLectures: s.extraLectures, extraDownloads: s.extraDownloads || 3, perDay: s.perDay, used: claimedToday(uid, s.id) });
    return { ...w, staff: isStaff(uid), servers: servers().filter((s) => s.type === 'access').map(mk), lectureServers: servers().filter((s) => s.type === 'lectures').map(mk), downloadServers: servers().filter((s) => s.type === 'downloads').map(mk), usage: { lecturesLeft: q.left, lecturesLimit: q.limit, adsWatched: q.ads, adsLimit: q.adsLimit, downloadsLeft: q.downloadsLeft }, minAdSeconds: c.minAdSeconds, proTip: !!c.proTipEnabled, premiumInfo: c.premiumInfo, supportLink: c.supportLink };
  }
  function adStart(uid, serverId) {
    const s = store.get('adserver', serverId); if (!s || s.active === false) throw nf('Ad server not found');
    if (claimedToday(uid, serverId) >= s.perDay) throw bad('Daily limit reached for this server. Try another one or come back tomorrow.', 429);
    if (db.usage.get(uid, dayOf()).ads >= cfg().dailyAdLimit) throw bad(`You have reached today's limit of ${cfg().dailyAdLimit} ads.`, 429);
    const open = db.q('SELECT COUNT(*) c FROM ad_claims WHERE userId=? AND claimedAt IS NULL AND startedAt>?').get(String(uid), now() - 30 * 60000).c; if (open >= 5) throw bad('Finish your pending ads first', 429);
    const token = crypto.randomBytes(12).toString('hex'); db.q('INSERT INTO ad_claims(token,userId,serverId,startedAt) VALUES(?,?,?,?)').run(token, String(uid), serverId, now());
    return { token, url: s.url.replace(/\{token\}/g, token).replace(/\{uid\}/g, encodeURIComponent(uid)), minSeconds: cfg().minAdSeconds };
  }
  /** Time-based claim: the student must keep the ad open for minAdSeconds. For real ad-network verification use /api/postback. */
  function adClaim(uid, token) {
    const row = db.q('SELECT * FROM ad_claims WHERE token=?').get(String(token || '')); if (!row || row.userId !== String(uid)) throw nf('Unknown ad session');
    if (row.claimedAt) throw bad('This ad was already claimed'); if (now() - row.startedAt > 30 * 60000) throw bad('This ad session expired. Start again.');
    const wait = cfg().minAdSeconds * 1000 - (now() - row.startedAt); if (wait > 0) throw bad(`Please watch the ad for ${Math.ceil(wait / 1000)} more seconds`, 425);
    return completeAd(row);
  }
  function completeAd(row) {
    const s = store.get('adserver', row.serverId); if (!s) throw nf('Ad server not found');
    const r = db.q('UPDATE ad_claims SET claimedAt=? WHERE token=? AND claimedAt IS NULL').run(now(), row.token); if (!r.changes) throw bad('This ad was already claimed');
    db.usage.bump(row.userId, dayOf(), 'ads', 1);
    if (s.type === 'lectures') db.usage.bump(row.userId, dayOf(), 'extra', s.extraLectures); else if (s.type === 'downloads') db.usage.bump(row.userId, dayOf(), 'dl', s.extraDownloads || 3); else grantHours(row.userId, s.hours, 'ad');
    return state(row.userId);
  }
  function postback(token) { const row = db.q('SELECT * FROM ad_claims WHERE token=?').get(String(token || '')); if (!row) throw nf('Unknown token'); if (row.claimedAt) return { ok: true, duplicate: true }; completeAd(row); return { ok: true }; }

  // ── batch access & delivery ──────────────────────────────────────────────
  function batchAccess(uid, batch) {
    if (isStaff(uid)) return { ok: true };
    if (!service.isBatchVisible(String(batch._id), uid)) return { ok: false, reason: 'hidden' };
    if (batch.isPremium) return (batch.premiumUsers || []).includes(String(uid)) ? { ok: true } : { ok: false, reason: 'premium' };
    return window_(uid).active ? { ok: true } : { ok: false, reason: 'access' };
  }
  const REASON = { hidden: 'This batch is not available.', premium: 'This is a Premium batch. Check Premium Benefits to unlock it.', access: 'Activate your free access in the Access tab to open chapters.' };
  async function sendWithRetry(fn) { try { return await fn(); } catch (e) { if (e.retryAfter && e.retryAfter <= 20) { await sleep(e.retryAfter * 1000 + 200); return fn(); } throw e; } }
  async function deliverLectures(uid, ids, opts = {}) {
    if (!Array.isArray(ids) || !ids.length) throw bad('Select at least one lecture'); ids = [...new Set(ids.map(String))]; if (ids.length > 30) throw bad('You can send up to 30 lectures at a time');
    if (db.ban.isBanned(uid)) throw bad('Your account is blocked', 403); if (!storageChannelId) throw bad('Lecture storage is not configured', 503);
    const idx = content.index(); const ents = ids.map((i) => idx.lec.get(i)); if (ents.some((e) => !e)) throw nf('Some lectures no longer exist');
    for (const e of ents) { const a = batchAccess(uid, e.batch); if (!a.ok) throw bad(REASON[a.reason], a.reason === 'access' ? 402 : 403); }
    const staff = isStaff(uid); const q = quota(uid);
    if (!staff && ids.length > q.left) throw bad(q.left ? `Only ${q.left} lecture${q.left === 1 ? '' : 's'} left today. Select fewer or watch an ad for extra lectures.` : 'Daily lecture limit reached. Watch an ad in the Access tab for extra lectures.', 429);
    const save = !!opts.save; if (save && !staff && ids.length > q.downloadsLeft) throw bad(q.downloadsLeft ? `You can save only ${q.downloadsLeft} more lecture${q.downloadsLeft === 1 ? '' : 's'} today.` : 'No download quota left. Watch a “Save Lectures” ad in the Access tab.', 429);
    const sent = [], failed = []; const protect = cfg().protectContent !== false && !save;
    for (let i = 0; i < ents.length; i++) {
      const { subject, chapter, lecture } = ents[i];
      try {
        await sendWithRetry(() => tg.copyMessage(uid, storageChannelId, lecture.channelMsgId, { caption: `<b>${esc(subject.name)}</b> · ${esc(chapter.name)}\n▶ ${esc(lecture.name)}${lecture.duration ? ' · ' + hm(lecture.duration) : ''}`, protect_content: protect && lecture.fileType === 'video' }));
        sent.push(lecture._id); db.q('INSERT INTO deliveries(userId,lectureId,at) VALUES(?,?,?)').run(String(uid), lecture._id, now());
        if (!staff) { db.usage.bump(uid, dayOf(), 'lectures', 1); if (save) db.usage.bump(uid, dayOf(), 'dlUsed', 1); }
      } catch (err) { failed.push({ id: lecture._id, error: err.code === 403 ? 'Start the bot first (open the bot chat and press Start)' : 'Could not send this lecture' }); if (err.code === 403) break; }
      if (i < ents.length - 1) await sleep(350);
    }
    return { sent: sent.length, failed, quota: quota(uid) };
  }
  async function deliverNotes(uid, chapterId, noteIds) {
    if (db.ban.isBanned(uid)) throw bad('Your account is blocked', 403); const e = content.index().ch.get(chapterId); if (!e) throw nf('Chapter not found');
    const a = batchAccess(uid, e.batch); if (!a.ok) throw bad(REASON[a.reason], a.reason === 'access' ? 402 : 403);
    let notes = e.chapter.notes || []; if (Array.isArray(noteIds) && noteIds.length) notes = notes.filter((n) => noteIds.includes(n._id)); if (!notes.length) throw nf('No notes for this chapter yet');
    const sent = []; for (const n of notes.slice(0, 20)) { try { await sendWithRetry(() => tg.copyMessage(uid, storageChannelId, n.channelMsgId, { caption: `📄 <b>${esc(e.subject.name)}</b> · ${esc(e.chapter.name)}\n${esc(n.name)}` })); sent.push(n._id); } catch (err) { if (err.code === 403) throw bad('Start the bot first (open the bot chat and press Start)', 403); } await sleep(250); }
    return { sent: sent.length };
  }

  // ── referral & points ────────────────────────────────────────────────────
  function refer(referredId, referrerId) {
    referredId = String(referredId); referrerId = String(referrerId); if (referredId === referrerId || !db.user.findOne(referrerId) || db.ban.isBanned(referrerId)) return null;
    const r = db.q('INSERT OR IGNORE INTO referrals(referredId,referrerId,at) VALUES(?,?,?)').run(referredId, referrerId, now()); if (!r.changes) return null;
    db.q('UPDATE users SET referredBy=? WHERE userId=?').run(referrerId, referredId); const c = cfg(); if (c.referralPoints) db.user.addPoints(referrerId, c.referralPoints, 'Referral', now()); if (c.referralHours) grantHours(referrerId, c.referralHours, 'referral'); return { referrerId, points: c.referralPoints, hours: c.referralHours };
  }
  function referralInfo(uid) {
    const rows = db.q('SELECT r.referredId id, r.at at, u.firstName n FROM referrals r LEFT JOIN users u ON u.userId=r.referredId WHERE r.referrerId=? ORDER BY r.at DESC LIMIT 30').all(String(uid)); const c = cfg();
    return { link: `https://t.me/${botUsername()}?start=ref_${uid}`, count: db.q('SELECT COUNT(*) c FROM referrals WHERE referrerId=?').get(String(uid)).c, rewardPoints: c.referralPoints, rewardHours: c.referralHours, recent: rows.map((r) => ({ name: r.n || 'Student', at: r.at })) };
  }
  function pointsInfo(uid) { const u = db.user.findOne(uid) || { points: 0 }; const c = cfg(); return { balance: u.points, perHour: c.pointsPerHour, maxHours: c.pointsPerHour ? Math.floor(u.points / c.pointsPerHour) : 0, log: db.q('SELECT delta, reason, at FROM points_log WHERE userId=? ORDER BY id DESC LIMIT 25').all(String(uid)).map((r) => ({ ...r })) }; }
  function redeem(uid, hours) {
    hours = Math.round(Number(hours)); const c = cfg(); if (!(hours >= 1 && hours <= 72)) throw bad('Choose between 1 and 72 hours'); if (!c.pointsPerHour) throw bad('Redeeming is disabled');
    const cost = hours * c.pointsPerHour; const r = db.q('UPDATE users SET points=points-? WHERE userId=? AND points>=?').run(cost, String(uid), cost); if (!r.changes) throw bad(`You need ${cost} points for ${hours}h of access`);
    db.q('INSERT INTO points_log(userId,delta,reason,at) VALUES(?,?,?,?)').run(String(uid), -cost, `Redeemed ${hours}h access`, now()); grantHours(uid, hours, 'points'); return { access: window_(uid), points: pointsInfo(uid) };
  }
  return { state, adStart, adClaim, postback, grantHours, quota, window: window_, batchAccess, deliverLectures, deliverNotes, refer, referralInfo, pointsInfo, redeem, adminServers, isStaff, dayOf };
}
module.exports = { createAccess, hm, esc };
