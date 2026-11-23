'use strict';
/**
 * Optional Razorpay "Save pass": a paid day/week pass that lets a student forward / save the lectures sent to them
 * (protect_content is switched off for them), capped per day. Everything is driven by admin settings:
 * savePassEnabled, savePassDayPrice, savePassWeekPrice, savePassDailyLimit. Needs RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.
 *
 * Ads-Free plan: a paid 7-day / 30-day plan (adFreeEnabled, adFreeWeekPrice, adFreeMonthPrice). While it runs the student sees
 * no ads and has access for the whole period. A payment is confirmed three ways, whichever comes first (all idempotent):
 * Checkout's signed callback, Razorpay's webhook (RAZORPAY_WEBHOOK_SECRET) and a server-side re-check of the order.
 */
const crypto = require('crypto');
const { HttpError } = require('./service');
const bad = (m, c = 400) => new HttpError(c, m);
const TZ = 330 * 60000; const DAY = 864e5;

function createPayments({ store, service, db, keyId = '', keySecret = '', webhookSecret = '', notify = async () => {}, now = () => Date.now(), fetchImpl = (...a) => fetch(...a) }) {
  const cfg = () => service.config.get();
  const configured = () => !!(keyId && keySecret);
  const dayOf = (t = now()) => new Date(t + TZ).toISOString().slice(0, 10);
  const plans = () => { const c = cfg(); return { day: { label: '1 day', price: c.savePassDayPrice, ms: DAY }, week: { label: '7 days', price: c.savePassWeekPrice, ms: 7 * DAY } }; };
  const usedToday = (uid) => parseInt(db.kv.get(`sp:${uid}:${dayOf()}`) || '0', 10);

  /** Active pass for a student, or null. */
  function pass(uid) { const p = store.get('savepass', String(uid)); return p && p.until > now() ? p : null; }
  /** How many more lectures the pass lets this student save today (0 when no pass / limit reached). */
  function remaining(uid) { if (!pass(uid)) return 0; return Math.max(0, cfg().savePassDailyLimit - usedToday(uid)); }
  function consume(uid, n = 1) { const k = `sp:${uid}:${dayOf()}`; db.kv.set(k, String(usedToday(uid) + n)); }

  function state(uid) {
    const c = cfg(); const p = pass(uid); const pl = plans();
    return { enabled: !!c.savePassEnabled && configured(), configured: configured(), keyId: configured() ? keyId : '', day: { price: pl.day.price, label: pl.day.label }, week: { price: pl.week.price, label: pl.week.label }, dailyLimit: c.savePassDailyLimit, active: !!p, until: p ? p.until : null, usedToday: usedToday(uid), left: remaining(uid) };
  }

  async function createOrder(uid, plan) {
    const c = cfg(); const isAf = !!AF[plan]; if (!configured() || (isAf ? !c.adFreeEnabled : !c.savePassEnabled)) throw bad('Payments are not enabled right now', 503);
    const pl = isAf ? afPlans().find((x) => x.id === plan) && { price: afPlans().find((x) => x.id === plan).price, label: 'Ads-Free · ' + AF[plan].label } : plans()[plan]; if (!pl) throw bad('Choose a plan'); if (!(pl.price > 0)) throw bad('This plan is not available', 503);
    const receipt = `sp_${uid}_${now()}`.slice(0, 40);
    const r = await fetchImpl('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64') }, body: JSON.stringify({ amount: pl.price * 100, currency: 'INR', receipt, notes: { userId: String(uid), plan } }) });
    const j = await r.json().catch(() => ({})); if (!r.ok || !j.id) throw bad((j.error && j.error.description) || 'Could not start the payment', 502);
    store.put('payorder', j.id, { userId: String(uid), plan, amount: pl.price, status: 'created', createdAt: now() });
    return { orderId: j.id, amount: pl.price * 100, currency: 'INR', keyId, plan, label: pl.label };
  }

  function verify(uid, { orderId, paymentId, signature }) {
    if (!configured()) throw bad('Payments are not enabled', 503);
    const o = store.get('payorder', String(orderId || '')); if (!o || o.userId !== String(uid)) throw bad('Unknown order', 404);
    if (o.status === 'paid') return { ...state(uid), adFree: adFreeInfo(uid) };
    const exp = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex'); const a = Buffer.from(exp), b = Buffer.from(String(signature || ''));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw bad('This payment could not be verified yet. If money was deducted, it will activate on its own within a few minutes.', 400);
    fulfil(orderId, paymentId, 'checkout'); return { ...state(uid), adFree: adFreeInfo(uid) };
  }

  // ── Ads-Free plan ──────────────────────────────────────────────────────────
  const AF = { af_week: { label: '7 days', days: 7, key: 'adFreeWeekPrice' }, af_month: { label: '30 days', days: 30, key: 'adFreeMonthPrice' } };
  const afPlans = () => { const c = cfg(); return Object.entries(AF).map(([id, p]) => ({ id, label: p.label, days: p.days, price: Math.floor(Number(c[p.key]) || 0) })).filter((p) => p.price > 0); };
  /** Active Ads-Free record for a student, or null. */
  function adFree(uid) { const r = store.get('adfree', String(uid)); return r && r.until > now() ? r : null; }
  const fmtIst = (t) => new Date(t + TZ).toISOString().replace('T', ' ').slice(0, 16) + ' IST';
  function setWindow(uid, expiresMs) { const t = now(); db.access.upsert({ userId: String(uid), expiresMs, windowMs: Math.max(expiresMs - t, 0) }); }
  /** Adds days of Ads-Free + the same days of access (on top of whatever the student already has). */
  function grantAdFree(uid, days, source = 'payment') {
    uid = String(uid); days = Math.max(0, Math.min(3650, Math.floor(Number(days) || 0))); if (!days) throw bad('Enter the number of days (1 or more)');
    const t = now(); const cur = store.get('adfree', uid); const base = cur && cur.until > t ? cur.until : t; const ms = days * DAY;
    store.put('adfree', uid, { until: base + ms, days: ((cur && cur.until > t ? cur.days : 0) || 0) + days, grantedMs: ((cur && cur.until > t ? cur.grantedMs : 0) || 0) + ms, source, updatedAt: t });
    const a = db.access.findOne(uid); const ab = a && a.expiresMs > t ? a.expiresMs : t; setWindow(uid, ab + ms);
    return adFree(uid);
  }
  /** Ends Ads-Free now and takes back the access time that came with it (access earned from ads is kept). */
  function revokeAdFree(uid) {
    uid = String(uid); const cur = adFree(uid); if (!cur) throw bad('This student has no active Ads-Free plan', 404);
    const t = now(); const rem = Math.max(0, cur.until - t); const a = db.access.findOne(uid);
    if (a && a.expiresMs > t) setWindow(uid, Math.max(t, a.expiresMs - rem));
    store.put('adfree', uid, { ...cur, until: t, revokedAt: t }); return { ok: true };
  }
  function adFreeList() {
    return store.list('adfree').filter((r) => r.until > now()).sort((a, b) => b.until - a.until).map((r) => { const u = db.user.findOne(r.id) || {}; return { userId: r.id, name: [u.firstName, u.lastName].filter(Boolean).join(' ') || ('User ' + r.id), username: u.username || '', until: new Date(r.until).toISOString(), source: r.source || '' }; });
  }
  function adFreeInfo(uid) { const r = adFree(uid); const pl = afPlans(); const c = cfg(); return { enabled: !!c.adFreeEnabled && configured() && pl.length > 0, active: !!r, until: r ? r.until : 0, plans: pl.map((p) => ({ id: p.id, label: p.label, price: p.price })), dailyLectures: c.adFreeDailyLectures }; }

  /** Marks an order paid and applies it — exactly once, however many paths report it. */
  function fulfil(orderId, paymentId, via) {
    const o = store.get('payorder', String(orderId || '')); if (!o) return { ok: false, reason: 'unknown' };
    if (o.status === 'paid') return { ok: true, already: true, uid: o.userId, plan: o.plan };
    store.put('payorder', String(orderId), { ...o, status: 'paid', paymentId: String(paymentId || ''), paidAt: now(), via });
    if (AF[o.plan]) grantAdFree(o.userId, AF[o.plan].days, 'razorpay');
    else { const pl = plans()[o.plan]; if (pl) { const cur = store.get('savepass', String(o.userId)); const base = cur && cur.until > now() ? cur.until : now(); store.put('savepass', String(o.userId), { until: base + pl.ms, plan: o.plan, updatedAt: now() }); } }
    store.put('payment', String(paymentId || orderId), { userId: String(o.userId), orderId: String(orderId), plan: o.plan, amount: o.amount, at: now(), via });
    Promise.resolve().then(() => { const name = AF[o.plan] ? `Ads-Free plan (${AF[o.plan].label})` : 'Save pass'; const u = db.user.findOne(o.userId) || {}; const t = AF[o.plan] ? adFree(o.userId) : null;
      return notify(o.userId, `✅ <b>Payment received — ${name}</b>\n\n₹${o.amount} paid.${t ? `\nNo ads and full access until <b>${fmtIst(t.until)}</b>.` : ''}\nThank you! 🙏`).catch(() => {}).then(() => notify('owner', `💸 <b>New payment</b>\n${[u.firstName, u.lastName].filter(Boolean).join(' ') || o.userId} (<code>${o.userId}</code>) · ₹${o.amount} · ${name}`).catch(() => {})); }).catch(() => {});
    return { ok: true, uid: o.userId, plan: o.plan };
  }
  const rzp = async (path) => { const r = await fetchImpl('https://api.razorpay.com/v1' + path, { headers: { authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64') } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw bad((j.error && j.error.description) || 'Razorpay is not reachable', 502); return j; };
  /** Asks Razorpay about a student's unfinished orders (last 2 days) and applies the ones that were actually paid. Never throws. */
  async function refreshUser(uid) {
    if (!configured()) return adFreeInfo(uid);
    const open = store.list('payorder').filter((o) => o.userId === String(uid) && o.status === 'created' && now() - o.createdAt < 2 * DAY).sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
    for (const o of open) { try { const j = await rzp(`/orders/${encodeURIComponent(o.id)}/payments`); const ok = (j.items || []).find((x) => x.status === 'captured' && Number(x.amount) === o.amount * 100); if (ok) fulfil(o.id, ok.id, 'recheck'); } catch (e) { /* try again next time */ } }
    return adFreeInfo(uid);
  }
  /** Razorpay webhook: verifies the signature over the raw body, then applies payment.captured / order.paid. */
  function webhook(rawBody, signature) {
    if (!webhookSecret) return { status: 404, body: 'not configured' };
    const exp = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex'); const a = Buffer.from(exp), b = Buffer.from(String(signature || ''));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { status: 400, body: 'bad signature' };
    let ev = {}; try { ev = JSON.parse(rawBody.toString('utf8')); } catch (e) { return { status: 200, body: 'ignored' }; }
    if (ev.event !== 'payment.captured' && ev.event !== 'order.paid') return { status: 200, body: 'ignored' };
    const pe = ev.payload && ev.payload.payment && ev.payload.payment.entity; const oe = ev.payload && ev.payload.order && ev.payload.order.entity; const orderId = (pe && pe.order_id) || (oe && oe.id);
    const o = orderId && store.get('payorder', String(orderId)); if (!o) return { status: 200, body: 'unknown order' };
    const paid = Number((pe && pe.amount) || (oe && oe.amount_paid) || 0); if (paid && paid !== o.amount * 100) return { status: 200, body: 'amount mismatch' };
    try { fulfil(orderId, (pe && pe.id) || '', 'webhook'); } catch (e) { return { status: 500, body: 'retry' }; } return { status: 200, body: 'ok' };
  }

  /** Rows for the admin "Payments" page. */
  async function list() {
    return store.list('payment').sort((a, b) => b.at - a.at).map((p) => { const u = db.user.findOne(p.userId) || {}; return { id: p.id, name: [u.firstName, u.lastName].filter(Boolean).join(' ') || ('User ' + p.userId), userId: p.userId, provider: AF[p.plan] ? 'Razorpay · Ads-Free ' + AF[p.plan].label : p.plan === 'week' ? 'Razorpay · 7-day save pass' : 'Razorpay · 1-day save pass', amount: p.amount, status: 'success', createdAt: new Date(p.at).toISOString(), orderId: p.orderId }; });
  }
  return { state, createOrder, verify, pass, remaining, consume, list, configured, adFree, adFreeInfo, adFreeList, grantAdFree, revokeAdFree, refreshUser, webhook, fulfil };
}
module.exports = { createPayments };
