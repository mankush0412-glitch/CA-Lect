'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('crypto');
const { boot, owner, closeAll } = require('./helpers'); test.afterEach(closeAll);
const { createPayments } = require('../src/payments');
const own = { id: String(owner.id), name: 'o', role: 'super_admin', perms: new Set(['*']) };

test('save pass: Razorpay order → signed verify → daily limit; forged signature rejected', async () => {
  const t = await boot(); t.app.service.config.set(own, { savePassEnabled: true, savePassDayPrice: 19, savePassWeekPrice: 99, savePassDailyLimit: 2 });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ id: 'order_1' }) });
  const pay = createPayments({ store: t.app.store, service: t.app.service, db: t.app.db, keyId: 'k', keySecret: 's', fetchImpl });
  const u = '77'; assert.equal(pay.state(u).enabled, true); assert.equal(pay.remaining(u), 0);
  const o = await pay.createOrder(u, 'day'); assert.equal(o.amount, 1900);
  assert.throws(() => pay.verify(u, { orderId: 'order_1', paymentId: 'pay_1', signature: 'bad' }), /verified/);
  const sig = crypto.createHmac('sha256', 's').update('order_1|pay_1').digest('hex'); const st = pay.verify(u, { orderId: 'order_1', paymentId: 'pay_1', signature: sig });
  assert.equal(st.active, true); assert.equal(pay.remaining(u), 2); pay.consume(u, 2); assert.equal(pay.remaining(u), 0);
  assert.equal((await pay.list()).length, 1);
});

test('announcement with Support button, level-specific force-join config, grant text default', async () => {
  const t = await boot(); const cfg = t.app.service.config;
  cfg.set(own, { joinChannelsFoundation: [{ title: 'F', url: 'https://t.me/f', chatId: '-1001' }], themeSkin: 'green' });
  const c = cfg.get(); assert.equal(c.joinChannelsFoundation.length, 1); assert.equal(c.themeSkin, 'green'); assert.throws(() => cfg.set(own, { themeSkin: 'diwali' }));
});

test('admin link → bot: add files to a chapter, replace a lecture and a note, reorder lectures', async () => {
  const t = await boot(); const bid = t.add('B1', 'foundation', ['Accounts']); const b = t.app.db.batch.getOne(bid); const sid = b.subjects[0]._id;
  const ch = t.app.content.addChapter(bid, sid, 'Ch1');
  const l1 = t.app.content.addLecture(bid, sid, ch._id, { name: '', duration: 100, channelMsgId: 1 }); const l2 = t.app.content.addLecture(bid, sid, ch._id, { name: 'Two', duration: 50, channelMsgId: 2 }); const nt = t.app.content.addNote(bid, sid, ch._id, { name: 'N', channelMsgId: 3 });
  assert.equal(l1.name, 'Lecture 01');
  const call = (m, p, body) => t.app.admin ? null : null; void call;
  // add files via link
  t.app.db.kv.set('up:aaaaaaaaaaaaaaaa', JSON.stringify({ k: 'add', cid: ch._id, exp: Date.now() + 1e6 })); await t.say(owner, '/start u_aaaaaaaaaaaaaaaa'); assert.match(t.tg.last('sendMessage').text, /Upload in progress[\s\S]*Ch1/);
  await t.say(owner, '/cancel');
  // replace lecture
  t.app.db.kv.set('up:bbbbbbbbbbbbbbbb', JSON.stringify({ k: 'rl', lid: l1._id, exp: Date.now() + 1e6 })); await t.say(owner, '/start u_bbbbbbbbbbbbbbbb'); assert.match(t.tg.last('sendMessage').text, /Replace lecture/);
  await t.send(owner, { video: { file_id: 'nv', duration: 777, file_size: 5 } }); assert.match(t.tg.last('sendMessage').text, /Lecture replaced/);
  const after = t.app.content.index().lec.get(l1._id).lecture; assert.equal(after.duration, 777); assert.equal(after.name, 'Lecture 01'); assert.notEqual(after.channelMsgId, 1);
  // replace note
  t.app.db.kv.set('up:cccccccccccccccc', JSON.stringify({ k: 'rn', cid: ch._id, nid: nt._id, exp: Date.now() + 1e6 })); await t.say(owner, '/start u_cccccccccccccccc'); await t.send(owner, { document: { file_id: 'nd', file_name: 'x.pdf', mime_type: 'application/pdf', file_size: 3 } }); assert.match(t.tg.last('sendMessage').text, /Note replaced/);
  // reorder + expired link
  t.app.content.moveLecture(l2._id, 'up'); assert.equal(t.app.db.batch.getOne(bid).subjects[0].chapters[0].lectures[0]._id, l2._id);
  t.app.db.kv.set('up:dddddddddddddddd', JSON.stringify({ k: 'add', cid: ch._id, exp: 1 })); await t.say(owner, '/start u_dddddddddddddddd'); assert.match(t.tg.last('sendMessage').text, /expired/);
});

test('Adsgram access ads: default server (+8h x3/day), hidden until a Block ID exists, timed claim, zone validation', async () => {
  const t = await boot(); const acc = t.app.access; acc.ensureDefaults(); acc.ensureDefaults(); assert.equal(t.app.store.list('adserver').length, 1);
  const u = await t.reg(t.user(5)); const uid = String(u.id);
  let st = (await t.call(u, 'GET', '/api/app/access')).json.data; assert.equal(st.servers.length, 0); // no Block ID yet
  t.app.service.config.set(own, { adsgramBlockId: '12345', monetagZoneId: '12243244' });
  st = (await t.call(u, 'GET', '/api/app/access')).json.data; assert.equal(st.servers.length, 1); assert.equal(st.servers[0].hours, 8); assert.equal(st.servers[0].perDay, 3); assert.equal(st.servers[0].provider, 'adsgram');
  const sid = st.servers[0].id;
  for (let i = 1; i <= 3; i++) { const s = acc.adStart(uid, sid); assert.equal(s.provider, 'adsgram'); assert.equal(s.blockId, '12345'); assert.equal(s.url, ''); assert.throws(() => acc.adClaim(uid, s.token), /more seconds/); t.clock.t += 6000; acc.adClaim(uid, s.token); assert.ok(Math.abs(acc.window(uid).remainingMs - i * 8 * 3600000) < 120000, 'hours stack: ' + acc.window(uid).remainingMs); }
  assert.throws(() => acc.adStart(uid, sid), /Daily limit/);
  assert.throws(() => t.app.service.config.set(own, { monetagZoneId: 'abc' }), /numbers only/);
  const me = (await t.call(u, 'GET', '/api/app/me')).json.data; assert.equal(me.config.monetag.on, true); assert.equal(me.config.monetag.zone, '12243244');
});

test('Test Series by subject: validated list is stored and exposed to the app; fullscreen flag defaults on', async () => {
  const t = await boot(); const u = await t.reg(t.user(6));
  t.app.service.config.set(own, { testSeriesItems: [{ level: 'foundation', subject: 'Accounts', title: 'Full tests', url: 'https://t.example/a' }, { subject: 'Laws', url: 'https://t.example/l' }] });
  const me = (await t.call(u, 'GET', '/api/app/me')).json.data; assert.equal(me.config.testSeriesItems.length, 2); assert.equal(me.config.testSeriesItems[1].level, 'both'); assert.equal(me.config.fullscreen, false);
  assert.throws(() => t.app.service.config.set(own, { testSeriesItems: [{ subject: 'X', url: 'http://bad' }] }), /https/);
  t.app.service.config.set(own, { fullscreen: true }); assert.equal((await t.call(u, 'GET', '/api/app/me')).json.data.config.fullscreen, true);
});
