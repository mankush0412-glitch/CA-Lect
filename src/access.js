'use strict';
const crypto = require('crypto');
const { HttpError } = require('./service');
const { resolveActor } = require('./rbac');
const bad = (m, c = 400) => new HttpError(c, m); const nf = (m) => new HttpError(404, m);
const TZ = 330 * 60000; const HOUR = 3600e3;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hm = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m`; };

function createAccess({ db, store, service, content, tg, dtg = tg, appUrl = '', deliveryInfo = () => ({}), pay = null, ownerId, now = () => Date.now(), botUsername = () => '', storageChannelId = '', sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const dayOf = (t = now()) => new Date(t + TZ).toISOString().slice(0, 10);
  const cfg = () => service.config.get();
  const separate = dtg !== tg; const startHint = () => (separate ? `Open the delivery bot${deliveryInfo().username ? ' @' + deliveryInfo().username : ''} and press Start, then try again` : 'Start the bot first (open the bot chat and press Start)');
  const isStaff = (uid) => !!resolveActor({ id: uid }, ownerId, store);

  // ── ad servers (admin-managed) ───────────────────────────────────────────
  const servers = () => store.list('adserver').filter((s) => s.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  const claimedToday = (uid, sid) => db.q('SELECT COUNT(*) c FROM ad_claims WHERE userId=? AND serverId=? AND claimedAt IS NOT NULL AND claimedAt>=?').get(String(uid), sid, Date.parse(dayOf() + 'T00:00:00Z') - TZ).c;
  const adminServers = {
    list: () => store.list('adserver').sort((a, b) => (a.order || 0) - (b.order || 0)),
    save(b, id) {
      const cur = id ? store.get('adserver', id) : null; if (id && !cur) throw nf('Ad server not found');
      const name = String(b.name == null ? (cur && cur.name) : b.name).trim().slice(0, 40); if (!name) throw bad('Name is required');
      const url = String(b.url == null ? (cur && cur.url) || '' : b.url).trim(); const isAg = (b.provider || (cur && cur.provider)) === 'adsgram'; if (!isAg && !/^https:\/\//i.test(url)) throw bad('Ad URL must start with https://'); if (isAg && url && !/^https:\/\//i.test(url)) throw bad('Ad URL must start with https://');
      const type = (b.type || (cur && cur.type) || 'access'); if (!['access', 'lectures', 'downloads'].includes(type)) throw bad('type must be access, lectures or downloads');
      const num = (v, d, lo, hi, nm) => { const n = v === undefined ? d : Number(v); if (!(n >= lo && n <= hi)) throw bad(`${nm} must be ${lo}-${hi}`); return Math.round(n); };
      const provider = b.provider === 'adsgram' ? 'adsgram' : b.provider === 'link' ? 'link' : (cur ? cur.provider || 'link' : 'link'); const blockId = String(b.blockId !== undefined ? b.blockId : (cur ? cur.blockId || '' : '')).trim().slice(0, 40);
      const rec = { name, url, type, provider, blockId, hours: num(b.hours, cur ? cur.hours : 24, 1, 168, 'hours'), extraLectures: num(b.extraLectures, cur ? cur.extraLectures : 3, 1, 100, 'extraLectures'), extraDownloads: num(b.extraDownloads, cur && cur.extraDownloads ? cur.extraDownloads : 3, 1, 100, 'extraDownloads'), perDay: num(b.perDay, cur ? cur.perDay : 3, 1, 20, 'perDay'), icon: ['tv', 'target', 'book', 'rocket', 'download'].includes(b.icon) ? b.icon : (cur ? cur.icon : (type === 'lectures' ? 'book' : type === 'downloads' ? 'download' : 'tv')), order: num(b.order, cur ? cur.order : store.count('adserver'), 0, 999, 'order'), active: b.active === undefined ? (cur ? cur.active !== false : true) : !!b.active };
      return store.put('adserver', id || crypto.randomBytes(5).toString('hex'), rec);
    },
    remove(id) { if (!store.get('adserver', id)) throw nf('Ad server not found'); store.del('adserver', id); return { deleted: true }; },
  };

  // ── quota & access window ────────────────────────────────────────────────
  function quota(uid) { const u = db.usage.get(uid, dayOf()); const limit = cfg().dailyLectureLimit + u.extra; return { limit, used: u.lectures, left: Math.max(0, limit - u.lectures), ads: u.ads, adsLimit: cfg().dailyAdLimit, downloadsLeft: Math.max(0, (u.dl || 0) - (u.dlUsed || 0)) }; }
  function window_(uid) { const a = db.access.findOne(uid); const t = now(); const rem = a ? Math.max(0, a.expiresMs - t) : 0; return { active: rem > 0, expiresAt: a && rem > 0 ? a.expiresAt : null, remainingMs: rem, windowMs: a ? a.windowMs : 0, pct: a && a.windowMs ? Math.min(100, Math.round(rem / a.windowMs * 100)) : 0 }; }
  function grantHours(uid, hours, reason, nocap = false) {
    const cur = db.access.findOne(uid); const t = now(); const base = cur && cur.expiresMs > t ? cur.expiresMs : t; const cap = nocap ? Infinity : t + cfg().maxAccessHours * HOUR;
    const exp = Math.min(base + hours * HOUR, cap); db.access.upsert({ userId: uid, expiresMs: exp, windowMs: Math.max(exp - t, 0) }); return window_(uid);
  }
  function state(uid) {
    const w = window_(uid); const q = quota(uid); const c = cfg();
    const mk = (s) => ({ provider: s.provider || 'link', id: s.id, name: s.name, icon: s.icon, hours: s.hours, extraLectures: s.extraLectures, extraDownloads: s.extraDownloads || 3, perDay: s.perDay, used: claimedToday(uid, s.id) });
    const usable = (s) => (s.provider !== 'adsgram') || !!(s.blockId || c.adsgramBlockId);
    return { ...w, staff: isStaff(uid), servers: servers().filter((s) => s.type === 'access' && usable(s)).map(mk), lectureServers: servers().filter((s) => s.type === 'lectures' && usable(s)).map(mk), downloadServers: servers().filter((s) => s.type === 'downloads' && usable(s)).map(mk), usage: { lecturesLeft: q.left, lecturesLimit: q.limit, adsWatched: q.ads, adsLimit: q.adsLimit, downloadsLeft: q.downloadsLeft }, minAdSeconds: c.minAdSeconds, proTip: !!c.proTipEnabled, premiumInfo: c.premiumInfo, supportLink: c.supportLink };
  }
  function adStart(uid, serverId) {
    const s = store.get('adserver', serverId); if (!s || s.active === false) throw nf('Ad server not found');
    if (claimedToday(uid, serverId) >= s.perDay) throw bad('Daily limit reached for this server. Try another one or come back tomorrow.', 429);
    if (db.usage.get(uid, dayOf()).ads >= cfg().dailyAdLimit) throw bad(`You have reached today's limit of ${cfg().dailyAdLimit} ads.`, 429);
    const open = db.q('SELECT COUNT(*) c FROM ad_claims WHERE userId=? AND claimedAt IS NULL AND startedAt>?').get(String(uid), now() - 30 * 60000).c; if (open >= 5) throw bad('Finish your pending ads first', 429);
    const token = crypto.randomBytes(12).toString('hex'); db.q('INSERT INTO ad_claims(token,userId,serverId,startedAt) VALUES(?,?,?,?)').run(token, String(uid), serverId, now());
    const ag = s.provider === 'adsgram'; if (ag && !(s.blockId || cfg().adsgramBlockId)) throw bad('This ad is not set up yet', 503);
    return { token, provider: s.provider || 'link', blockId: ag ? (s.blockId || cfg().adsgramBlockId) : '', url: ag ? '' : (s.url || '').replace(/\{token\}/g, token).replace(/\{uid\}/g, encodeURIComponent(uid)), minSeconds: ag ? Math.min(cfg().minAdSeconds, 5) : cfg().minAdSeconds };
  }
  /** Time-based claim: the student must keep the ad open for minAdSeconds. For real ad-network verification use /api/postback. */
  function adClaim(uid, token) {
    const row = db.q('SELECT * FROM ad_claims WHERE token=?').get(String(token || '')); if (!row || row.userId !== String(uid)) throw nf('Unknown ad session');
    if (row.claimedAt) throw bad('This ad was already claimed'); if (now() - row.startedAt > 30 * 60000) throw bad('This ad session expired. Start again.');
    const srv = store.get('adserver', row.serverId) || {}; const ag = srv.provider === 'adsgram';
    if (ag && cfg().adsgramVerify && !adsgramConsume(uid)) throw bad('Ad completion not confirmed yet — please wait a moment and tap Claim again', 425);
    const wait = (ag ? Math.min(cfg().minAdSeconds, 5) : cfg().minAdSeconds) * 1000 - (now() - row.startedAt); if (wait > 0) throw bad(`Please watch the ad for ${Math.ceil(wait / 1000)} more seconds`, 425);
    return completeAd(row);
  }
  /** Telegram confirmation after an ad is completed (admin can rewrite it with {hours}). */
  function notifyGrant(uid, s) {
    const c = cfg(); let text;
    if (s.type === 'access') text = (c.grantText || '✅ <b>Access granted!</b>\n\nAapko agle {hours} ghante ka access mil gaya hai.\n\n/start pe click karke 🎓 <b>Open WebApp</b> se padhai shuru karein.').replace(/\{hours\}/g, String(s.hours));
    else if (s.type === 'lectures') text = `✅ <b>Extra lectures unlocked!</b>\n\n+${s.extraLectures} lectures added to today's limit.`;
    else text = `✅ <b>Save quota added!</b>\n\n+${s.extraDownloads || 3} lectures can be saved or forwarded today.`;
    const extra = appUrl ? { reply_markup: { inline_keyboard: [[{ text: '🎓 Open WebApp', web_app: { url: appUrl } }]] } } : {};
    Promise.resolve().then(() => tg.sendMessage(parseInt(uid, 10), text, extra)).catch(() => {});
  }
  function completeAd(row) {
    const s = store.get('adserver', row.serverId); if (!s) throw nf('Ad server not found');
    const r = db.q('UPDATE ad_claims SET claimedAt=? WHERE token=? AND claimedAt IS NULL').run(now(), row.token); if (!r.changes) throw bad('This ad was already claimed');
    db.usage.bump(row.userId, dayOf(), 'ads', 1);
    if (s.type === 'lectures') db.usage.bump(row.userId, dayOf(), 'extra', s.extraLectures); else if (s.type === 'downloads') db.usage.bump(row.userId, dayOf(), 'dl', s.extraDownloads || 3); else grantHours(row.userId, s.hours, 'ad');
    notifyGrant(row.userId, s);
    return state(row.userId);
  }
  /** Adsgram server-to-server reward callback (set the block's Reward URL to /api/adsgram/reward?userid=[userId]&secret=...). */
  function adsgramReward(uid) { const k = 'agr:' + uid; let j = {}; try { j = JSON.parse(db.kv.get(k) || '{}'); } catch (e) {} const fresh = (j.t || []).filter((t) => now() - t < 15 * 60000); fresh.push(now()); db.kv.set(k, JSON.stringify({ t: fresh.slice(-10) })); return { ok: true }; }
  function adsgramConsume(uid) { const k = 'agr:' + uid; let j = {}; try { j = JSON.parse(db.kv.get(k) || '{}'); } catch (e) {} const fresh = (j.t || []).filter((t) => now() - t < 15 * 60000); if (!fresh.length) return false; fresh.shift(); db.kv.set(k, JSON.stringify({ t: fresh })); return true; }
  /** First run: one Adsgram access server (+8h, 3 per day = 24h) so ads work as soon as a Block ID is entered. */
  function ensureDefaults() { if (store.count('adserver') > 0) return; store.put('adserver', crypto.randomBytes(5).toString('hex'), { name: 'Ad Server #1', url: '', type: 'access', provider: 'adsgram', blockId: '', hours: 8, extraLectures: 3, extraDownloads: 3, perDay: 3, icon: 'tv', order: 0, active: true }); }
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
  /** Copies a stored file to the student. The delivery bot goes first; if it cannot read the storage channel (not added there / file moved) the main bot delivers instead. */
  let fellBack = false;
  async function copyOut(uid, msgId, extra) {
    try { return await sendWithRetry(() => dtg.copyMessage(uid, storageChannelId, msgId, extra)); } catch (e) {
      if (e.code === 403 || !separate) throw e;
      try { const r = await sendWithRetry(() => tg.copyMessage(uid, storageChannelId, msgId, extra)); fellBack = true; console.error('[delivery] delivery bot could not copy (' + e.message + ') - main bot delivered instead. Add the delivery bot as admin of the storage channel.'); return r; } catch (e2) { throw e; }
    }
  }
  /** Plain-language reason for a failed send (the raw Telegram text is logged, a short version is shown). */
  function sendError(err) {
    const m = String((err && err.message) || ''); console.error('[delivery] send failed:', m);
    if (err && err.code === 403) return startHint();
    if (/message to copy not found|MESSAGE_ID_INVALID|message not found/i.test(m)) return 'This file was removed from the storage channel. Please tell support so it can be uploaded again.';
    if (/chat not found|not a member|have no rights|CHAT_ADMIN|kicked/i.test(m)) return 'The bot cannot read the storage channel. Admin: add the bot as admin of the storage channel.';
    if (/too many requests|retry after/i.test(m)) return 'Telegram is busy right now. Wait a few seconds and try again.';
    return 'Could not send this lecture' + (m ? ' (' + m.slice(0, 70) + ')' : '');
  }
  async function deliverLectures(uid, ids, opts = {}) {
    if (!Array.isArray(ids) || !ids.length) throw bad('Select at least one lecture'); ids = [...new Set(ids.map(String))]; if (ids.length > 30) throw bad('You can send up to 30 lectures at a time');
    if (db.ban.isBanned(uid)) throw bad('Your account is blocked', 403); if (suspension(uid)) throw bad('Your account is suspended because you left a required channel. Open the bot to appeal.', 403); if (!storageChannelId) throw bad('Lecture storage is not configured', 503);
    const idx = content.index(); const ents = ids.map((i) => idx.lec.get(i)); if (ents.some((e) => !e)) throw nf('Some lectures no longer exist');
    for (const e of ents) { const a = batchAccess(uid, e.batch); if (!a.ok) throw bad(REASON[a.reason], a.reason === 'access' ? 402 : 403); }
    const staff = isStaff(uid); const q = quota(uid);
    if (!staff && ids.length > q.left) throw bad(q.left ? `Only ${q.left} lecture${q.left === 1 ? '' : 's'} left today. Select fewer or watch an ad for extra lectures.` : 'Daily lecture limit reached. Watch an ad in the Access tab for extra lectures.', 429);
    const save = !!opts.save; if (save && !staff && ids.length > q.downloadsLeft) throw bad(q.downloadsLeft ? `You can save only ${q.downloadsLeft} more lecture${q.downloadsLeft === 1 ? '' : 's'} today.` : 'No download quota left. Watch a “Save Lectures” ad in the Access tab.', 429);
    fellBack = false; const sent = [], failed = []; const baseProtect = cfg().protectContent !== false && !save; let passLeft = !save && !staff && pay ? pay.remaining(uid) : 0;
    for (let i = 0; i < ents.length; i++) {
      const { subject, chapter, lecture } = ents[i];
      try {
        const viaPass = baseProtect && passLeft > 0; const protect = baseProtect && !viaPass;
        const delH = cfg().lectureDeleteHours; const r = await copyOut(uid, lecture.channelMsgId, { caption: `<b>${esc(subject.name)}</b> · ${esc(chapter.name)}\n▶ ${esc(lecture.name)}${lecture.duration ? ' · ' + hm(lecture.duration) : ''}${delH > 0 ? `\n⏳ This video will be deleted from this chat in ${delH} hours` : ''}`, protect_content: protect && lecture.fileType === 'video' });
        if (delH > 0 && r && r.message_id) db.q('INSERT INTO autodel(chatId,msgId,at) VALUES(?,?,?)').run(String(uid), r.message_id, now() + delH * 3600000);
        if (viaPass) { passLeft--; pay.consume(uid, 1); }
        sent.push(lecture._id); db.q('INSERT INTO deliveries(userId,lectureId,at) VALUES(?,?,?)').run(String(uid), lecture._id, now());
        if (!staff) { db.usage.bump(uid, dayOf(), 'lectures', 1); if (save) db.usage.bump(uid, dayOf(), 'dlUsed', 1); }
      } catch (err) { failed.push({ id: lecture._id, error: sendError(err) }); if (err.code === 403) break; }
      if (i < ents.length - 1) await sleep(350);
    }
    if (sent.length) { try { activateReferral(uid); } catch (e) { /* bonus is best-effort */ } }
    return { sent: sent.length, failed, quota: quota(uid), via: fellBack ? 'main' : 'delivery' };
  }
  async function deliverNotes(uid, chapterId, noteIds) {
    if (db.ban.isBanned(uid)) throw bad('Your account is blocked', 403); if (suspension(uid)) throw bad('Your account is suspended because you left a required channel. Open the bot to appeal.', 403); const e = content.index().ch.get(chapterId); if (!e) throw nf('Chapter not found');
    const a = batchAccess(uid, e.batch); if (!a.ok) throw bad(REASON[a.reason], a.reason === 'access' ? 402 : 403);
    let notes = e.chapter.notes || []; if (Array.isArray(noteIds) && noteIds.length) notes = notes.filter((n) => noteIds.includes(n._id)); if (!notes.length) throw nf('No notes for this chapter yet');
    fellBack = false; const sent = [], failed = []; for (const n of notes.slice(0, 20)) { try { await copyOut(uid, n.channelMsgId, { caption: `📄 <b>${esc(e.subject.name)}</b> · ${esc(e.chapter.name)}\n${esc(n.name)}` }); sent.push(n._id); } catch (err) { const msg = sendError(err).replace('this lecture', 'this note'); if (err.code === 403) throw bad(msg, 403); failed.push({ id: n._id, error: msg }); } await sleep(250); }
    if (sent.length) { try { await (fellBack ? tg : dtg).sendMessage(uid, notesDoneText(e, sent.length)); } catch (err) { /* the files already arrived */ } }
    if (sent.length) { try { activateReferral(uid); } catch (e) { /* bonus is best-effort */ } }
    return { sent: sent.length, failed, via: fellBack ? 'main' : 'delivery' };
  }
  /** Removes delivered lecture videos once their time is up (notes are never deleted). */
  async function sweepDeletes() {
    const rows = db.q('SELECT id, chatId, msgId FROM autodel WHERE at<=? ORDER BY at LIMIT 200').all(now());
    for (const r of rows) { try { await dtg.call('deleteMessage', { chat_id: r.chatId, message_id: r.msgId }); } catch (e) { if (separate) { try { await tg.call('deleteMessage', { chat_id: r.chatId, message_id: r.msgId }); } catch (e2) { /* already deleted / too old */ } } } db.q('DELETE FROM autodel WHERE id=?').run(r.id); }
    return rows.length;
  }
  function notesDoneText(e, n) {
    const c = cfg(); const m = store.get('batchmeta', String(e.batch._id)) || {}; const asg = store.list('assignment').find((a) => a.batchId === String(e.batch._id) && a.subjectId === String(e.subject._id)); const f = store.get('faculty', (asg && asg.facultyId) || m.facultyId || ''); const label = (asg && asg.label) || m.label || '';
    const h = String(c.supportHandle || '').trim() || ((/t\.me\/([A-Za-z0-9_]{4,})/.exec(c.supportLink || '') || [])[1] || ''); const handle = h ? '@' + h.replace(/^@/, '') : '';
    return `📎 <b>${n === 1 ? 'Note' : n + ' notes'} delivered</b>\n\n📖 Chapter: ${esc(e.chapter.name)}\n🎓 Faculty: ${esc(((f && f.name) || '') + (label ? ' · ' + label : '')) || '—'}\n\n🗂 Ye files permanent hain — inhe auto-delete nahi kiya jayega.${handle ? `\n\n💬 Koi dikkat? ${esc(handle)}` : ''}`;
  }

  // ── suspension: leaving a required channel ───────────────────────────────
  const fmtIST = (t) => new Date(t + TZ).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC' }) + ' IST';
  function suspension(uid) {
    const raw = db.kv.get('susp:' + uid); if (!raw) return null; let x = null; try { x = JSON.parse(raw); } catch (e) { return null; }
    if (!x || !x.until || x.until <= now()) { if (raw) { db.kv.set('susp:' + uid, ''); } return null; } return x;
  }
  const suspendMsg = (x) => `⛔ <b>Your account is suspended</b>\n\nYou left a required channel${x.channel ? ' (<b>' + esc(x.channel) + '</b>)' : ''}, so your account is suspended until <b>${fmtIST(x.until)}</b>.\n\nIf you think this is a mistake, tap <b>Appeal</b> and write to us. The admin will review it.`;
  const suspendBtns = [[{ text: '📩 Appeal', callback_data: 'appeal' }]];
  async function suspend(uid, channel) {
    uid = String(uid); if (isStaff(uid) || suspension(uid)) return null; const c = cfg(); const days = Number(c.suspendDays == null ? 2 : c.suspendDays); if (c.suspendOnLeave === false || !(days > 0)) return null;
    const x = { until: now() + days * 864e5, at: now(), channel: channel || '', days }; db.kv.set('susp:' + uid, JSON.stringify(x)); db.kv.set('appeal:' + uid, ''); db.kv.set('appealwait:' + uid, '');
    for (const l of ['foundation', 'intermediate']) db.kv.set(`joined2:${uid}:${l}`, '0');
    try { db.q('INSERT INTO suspensions(userId,at,until,channel) VALUES(?,?,?,?)').run(uid, x.at, x.until, x.channel); } catch (e) { /* history only */ }
    try { await tg.sendMessage(uid, suspendMsg(x), { reply_markup: { inline_keyboard: suspendBtns } }); } catch (e) { /* user blocked the bot */ } return x;
  }
  function unsuspend(uid) { uid = String(uid); const had = !!suspension(uid); db.kv.set('susp:' + uid, ''); db.kv.set('appealwait:' + uid, ''); return had; }
  function suspendedList() { return db.q("SELECT k, v FROM kv WHERE k LIKE 'susp:%' AND v<>''").all().map((r) => { let x = null; try { x = JSON.parse(r.v); } catch (e) { return null; } if (!x || x.until <= now()) return null; const id = r.k.slice(5); const u = db.user.findOne(id) || {}; return { userId: id, name: [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Student', username: u.username || '', channel: x.channel, until: x.until, appeal: db.kv.get('appeal:' + id) || '' }; }).filter(Boolean).sort((a, b) => a.until - b.until); }
  /** Re-checks (at most every few minutes per student) that someone who had joined the required channels is still a member. */
  async function checkLeft(uid) {
    uid = String(uid); const c = cfg(); if (c.suspendOnLeave === false || isStaff(uid) || suspension(uid)) return false;
    const u = db.user.findOne(uid) || {}; const level = u.level === 'foundation' || u.level === 'intermediate' ? u.level : ''; if (!level || db.kv.get(`joined2:${uid}:${level}`) !== '1') return false;
    const gap = Math.max(1, Number(c.leaveCheckMin) || 10) * 60000; const last = Number(db.kv.get('jchk:' + uid)) || 0; if (now() - last < gap) return false; db.kv.set('jchk:' + uid, String(now()));
    for (const ch of service.config.joinFor(level)) { if (!ch.chatId) continue; try { const m = await tg.getChatMember(ch.chatId, uid); if (['left', 'kicked'].includes(m.status)) { await suspend(uid, ch.title); return true; } } catch (e) { /* bot cannot see this channel: cannot judge */ } }
    return false;
  }
  /** Telegram chat_member update: instant suspension when a joined student leaves one of the level channels. */
  async function onMemberUpdate(cm) {
    if (!cm || !cm.new_chat_member || !cm.chat) return; const st = cm.new_chat_member.status; if (!['left', 'kicked'].includes(st)) return; const uid = String(cm.new_chat_member.user.id); const chat = String(cm.chat.id);
    for (const l of ['foundation', 'intermediate']) { const hit = service.config.joinFor(l).find((ch) => String(ch.chatId) === chat); if (hit && db.kv.get(`joined2:${uid}:${l}`) === '1') return suspend(uid, hit.title); }
  }
  // ── referral & points ────────────────────────────────────────────────────
  function refer(referredId, referrerId) {
    referredId = String(referredId); referrerId = String(referrerId); if (referredId === referrerId || !db.user.findOne(referrerId) || db.ban.isBanned(referrerId)) return null;
    const r = db.q('INSERT OR IGNORE INTO referrals(referredId,referrerId,at) VALUES(?,?,?)').run(referredId, referrerId, now()); if (!r.changes) return null;
    db.q('UPDATE users SET referredBy=? WHERE userId=?').run(referrerId, referredId); const c = cfg(); if (c.referralPoints) db.user.addPoints(referrerId, c.referralPoints, 'Referral', now()); if (c.referralHours) grantHours(referrerId, c.referralHours, 'referral'); return { referrerId, points: c.referralPoints, hours: c.referralHours };
  }
  function referralInfo(uid) {
    const rows = db.q('SELECT r.referredId id, r.at at, u.firstName n FROM referrals r LEFT JOIN users u ON u.userId=r.referredId WHERE r.referrerId=? ORDER BY r.at DESC LIMIT 30').all(String(uid)); const c = cfg();
    const active = db.q("SELECT COUNT(*) c FROM referrals r JOIN kv ON kv.k='refact:'||r.referredId AND kv.v='1' WHERE r.referrerId=?").get(String(uid)).c;
    return { link: `https://t.me/${botUsername()}?start=ref_${uid}`, count: db.q('SELECT COUNT(*) c FROM referrals WHERE referrerId=?').get(String(uid)).c, active, rewardPoints: c.referralPoints, rewardHours: c.referralHours, activePoints: c.referralActivePoints == null ? 5 : c.referralActivePoints, recent: rows.map((r) => ({ name: r.n || 'Student', at: r.at })) };
  }
  /** A referred friend's first delivered lecture/note pays the referrer the "active referral" bonus (once per friend). */
  function activateReferral(uid) {
    uid = String(uid); if (db.kv.get('refact:' + uid)) return; const r = db.q('SELECT referrerId FROM referrals WHERE referredId=?').get(uid); if (!r) return; const c = cfg(); const pts = c.referralActivePoints == null ? 5 : c.referralActivePoints;
    db.kv.set('refact:' + uid, '1'); if (!(pts > 0)) return; db.user.addPoints(r.referrerId, pts, 'Friend requested their first chapter', now()); tg.sendMessage(r.referrerId, `🎉 A friend you invited requested their first chapter!\n+${pts} points`).catch(() => {});
  }
  function pointsInfo(uid) { const u = db.user.findOne(uid) || { points: 0 }; const c = cfg(); return { balance: u.points, tiers: (c.redeemTiers || []).map((t, i) => ({ i, label: t.label, points: t.points, hours: t.hours })), perHour: c.pointsPerHour, maxHours: c.pointsPerHour ? Math.floor(u.points / c.pointsPerHour) : 0, log: db.q('SELECT delta, reason, at FROM points_log WHERE userId=? ORDER BY id DESC LIMIT 25').all(String(uid)).map((r) => ({ ...r })) }; }
  function redeem(uid, hours) {
    hours = Math.round(Number(hours)); const c = cfg(); if (!(hours >= 1 && hours <= 72)) throw bad('Choose between 1 and 72 hours'); if (!c.pointsPerHour) throw bad('Redeeming is disabled');
    const cost = hours * c.pointsPerHour; const r = db.q('UPDATE users SET points=points-? WHERE userId=? AND points>=?').run(cost, String(uid), cost); if (!r.changes) throw bad(`You need ${cost} points for ${hours}h of access`);
    db.q('INSERT INTO points_log(userId,delta,reason,at) VALUES(?,?,?,?)').run(String(uid), -cost, `Redeemed ${hours}h access`, now()); grantHours(uid, hours, 'points'); return { access: window_(uid), points: pointsInfo(uid) };
  }
  function redeemTier(uid, i) {
    const t = (cfg().redeemTiers || [])[parseInt(i, 10)]; if (!t) throw bad('That option is not available');
    const r = db.q('UPDATE users SET points=points-? WHERE userId=? AND points>=?').run(t.points, String(uid), t.points); if (!r.changes) throw bad(`You need ${t.points} points for ${t.label}`);
    db.q('INSERT INTO points_log(userId,delta,reason,at) VALUES(?,?,?,?)').run(String(uid), -t.points, `Redeemed ${t.label}`, now()); grantHours(uid, t.hours, 'points', true); return { access: window_(uid), points: pointsInfo(uid) };
  }
  return { activateReferral, redeemTier, state, delivery: () => ({ separate, ...deliveryInfo() }), adStart, adClaim, postback, grantHours, quota, window: window_, batchAccess, deliverLectures, deliverNotes, sweepDeletes, adsgramReward, ensureDefaults, refer, referralInfo, pointsInfo, redeem, adminServers, suspension, suspend, unsuspend, suspendedList, checkLeft, onMemberUpdate, suspendMsg, suspendBtns, fmtIST, isStaff, dayOf };
}
module.exports = { createAccess, hm, esc };
