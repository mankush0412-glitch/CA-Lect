'use strict';
/** Student-facing REST API for the Mini App (/api/app/*). The user always comes from signed Telegram initData. */
const { verifyInitData } = require('./rbac'); const { HttpError } = require('./service');
const bad = (m, c = 400) => new HttpError(c, m); const nf = (m) => new HttpError(404, m);

function createApi({ botToken, db, store, service, content, access, planner, tg, pay = null, onPlan = () => {}, brand, botUsername, verify = verifyInitData, prefix = '/api/app', cfgProvider }) {
  const routes = []; const add = (m, p, fn) => routes.push({ m, fn, names: [...p.matchAll(/:([a-zA-Z]+)/g)].map((x) => x[1]), re: new RegExp('^' + p.replace(/:([a-zA-Z]+)/g, '([^/]+)') + '/?$') });
  const G = (p, fn) => add('GET', p, fn), P = (p, fn) => add('POST', p, fn), U = (p, fn) => add('PATCH', p, fn), D = (p, fn) => add('DELETE', p, fn);
  const lvl = (v) => (v === 'foundation' ? 'foundation' : 'intermediate');
  const checkPlanBatches = (uid, subs) => { for (const s of subs || []) { const b = db.batch.getOne(String(s.batchId)); if (!b) throw nf('Batch not found'); if ((!service.isBatchVisible(String(b._id), uid) && !access.isStaff(uid))) throw bad('That batch is not available'); } };

  G('/me', (c) => { const u = db.user.findOne(c.uid) || {}; const cf = service.config.get(); return { id: c.uid, name: [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Student', level: u.level || '', staff: access.isStaff(c.uid), brand, bot: botUsername(), config: { supportLink: cf.supportLink, whatsappLink: cf.whatsappLink, channelLink: cf.channelLink, premiumInfo: cf.premiumInfo, howToUrl: cf.howToUrl, proTip: !!cf.proTipEnabled, testSeriesUrl: cf.testSeriesUrl, testSeriesEnabled: cf.testSeriesEnabled !== false, testSeriesItems: cf.testSeriesItems || [], fullscreen: cf.fullscreen === true, defaultLevel: cf.defaultLevel, themeSkin: cf.themeSkin || 'level', uiScale: cf.uiScale || 88, newFacultyDays: cf.newFacultyDays == null ? 7 : cf.newFacultyDays, monetag: { on: cf.monetagEnabled !== false && /^\d{4,16}$/.test(cf.monetagZoneId || ''), zone: cf.monetagZoneId || '', inApp: cf.monetagInApp !== false, every: cf.monetagLectureEvery === 0 ? 0 : (cf.monetagLectureEvery || 3) }, savePass: !!(pay && cf.savePassEnabled && pay.configured()) }, delivery: { ...access.delivery(), started: db.kv.get('dstart:' + c.uid) === '1' } }; });
  P('/level', (c) => { const l = lvl(c.b.level); db.user.setLevel(c.uid, l); return { level: l }; });
  // ── force-join (per level) ──
  const photoCache = new Map();
  async function chanPhoto(ch) {
    if (ch.pic) return ch.pic; if (!ch.chatId) return ''; const hit = photoCache.get(ch.chatId); if (hit && Date.now() - hit.at < 36e5) return hit.v;
    let v = ''; try { const chat = await tg.call('getChat', { chat_id: ch.chatId }); const fid = chat.photo && chat.photo.small_file_id; if (fid) { const f = await tg.call('getFile', { file_id: fid }); const r = await fetch(`${tg.base}/file/bot${tg.token}/${f.file_path}`); if (r.ok) v = 'data:image/jpeg;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64'); } } catch (e) { /* no photo */ }
    photoCache.set(ch.chatId, { at: Date.now(), v }); return v;
  }
  async function joinState(uid, verify) {
    const u = db.user.findOne(uid) || {}; const level = u.level === 'foundation' || u.level === 'intermediate' ? u.level : ''; const cf = service.config.get(); const cap = level ? level[0].toUpperCase() + level.slice(1) : '';
    const list = service.config.joinFor(level); const staff = access.isStaff(uid);
    if (!list.length || staff) return { required: false, allJoined: true, level, channels: [] };
    const channels = await Promise.all(list.map(async (ch) => { let ok = null; if (ch.chatId) { try { const m = await tg.getChatMember(ch.chatId, uid); ok = !['left', 'kicked'].includes(m.status); } catch (e) { ok = true; } } return { title: ch.title, url: ch.url, joined: ok === null ? db.kv.get(`joined2:${uid}:${level}`) === '1' : ok, photo: await chanPhoto(ch) }; }));
    const allJoined = channels.every((x) => x.joined); if (verify && allJoined) db.kv.set(`joined2:${uid}:${level}`, '1');
    return { required: true, allJoined, level, levelName: level === 'foundation' ? 'CA Foundation' : level === 'intermediate' ? 'CA Intermediate' : '', channels };
  }
  G('/join', (c) => joinState(c.uid, false)); P('/join/verify', (c) => joinState(c.uid, true));
  // ── optional Razorpay save pass ──
  const needPay = () => { if (!pay) throw nf('Payments are not available'); return pay; };
  G('/pay', (c) => needPay().state(c.uid)); P('/pay/order', (c) => needPay().createOrder(c.uid, String(c.b.plan || ''))); P('/pay/verify', (c) => needPay().verify(c.uid, c.b || {}));
  G('/tree', (c) => { const d = service.catalog(c.uid, lvl(c.q.level)); const pins = store.list('pin').filter((p) => p.userId === c.uid).map((p) => p.batchId); return { ...d, pins }; });
  G('/batch/:bid/:sid', (c) => { const b = db.batch.getOne(c.p.bid); if (!b || !service.isBatchVisible(c.p.bid, c.uid)) throw nf('Batch not found'); const v = content.view(c.p.bid, c.p.sid); const a = access.batchAccess(c.uid, b); const m = store.get('batchmeta', c.p.bid) || {}; const sj = (b.subjects || []).find((x) => String(x._id) === String(c.p.sid)); const asg = sj && store.list('assignment').find((x) => x.batchId === c.p.bid && String(x.subjectName || '').trim().toLowerCase() === String(sj.name || '').trim().toLowerCase()); const fid = (asg && asg.facultyId) || m.facultyId; const fac = fid ? store.get('faculty', fid) : null; return { ...v, locked: !a.ok, reason: a.ok ? null : a.reason, premium: !!b.isPremium, price: b.price || 0, batchName: b.name, label: m.label || '', institute: m.institute || '', faculty: fac ? { id: fac.id, name: fac.name, initials: fac.initials, color: fac.color, pic: fac.pic || '' } : null, quota: access.quota(c.uid) }; });
  P('/lectures/send', async (c) => access.deliverLectures(c.uid, c.b.ids, { save: !!c.b.save }));
  P('/notes/send', async (c) => access.deliverNotes(c.uid, String(c.b.chapterId || ''), c.b.ids));
  G('/access', (c) => access.state(c.uid)); P('/ad/start', (c) => access.adStart(c.uid, String(c.b.serverId || ''))); P('/ad/claim', (c) => access.adClaim(c.uid, c.b.token));
  G('/referral', (c) => access.referralInfo(c.uid)); G('/points', (c) => access.pointsInfo(c.uid)); P('/points/redeem', (c) => access.redeem(c.uid, c.b.hours));
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
  const send = (res, st, body) => { res.statusCode = st; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
  const body = (req) => new Promise((resolve, reject) => { if (req.body && typeof req.body === 'object') return resolve(req.body); let n = 0; const ch = []; req.on('data', (d) => { n += d.length; if (n > 60000) { reject(new HttpError(413, 'Too large')); req.destroy(); } else ch.push(d); }); req.on('end', () => { try { resolve(ch.length ? JSON.parse(Buffer.concat(ch).toString()) : {}); } catch (e) { reject(new HttpError(400, 'Invalid JSON')); } }); req.on('error', reject); });
  return async (req, res) => {
    const u = new URL(req.url, 'http://x'); let path = u.pathname; if (path.startsWith(prefix)) path = path.slice(prefix.length) || '/';
    let hit = null; for (const r of routes) { const m = r.m === req.method && path.match(r.re); if (m) { hit = { r, m }; break; } } if (!hit) return send(res, 404, { success: false, error: 'Not found' });
    try {
      const user = verify(req.headers['x-tg-init-data'], botToken, { maxAgeSec: 7 * 86400 }); if (!user) return send(res, 401, { success: false, error: 'Unauthorized' });
      const uid = String(user.id); if (db.ban.isBanned(uid)) return send(res, 403, { success: false, error: 'Your account is blocked' }); if (limited(uid)) return send(res, 429, { success: false, error: 'Too many requests' });
      db.user.touch(user); const p = {}; hit.r.names.forEach((n, i) => { p[n] = decodeURIComponent(hit.m[i + 1]); });
      const b = req.method === 'GET' ? {} : await body(req); return send(res, 200, { success: true, data: await hit.r.fn({ uid, p, q: Object.fromEntries(u.searchParams), b }) });
    } catch (e) { if (e instanceof HttpError) return send(res, e.status, { success: false, error: e.message }); console.error('[api]', e); return send(res, 500, { success: false, error: 'Internal error' }); }
  };
}
module.exports = { createApi };
