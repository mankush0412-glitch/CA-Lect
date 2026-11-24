'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { boot, owner, closeAll } = require('./helpers'); test.afterEach(closeAll);
const own = { id: String(owner.id), name: 'o', role: 'super_admin', perms: new Set(['*']) };
test('CA Final: off = only Foundation + Intermediate everywhere; on = Final appears', async () => {
  const t = await boot(); const u = await t.reg(t.user(71, 'Mira'));
  t.tg.clear(); await t.say(u, '/start'); let m = t.tg.of('sendMessage').find((x) => /Choose Your Level/.test(x.text || '')); if (m) { const k = JSON.stringify(m.reply_markup); assert.doesNotMatch(k, /lv:final/); }
  await t.press(u, 'lv:final'); assert.notEqual((t.app.db.user.findOne(String(u.id)) || {}).level, 'final', 'cannot pick Final while it is off');
  assert.equal((await t.call(u, 'GET', '/api/app/me')).json.data.config.finalEnabled, false);
  await t.call(u, 'POST', '/api/app/level', { level: 'final' }); assert.notEqual((t.app.db.user.findOne(String(u.id)) || {}).level, 'final');
  t.app.service.config.set(own, { finalEnabled: true });
  assert.equal((await t.call(u, 'GET', '/api/app/me')).json.data.config.finalEnabled, true);
  t.tg.clear(); await t.say(u, '/start'); m = t.tg.of('sendMessage').find((x) => /Choose Your Level|Level:/.test(x.text || '') || /lv:/.test(JSON.stringify(x.reply_markup || {})));
  await t.call(u, 'POST', '/api/app/level', { level: 'final' }); assert.equal((t.app.db.user.findOne(String(u.id)) || {}).level, 'final');
  assert.equal((await t.call(u, 'GET', '/api/app/tree?level=final')).status, 200);
});
test('CA Final join channels fall back to Intermediate; own list wins when set', async () => {
  const t = await boot(); const I = { title: 'Inter', url: 'https://t.me/i', chatId: '-1001', pic: 'https://x/logo.jpg' }; const F = { title: 'Final', url: 'https://t.me/f', chatId: '-1002' };
  t.app.service.config.set(own, { finalEnabled: true, joinChannelsIntermediate: [I] });
  assert.deepEqual(t.app.service.config.joinFor('final').map((c) => c.title), ['Inter']);
  assert.equal(t.app.service.config.joinFor('final')[0].pic, 'https://x/logo.jpg');
  t.app.service.config.set(own, { joinChannelsFinal: [F] }); assert.deepEqual(t.app.service.config.joinFor('final').map((c) => c.title), ['Final']); assert.deepEqual(t.app.service.config.joinFor('intermediate').map((c) => c.title), ['Inter']);
});
test('owner sees private batches in the student app and the upload wizard; students do not', async () => {
  const t = await boot(); const fid = t.app.service.faculty.create(own, { name: 'CA Hidden' }).id;
  const b = t.app.service.batch.create(own, { name: 'Priv', level: 'foundation', isPublic: false, status: 'active', facultyId: fid, label: 'May 2027' }); t.app.content.addSubject(b.id, { name: 'Accounts' }); const bid = String(b.id);
  const st = await t.reg(t.user(72, 'S')); const catS = JSON.stringify((await t.call(st, 'GET', '/api/app/tree?level=foundation')).json.data); const catO = JSON.stringify((await t.call(owner, 'GET', '/api/app/tree?level=foundation')).json.data);
  assert.equal(catS.includes(bid), false); assert.equal(catO.includes(bid), true); assert.match(catO, /"private":true/);
  const ub = t.app.service.uploadBatches().find((x) => x.id === bid); assert.ok(ub); assert.equal(ub.isPublic, false);
});

test('the same batch name can exist once in Intermediate and once in Final, but not twice in one level', async () => {
  const t = await boot({}); const S = t.app.service; const own = { id: String(owner.id), name: 'o', role: 'super_admin', perms: new Set(['*']) };
  const a = S.batch.create(own, { name: 'Direct Tax – Jasmeet Singh', level: 'intermediate' });
  const f = S.batch.create(own, { name: 'Direct Tax – Jasmeet Singh', level: 'final' });
  assert.ok(a.id !== f.id && f.level === 'final');
  assert.throws(() => S.batch.create(own, { name: 'direct tax – jasmeet singh', level: 'final' }), /already exists/);
  assert.throws(() => S.batch.create(own, { name: 'Direct Tax – Jasmeet Singh', level: 'intermediate' }), /already exists/);
});
