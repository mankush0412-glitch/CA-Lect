'use strict';
const zlib = require('node:zlib');
/** Student-facing REST API for the Mini App (/api/app/*). The user always comes from signed Telegram initData. */
const { verifyInitData } = require('./rbac'); const { HttpError } = require('./service');
const bad = (m, c = 400) => new HttpError(c, m); const nf = (m) => new HttpError(404, m);

function createApi({ botToken, db, store, service, content, access, planner, tg, devices = null, pay = null, onPlan = () => {}, brand, botUsername, verify = verifyInitData, prefix = '/api/app', cfgProvider }) {
  const routes = []; const add = (m, p, fn) => routes.push({ m, fn, names: [...p.matchAll(/:([a-zA-Z]+)/g)].map((x) => x[1]), re: new RegExp('^' + p.replace(/:([a-zA-Z]+)/g, '([^/]+)') + '/?$') });
  const G = (p, fn) => add('GET', p, fn), P = (p, fn) => add('POST', p, fn), U = (p, fn) => add('PATCH', p, fn), D = (p, fn) => add('DELETE', p, fn);
  const finalOn = () => service.config.get().finalEnabled === true; const lvl = (v) => (v === 'foundation' ? 'foundation' : v === 'final' && finalOn() ? 'final' : 'intermediate'); const ulv = (u) => { const l = u && u.level; return l === 'foundation' || l === 'intermediate' || (l === 'final' && finalOn()) ? l : ''; };
  const checkPlanBatches = (uid, subs) => { for (const s of subs || []) { const b = db.batch.getOne(String(s.batchId)); if (!b) throw nf('Batch not found'); if ((!service.isBatchVisible(String(b._id), uid) && !access.isStaff(uid))) throw bad('That batch is not available'); } };

  G('/me', (c) => { const u = db.user.findOne(c.uid) || {}; const cf = service.config.get(); return { id: c.uid, name: [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Student', level: u.level || '', staff: access.isStaff(c.uid), brand, bot: botUsername(), config: { finalEnabled: cf.finalEnabled === true, supportLink: cf.supportLink, whatsappLink: cf.whatsappLink, channelLink: cf.channelLink, premiumInfo: cf.premiumInfo, howToUrl: cf.howToUrl, testSeriesUrl: cf.testSeriesUrl, testSeriesEnabled: cf.testSeriesEnabled !== false, testSeriesItems: cf.testSeriesItems || [], fullscreen: cf.fullscreen === true, defaultLevel: cf.defaultLevel, themeSkin: cf.themeSkin || 'blue', uiScale: cf.uiScale || 100, newFacultyDays: cf.newFacultyDays == null ? 7 : cf.newFacultyDays, blockGate: cf.adBlockGate === true, monetag: { on: !(pay && pay.adFree(c.uid)) && cf.monetagEnabled !== false && /^\d{4,16}$/.test(cf.monetagZoneId || ''), zone: cf.monetagZoneId || '', inApp: cf.monetagInApp !== false, every: cf.monetagLectureEvery === 0 ? 0 : (cf.monetagLectureEvery || 3) }, savePass: !!(pay && cf.savePassEnabled && pay.configured()), adFree: !!(pay && cf.adFreeEnabled && pay.configured()), adFreePlans: pay && cf.adFreeEnabled && pay.configured() ? pay.adFreeInfo(c.uid).plans : [] }, adFree: pay && pay.adFree(c.uid) ? { active: true, until: pay.adFree(c.uid).until } : null, delivery: { ...access.delivery(), started: db.kv.get('dstart:' + c.uid) === '1' } }; });
  P('/device-check', async (c) => (devices ? devices.report(c.uid, c.b.fingerprint, c.ip) : { ok: true }));
  P('/level', (c) => { const l = lvl(c.b.level); db.user.setLevel(c.uid, l); return { level: l }; });
  // ── force-join (per level) ──
  const photoCache = new Map();
  async function chanPhoto(ch) {
    if (ch.pic) return ch.pic; if (!ch.chatId) return ''; const hit = photoCache.get(ch.chatId); if (hit && Date.now() - hit.at < 36e5) return hit.v;
    let v = ''; try { const chat = await tg.call('getChat', { chat_id: ch.chatId }); const fid = chat.photo && chat.photo.small_file_id; if (fid) { const f = await tg.call('getFile', { file_id: fid }); const r = await fetch(`${tg.base}/file/bot${tg.token}/${f.file_path}`); if (r.ok) v = 'data:image/jpeg;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64'); } } catch (e) { /* no photo */ }
    photoCache.set(ch.chatId, { at: Date.now(), v }); return v;
  }
  const joinCache = new Map(); const joinOk = new Map();
  async function joinState(uid, verify) {
    const u = db.user.findOne(uid) || {}; const level = ulv(u); const cf = service.config.get(); const cap = level ? level[0].toUpperCase() + level.slice(1) : '';
    /* a student we verified in the last 3 minutes is let straight in — no Telegram calls on every app open (leaving is caught live by chat_member events) */
    if (!verify && level && joinOk.get(uid + ':' + level) > Date.now() - 180000 && db.kv.get(`joined2:${uid}:${level}`) === '1') return { required: true, allJoined: true, level, channels: [] };
    await service.config.ensureJoin(tg); const list = service.config.joinFor(level); const staff = access.isStaff(uid);
    if (!list.length || staff) return { required: false, allJoined: true, level, channels: [] };
    const channels = await Promise.all(list.map(async (ch) => { let ok = null; if (ch.chatId) { try { const m = await tg.getChatMember(ch.chatId, uid); ok = !(['left', 'kicked'].includes(m.status) || (m.status === 'restricted' && m.is_member === false)); } catch (e) { console.warn('[join] cannot check ' + ch.chatId + ' (is the bot an admin there?): ' + e.message); ok = null; } } return { title: ch.title, url: ch.url, joined: ok === null ? db.kv.get(`joined2:${uid}:${level}`) === '1' : ok, photo: await chanPhoto(ch) }; }));
    const allJoined = channels.every((x) => x.joined); if (allJoined) { db.kv.set(`joined2:${uid}:${level}`, '1'); if (channels.every((x) => x.joined !== null) && level) { joinOk.set(uid + ':' + level, Date.now()); if (joinOk.size > 20000) joinOk.clear(); } } else if (level) { joinOk.delete(uid + ':' + level); const gone = channels.findIndex((x) => x.joined === false); /* was fine before, now missing a channel = he LEFT: start the 24-hour warning (works even when Telegram's leave event did not arrive) */ if (db.kv.get(`joined2:${uid}:${level}`) === '1' && gone >= 0 && !access.leaveState(uid)) access.leaveWarn(uid, list[gone], level).catch(() => {}); db.kv.set(`joined2:${uid}:${level}`, '0'); }
    return { required: true, allJoined, level, levelName: level === 'foundation' ? 'CA Foundation' : level === 'intermediate' ? 'CA Intermediate' : level === 'final' ? 'CA Final' : '', channels };
  }
  G('/join', (c) => joinState(c.uid, false)); P('/join/verify', async (c) => { const r = await joinState(c.uid, true); joinCache.delete(c.uid); return r; });
  // ── optional Razorpay save pass ──
  const needPay = () => { if (!pay) throw nf('Payments are not available'); return pay; };
  G('/pay', (c) => ({ ...needPay().state(c.uid), adFree: needPay().adFreeInfo(c.uid) })); P('/pay/order', (c) => needPay().createOrder(c.uid, String(c.b.plan || ''))); P('/pay/verify', (c) => needPay().verify(c.uid, c.b || {}));
  P('/pay/refresh', async (c) => ({ adFree: await needPay().refreshUser(c.uid) })); /* asks Razorpay about this student's unfinished orders — covers a closed app / missed callback */
  G('/tree', (c) => { const d = service.catalog(c.uid, lvl(c.q.level), { staff: access.isStaff(c.uid) }); const pins = store.list('pin').filter((p) => p.userId === c.uid).map((p) => p.batchId); return { ...d, pins }; });
  G('/batch/:bid/:sid', (c) => { const b = db.batch.getOne(c.p.bid); if (!b || !service.isBatchVisible(c.p.bid, c.uid)) throw nf('Batch not found'); const v = content.view(c.p.bid, c.p.sid); const a = access.batchAccess(c.uid, b); const m = store.get('batchmeta', c.p.bid) || {}; const sj = (b.subjects || []).find((x) => String(x._id) === String(c.p.sid)); const asg = sj && store.list('assignment').find((x) => x.batchId === c.p.bid && String(x.subjectName || '').trim().toLowerCase() === String(sj.name || '').trim().toLowerCase()); const fid = (asg && asg.facultyId) || m.facultyId; const fac = fid ? store.get('faculty', fid) : null; return { ...v, locked: !a.ok, reason: a.ok ? null : a.reason, premium: !!b.isPremium, price: b.price || 0, batchName: b.name, label: m.label || '', institute: m.institute || '', faculty: fac ? { id: fac.id, name: fac.name, initials: fac.initials, color: fac.color, pic: fac.pic || '' } : null, quota: access.quota(c.uid), requested: (() => { const ids = []; (v.chapters || []).forEach((ch) => (ch.lectures || []).forEach((l) => ids.push(l.id))); const out = {}; for (let i = 0; i < ids.length; i += 400) { const part = ids.slice(i, i + 400); try { db.q(`SELECT lectureId l, MAX(at) a FROM deliveries WHERE userId=? AND lectureId IN (${part.map(() => '?').join(',')}) GROUP BY lectureId`).all(String(c.uid), ...part).forEach((r) => { out[r.l] = r.a; }); } catch (e) { /* optional */ } } return out; })() }; });
  P('/lectures/send', async (c) => access.deliverLectures(c.uid, c.b.ids, { save: !!c.b.save, force: !!c.b.force, bg: !!c.b.bg }));
  P('/notes/send', async (c) => access.deliverNotes(c.uid, String(c.b.chapterId || ''), c.b.ids, { force: !!c.b.force }));
  G('/access', (c) => access.state(c.uid)); P('/ad/start', (c) => access.adStart(c.uid, String(c.b.serverId || ''))); P('/ad/claim', (c) => access.adClaim(c.uid, c.b.token)); P('/ad/alt', (c) => access.adAlt(c.uid, c.b.token, c.b.via === 'monetag' ? 'monetag' : 'fallback'));
  G('/referral', (c) => access.referralInfo(c.uid)); G('/points', (c) => access.pointsInfo(c.uid)); P('/points/redeem', (c) => (c.b.tier !== undefined ? access.redeemTier(c.uid, c.b.tier) : access.redeem(c.uid, c.b.hours)));
  G('/pins', (c) => ({ pins: store.list('pin').filter((p) => p.userId === c.uid).map((p) => p.batchId) }));
  P('/pins', (c) => { const bid = String(c.b.batchId || ''); if (!db.batch.getOne(bid)) throw nf('Batch not found'); const id = `${c.uid}:${bid}`; const had = !!store.get('pin', id); if (had) store.del('pin', id); else { if (store.list('pin').filter((p) => p.userId === c.uid).length >= 30) throw bad('You can pin up to 30 batches'); store.put('pin', id, { userId: c.uid, batchId: bid }); } return { pinned: !had }; });
  G('/announcements', () => ({ items: db.announcement.latest(10) }));
  // planner
  P('/plan/preview', (c) => { checkPlanBatches(c.uid, c.b.subjects); return planner.preview(c.b); });
  P('/plan', (c) => { checkPlanBatches(c.uid, c.b.subjects); planner.create(c.uid, c.b); onPlan(c.uid); return planner.view(c.uid); });
  G('/plan', (c) => ({ plan: planner.view(c.uid) })); D('/plan', (c) => planner.remove(c.uid));
  P('/plan/mark', (c) => (Array.isArray(c.b.ids) ? planner.markMany(c.uid, c.b.ids.map(String), c.b.done !== false) : planner.mark(c.uid, String(c.b.id), c.b.done !== false)));
  P('/plan/reschedule', (c) => planner.reschedule(c.uid)); P('/plan/dayoff', (c) => (c.b.remove ? planner.removeDayOff(c.uid, c.b.date) : planner.addDayOff(c.uid, c.b.date)));
  P('/plan/add-subject', (c) => { checkPlanBatches(c.uid, [c.b]); const v = content.view(String(c.b.batchId), String(c.b.subjectId)); return planner.addSubject(c.uid, { name: v.subject, batchId: v.batchId, subjectId: v.subjectId, finished: c.b.finished || [], partial: [], order: c.b.order || [] }); });
  P('/plan/change-today', (c) => planner.changeToday(c.uid, String(c.b.subject || ''))); U('/plan/reminders', (c) => planner.setReminders(c.uid, c.b));
  P('/plan/pdf', async (c) => { const buf = planner.pdf(c.uid); await tg.sendDocumentBuffer(c.uid, buf, planner.pdfName(c.uid), '📅 <b>Your study plan</b>'); return { sent: true }; });

  const hits = new Map(); const limited = (id) => { const t = Date.now(), w = (hits.get(id) || []).filter((x) => t - x < 60000); w.push(t); hits.set(id, w); if (hits.size > 8000) hits.clear(); return w.length > 180; };
  const send = (res, st, body) => { res.statusCode = st; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); const raw = Buffer.from(JSON.stringify(body)); /* big answers (the lecture tree) are sent compressed: 5–10x smaller on mobile data */ if (raw.length > 1200 && res.req && /\bgzip\b/.test(String(res.req.headers['accept-encoding'] || ''))) { const z = zlib.gzipSync(raw, { level: 4 }); res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding'); res.setHeader('Content-Length', z.length); return res.end(z); } res.end(raw); };
  const body = (req) => new Promise((resolve, reject) => { if (req.body && typeof req.body === 'object') return resolve(req.body); let n = 0; const ch = []; req.on('data', (d) => { n += d.length; if (n > 60000) { reject(new HttpError(413, 'Too large')); req.destroy(); } else ch.push(d); }); req.on('end', () => { try { resolve(ch.length ? JSON.parse(Buffer.concat(ch).toString()) : {}); } catch (e) { reject(new HttpError(400, 'Invalid JSON')); } }); req.on('error', reject); });
  return async (req, res) => {
    const u = new URL(req.url, 'http://x'); let path = u.pathname; if (path.startsWith(prefix)) path = path.slice(prefix.length) || '/';
    if (path === '/hello' && req.method === 'GET') return send(res, 200, { success: true, data: { bot: String((typeof botUsername === 'function' ? botUsername() : '') || '').replace(/^@/, '') } });
    let hit = null; for (const r of routes) { const m = r.m === req.method && path.match(r.re); if (m) { hit = { r, m }; break; } } if (!hit) return send(res, 404, { success: false, error: 'Not found' });
    try {
      const rawInit = req.headers['x-tg-init-data'];
      if (!rawInit && service.config.get().webPreview !== false) { /* browser preview: read-only, no account, nothing is written */
        if (req.method !== 'GET' || !/^\/(me|tree|batch\/[^/]+\/[^/]+|announcements|join|access|hello)\/?$/.test(path)) return send(res, 401, { success: false, error: 'Open the bot in Telegram to do this.', guest: true });
        const cf = service.config.get(); const q = Object.fromEntries(u.searchParams); let d;
        if (path === '/me') d = { id: 'guest', guest: true, name: 'Guest', level: lvl(q.level), staff: false, brand, bot: botUsername(), config: { finalEnabled: cf.finalEnabled === true, supportLink: cf.supportLink, whatsappLink: '', channelLink: cf.channelLink, premiumInfo: '', howToUrl: cf.howToUrl, fullscreen: false, uiScale: cf.uiScale, themeSkin: cf.themeSkin } };
        else if (path === '/join') d = { required: false, allJoined: true, channels: [] };
        else if (path === '/access') d = { active: false, staff: false, guest: true };
        else if (path === '/announcements') d = { items: [] };
        else if (path === '/tree') d = { ...service.catalog(null, lvl(q.level)), pins: [] };
        else { const m = path.match(/^\/batch\/([^/]+)\/([^/]+)/); const b = m && db.batch.getOne(decodeURIComponent(m[1])); if (!b || !service.isBatchVisible(String(b._id), null)) return send(res, 404, { success: false, error: 'Batch not found' }); const hh = routes.find((r) => r.m === 'GET' && r.re.test(path)); const mm = path.match(hh.re); try { d = await hh.fn({ uid: '', p: { bid: decodeURIComponent(mm[1]), sid: decodeURIComponent(mm[2]) }, q, b: {}, ip: '' }); } catch (e) { if (e instanceof HttpError) return send(res, e.status, { success: false, error: e.message }); throw e; } }
        return send(res, 200, { success: true, data: d });
      }
      const user = verify(rawInit, botToken, { maxAgeSec: 7 * 86400 }); if (!user) return send(res, 401, { success: false, error: 'Unauthorized' });
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || ''; const uid = String(user.id); const ipb = devices && !db.ban.isBanned(uid) ? devices.blockedByIp(uid, ip) : null; if (ipb) return send(res, 403, { success: false, error: ipb.kind === 'suspend' ? 'Access is suspended from your network until ' + access.fmtIST(ipb.until) : 'Your account is blocked', banned: true, reason: ipb.reason || '' }); if (devices) devices.seen(uid, ip); if (db.ban.isBanned(uid)) { const bn = db.ban.findOne(uid) || {}; return send(res, 403, { success: false, error: 'Your account is blocked', banned: true, reason: bn.reason || '' }); } if (path === '/me') { try { await access.checkLeft(uid); } catch (e) { /* ignore */ } } else access.checkLeft(uid).catch(() => {});
      const susp = access.suspension(uid); if (susp) return send(res, 403, { success: false, error: 'Suspended until ' + access.fmtIST(susp.until) + (susp.manual ? '' : ' because you left a required channel') + '. Open the bot chat and tap Appeal.', suspended: true });
      if (!/^\/(me|join|join\/verify|device-check|level)$/.test(path) && !access.isStaff(uid)) { const lv = ulv(db.user.findOne(uid)); if (lv) { const need = service.config.joinFor(lv).length > 0; if (need && db.kv.get(`joined2:${uid}:${lv}`) !== '1') { const jc = joinCache.get(uid); let st = jc && Date.now() - jc.at < 20000 ? jc.v : null; if (!st) { st = await joinState(uid, false).catch(() => ({ allJoined: true })); joinCache.set(uid, { at: Date.now(), v: st }); if (joinCache.size > 5000) joinCache.clear(); } if (!st.allJoined) return send(res, 403, { success: false, error: 'Join the required channels first', joinRequired: true }); } } }
      if (limited(uid)) return send(res, 429, { success: false, error: 'Too many requests' });
      db.user.touch(user); const p = {}; hit.r.names.forEach((n, i) => { p[n] = decodeURIComponent(hit.m[i + 1]); });
      const b = req.method === 'GET' ? {} : await body(req); return send(res, 200, { success: true, data: await hit.r.fn({ uid, p, q: Object.fromEntries(u.searchParams), b, ip }) });
    } catch (e) { if (e instanceof HttpError) return send(res, e.status, { success: false, error: e.message }); console.error('[api]', e); return send(res, 500, { success: false, error: 'Internal error' }); }
  };
}
module.exports = { createApi };
