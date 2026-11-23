'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('crypto');
const { boot, owner, closeAll } = require('./helpers'); test.afterEach(closeAll);
const own = { id: String(owner.id), name: 'o', role: 'super_admin', perms: new Set(['*']) };
const hmac = (secret, s) => crypto.createHmac('sha256', secret).update(s).digest('hex');
let orders = 0; const realFetch = globalThis.fetch; let payments = [];
test.beforeEach(() => { orders = 0; payments = []; globalThis.fetch = async (url, opt) => { const u = String(url); if (u.startsWith('https://api.razorpay.com/v1/orders') && opt && opt.method === 'POST') return { ok: true, json: async () => ({ id: 'order_' + (++orders) }) }; if (u.includes('api.razorpay.com') && u.includes('/payments')) return { ok: true, json: async () => ({ items: payments }) }; return realFetch(url, opt); }; });
test.afterEach(() => { globalThis.fetch = realFetch; });
const setup = async () => { const t = await boot({ config: { razorpayKeyId: 'key', razorpayKeySecret: 'sec', razorpayWebhookSecret: 'whs' } }); t.app.service.config.set(own, { adFreeEnabled: true, adFreeWeekPrice: 20, adFreeMonthPrice: 60, adFreeDailyLectures: 40 }); return t; };
const hook = (t, body, sig) => realFetch(`http://127.0.0.1:${t.port}/api/razorpay/webhook`, { method: 'POST', headers: { 'x-razorpay-signature': sig === undefined ? hmac('whs', body) : sig }, body });
const evt = (orderId, amount, id = 'pay_1') => JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id, order_id: orderId, amount, status: 'captured' } } } });

test('Ads-Free: off by default, prices come from the admin, plans listed', async () => {
  const t = await boot({ config: { razorpayKeyId: 'key', razorpayKeySecret: 'sec' } }); const u = await t.reg(t.user(91, 'A'));
  assert.equal((await t.call(u, 'GET', '/api/app/pay')).json.data.adFree.enabled, false);
  t.app.service.config.set(own, { adFreeEnabled: true, adFreeWeekPrice: 25, adFreeMonthPrice: 0 });
  const a = (await t.call(u, 'GET', '/api/app/pay')).json.data.adFree; assert.equal(a.enabled, true); assert.deepEqual(a.plans.map((p) => [p.id, p.price]), [['af_week', 25]], 'a plan priced 0 is hidden');
  assert.deepEqual((await t.call(u, 'GET', '/api/app/me')).json.data.config.adFreePlans.map((p) => p.id), ['af_week'], 'the header pill needs the plans');
  assert.equal((await t.call(u, 'POST', '/api/app/pay/order', { plan: 'af_month' })).status, 400);
});
test('Ads-Free: bad signature never activates; webhook pays once; access + no ads for the period', async () => {
  const t = await setup(); const u = await t.reg(t.user(92, 'B')); const uid = String(u.id);
  const o = (await t.call(u, 'POST', '/api/app/pay/order', { plan: 'af_week' })).json.data; assert.equal(o.amount, 2000);
  const bad = await t.call(u, 'POST', '/api/app/pay/verify', { orderId: o.orderId, paymentId: 'pay_1', signature: 'nope' }); assert.equal(bad.status, 400); assert.match(bad.json.error, /activate on its own/);
  assert.equal((await t.call(u, 'GET', '/api/app/access')).json.data.adFree, null);
  assert.equal((await hook(t, evt(o.orderId, 2000), 'wrong')).status, 400);
  assert.equal((await hook(t, evt(o.orderId, 1)).then((r) => r.status)), 200); assert.equal((await t.call(u, 'GET', '/api/app/access')).json.data.adFree, null, 'wrong amount is ignored');
  assert.equal((await hook(t, evt(o.orderId, 2000))).status, 200);
  const s = (await t.call(u, 'GET', '/api/app/access')).json.data; assert.equal(s.adFree.active, true); assert.equal(s.active, true); assert.ok(s.remainingMs > 6.9 * 864e5); assert.equal(s.servers.length, 0); assert.equal(s.lectureServers.length, 0); assert.equal(s.usage.lecturesLimit, 40);
  assert.equal((await t.call(u, 'GET', '/api/app/me')).json.data.adFree.active, true);
  assert.equal((await t.call(u, 'GET', '/api/app/me')).json.data.config.monetag.on, false, 'Premium members get no Monetag ads');
  const until = t.app.store.get('adfree', uid).until; await hook(t, evt(o.orderId, 2000)); await t.call(u, 'POST', '/api/app/pay/verify', { orderId: o.orderId, paymentId: 'pay_1', signature: hmac('sec', o.orderId + '|pay_1') });
  assert.equal(t.app.store.get('adfree', uid).until, until, 'replays never add days twice');
  assert.equal(t.app.store.list('payment').filter((p) => p.userId === uid).length, 1);
});
test('Ads-Free: checkout callback works, renewal adds days, admin grant + revoke', async () => {
  const t = await setup(); const u = await t.reg(t.user(93, 'C')); const uid = String(u.id);
  const o1 = (await t.call(u, 'POST', '/api/app/pay/order', { plan: 'af_month' })).json.data; assert.equal(o1.amount, 6000);
  assert.equal((await t.call(u, 'POST', '/api/app/pay/verify', { orderId: o1.orderId, paymentId: 'pay_9', signature: hmac('sec', o1.orderId + '|pay_9') })).status, 200);
  const u1 = t.app.store.get('adfree', uid).until; assert.ok(u1 - Date.now() > 29.9 * 864e5);
  const o2 = (await t.call(u, 'POST', '/api/app/pay/order', { plan: 'af_week' })).json.data; await hook(t, evt(o2.orderId, 2000, 'pay_10'));
  assert.ok(Math.abs(t.app.store.get('adfree', uid).until - (u1 + 7 * 864e5)) < 5000, 'renewal adds to the end');
  const rev = await t.call(owner, 'POST', '/api/admin/adfree/revoke', { userId: uid }); assert.equal(rev.status, 200);
  const s = (await t.call(u, 'GET', '/api/app/access')).json.data; assert.equal(s.adFree, null); assert.equal(s.active, false, 'access that came with the plan is taken back');
  assert.equal((await t.call(owner, 'POST', '/api/admin/adfree/revoke', { userId: uid })).status, 404);
  const g = await t.call(owner, 'POST', '/api/admin/adfree/grant', { userId: uid, days: 3 }); assert.equal(g.status, 200);
  assert.equal((await t.call(owner, 'GET', '/api/admin/adfree')).json.data.items.length, 1); assert.equal((await t.call(u, 'GET', '/api/admin/adfree')).status, 403);
  assert.equal((await t.call(u, 'POST', '/api/admin/adfree/grant', { userId: uid, days: 3 })).status, 403);
});
test('Ads-Free: a closed app / missed callback is fixed by asking Razorpay', async () => {
  const t = await setup(); const u = await t.reg(t.user(94, 'D')); const o = (await t.call(u, 'POST', '/api/app/pay/order', { plan: 'af_week' })).json.data;
  assert.equal((await t.call(u, 'POST', '/api/app/pay/refresh', {})).json.data.adFree.active, false);
  payments = [{ id: 'pay_77', status: 'captured', amount: 2000 }]; assert.equal((await t.call(u, 'POST', '/api/app/pay/refresh', {})).json.data.adFree.active, true);
});
test('Ads-Free: defaults ₹40 / ₹130 / 20 lectures, and the bot greets members as Premium', async () => {
  const t = await boot({ config: { razorpayKeyId: 'key', razorpayKeySecret: 'sec' } }); const c = t.app.service.config.get();
  assert.deepEqual([c.adFreeEnabled, c.adFreeWeekPrice, c.adFreeMonthPrice, c.adFreeDailyLectures], [false, 40, 130, 20]);
  const u = await t.reg(t.user(95, 'Eve')); t.app.db.user.setLevel(String(u.id), 'intermediate'); t.tg.clear(); await t.say(u, '/start'); assert.doesNotMatch(JSON.stringify(t.tg.of('sendMessage')), /Premium member/);
  await t.call(owner, 'POST', '/api/admin/adfree/grant', { userId: String(u.id), days: 7 }); t.tg.clear(); await t.say(u, '/start'); assert.match(JSON.stringify(t.tg.of('sendMessage')), /Premium member/);
});
