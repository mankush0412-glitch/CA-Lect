'use strict';
/**
 * Optional Razorpay "Save pass": a paid day/week pass that lets a student forward / save the lectures sent to them
 * (protect_content is switched off for them), capped per day. Everything is driven by admin settings:
 * savePassEnabled, savePassDayPrice, savePassWeekPrice, savePassDailyLimit. Needs RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.
 */
const crypto = require('crypto');
const { HttpError } = require('./service');
const bad = (m, c = 400) => new HttpError(c, m);
const TZ = 330 * 60000; const DAY = 864e5;

function createPayments({ store, service, db, keyId = '', keySecret = '', now = () => Date.now(), fetchImpl = (...a) => fetch(...a) }) {
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
    const c = cfg(); if (!c.savePassEnabled || !configured()) throw bad('Payments are not enabled', 503);
    const pl = plans()[plan]; if (!pl) throw bad('Choose a day or week pass'); if (!(pl.price > 0)) throw bad('This pass is not available', 503);
    const receipt = `sp_${uid}_${now()}`.slice(0, 40);
    const r = await fetchImpl('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64') }, body: JSON.stringify({ amount: pl.price * 100, currency: 'INR', receipt, notes: { userId: String(uid), plan } }) });
    const j = await r.json().catch(() => ({})); if (!r.ok || !j.id) throw bad((j.error && j.error.description) || 'Could not start the payment', 502);
    store.put('payorder', j.id, { userId: String(uid), plan, amount: pl.price, status: 'created', createdAt: now() });
    return { orderId: j.id, amount: pl.price * 100, currency: 'INR', keyId, plan, label: pl.label };
  }

  function verify(uid, { orderId, paymentId, signature }) {
    if (!configured()) throw bad('Payments are not enabled', 503);
    const o = store.get('payorder', String(orderId || '')); if (!o || o.userId !== String(uid)) throw bad('Unknown order', 404);
    if (o.status === 'paid') return state(uid);
    const exp = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex'); const a = Buffer.from(exp), b = Buffer.from(String(signature || ''));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw bad('Payment could not be verified', 400);
    const pl = plans()[o.plan]; const cur = store.get('savepass', String(uid)); const base = cur && cur.until > now() ? cur.until : now();
    store.put('savepass', String(uid), { until: base + pl.ms, plan: o.plan, updatedAt: now() });
    store.put('payorder', String(orderId), { ...o, status: 'paid', paymentId: String(paymentId), paidAt: now() });
    store.put('payment', String(paymentId), { userId: String(uid), orderId: String(orderId), plan: o.plan, amount: o.amount, at: now() });
    return state(uid);
  }

  /** Rows for the admin "Payments" page. */
  async function list() {
    return store.list('payment').sort((a, b) => b.at - a.at).map((p) => { const u = db.user.findOne(p.userId) || {}; return { id: p.id, name: [u.firstName, u.lastName].filter(Boolean).join(' ') || ('User ' + p.userId), userId: p.userId, provider: p.plan === 'week' ? 'Razorpay · 7-day save pass' : 'Razorpay · 1-day save pass', amount: p.amount, status: 'success', createdAt: new Date(p.at).toISOString(), orderId: p.orderId }; });
  }
  return { state, createOrder, verify, pass, remaining, consume, list, configured };
}
module.exports = { createPayments };
