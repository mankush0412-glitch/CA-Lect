'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { boot, owner, closeAll } = require('./helpers'); test.afterEach(closeAll);
test('banned student gets ONE appeal: reject = final, unban = restored; a new ban gives a new chance', async () => {
  const t = await boot(); const u = t.user(41, 'Ria'); await t.reg(u); const id = String(u.id);
  await t.say(owner, `/ban ${id} Spam`); assert.equal(t.app.db.ban.isBanned(id), true);
  t.tg.clear(); await t.say(u, '/start'); let m = t.tg.last('sendMessage'); assert.match(m.text, /banned/i); assert.match(m.text, /Spam/); assert.match(JSON.stringify(m.reply_markup), /bappeal/);
  await t.press(u, 'bappeal'); t.tg.clear(); await t.say(u, 'Sorry, it was a mistake');
  const al = t.tg.of('sendMessage').find((x) => String(x.chat_id) === String(owner.id) && /Ban appeal/.test(x.text)); assert.ok(al, 'owner gets the appeal'); assert.match(JSON.stringify(al.reply_markup), /bap:/); assert.match(al.text, /mistake/);
  t.tg.clear(); await t.say(u, 'second try'); assert.match(t.tg.last('sendMessage').text, /with the admin/i); assert.ok(!t.tg.of('sendMessage').some((x) => String(x.chat_id) === String(owner.id)), 'no second appeal reaches the owner');
  await t.press(owner, 'brj:' + id); t.tg.clear(); await t.say(u, '/start'); assert.match(t.tg.last('sendMessage').text, /final/i); assert.doesNotMatch(JSON.stringify(t.tg.last('sendMessage').reply_markup || {}), /bappeal/);
  await t.say(owner, `/unban ${id}`); await t.say(owner, `/ban ${id} Again`); t.tg.clear(); await t.say(u, '/start'); assert.match(JSON.stringify(t.tg.last('sendMessage').reply_markup), /bappeal/, 'new ban = new chance');
  await t.press(u, 'bappeal'); await t.say(u, 'please'); await t.press(owner, 'bap:' + id); assert.equal(t.app.db.ban.isBanned(id), false);
});
test('force-join switch: OFF = nobody is asked to join; ON again = as before', async () => {
  const t = await boot(); const own = { id: String(owner.id), name: 'o', role: 'super_admin', perms: new Set(['*']) };
  t.app.service.config.set(own, { joinChannelsFoundation: [{ title: 'Main', url: 'https://t.me/x', chatId: '-1001' }] });
  assert.ok(t.app.service.config.joinFor('foundation').length >= 1);
  t.app.service.config.set(own, { forceJoin: false }); assert.equal(t.app.service.config.joinFor('foundation').length, 0); assert.equal(t.app.service.config.joinFor('intermediate').length, 0);
  t.app.service.config.set(own, { forceJoin: true }); assert.ok(t.app.service.config.joinFor('foundation').length >= 1);
});
test('public /hello tells the page which bot to open (no login needed)', async () => {
  const t = await boot(); const r = await fetch(`http://127.0.0.1:${t.port}/api/app/hello`); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.data.bot, 'testbot');
});
test('browser preview: guest can browse read-only, cannot write, and the admin switch turns it off', async () => {
  const t = await boot(); const base = `http://127.0.0.1:${t.port}/api/app`; const own = { id: String(owner.id), name: 'o', role: 'super_admin', perms: new Set(['*']) };
  let r = await fetch(base + '/me'); let j = await r.json(); assert.equal(r.status, 200); assert.equal(j.data.guest, true); assert.equal(j.data.bot, 'testbot');
  r = await fetch(base + '/tree?level=foundation'); j = await r.json(); assert.equal(r.status, 200); assert.ok(Array.isArray(j.data.pins));
  r = await fetch(base + '/join'); j = await r.json(); assert.equal(j.data.required, false);
  r = await fetch(base + '/lectures/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"ids":["1"]}' }); j = await r.json(); assert.equal(r.status, 401); assert.equal(j.guest, true);
  r = await fetch(base + '/plan'); assert.equal(r.status, 401);
  const subs = (await (await fetch(base + '/tree?level=foundation')).json()).data; const b = JSON.stringify(subs).match(/"(?:batchId|bid)":"([^"]+)"/);
  if (b) { r = await fetch(base + `/batch/${b[1]}/x`); assert.ok([200, 404].includes(r.status)); }
  t.app.service.config.set(own, { webPreview: false }); r = await fetch(base + '/me'); assert.equal(r.status, 401);
});
test('browser preview: guest sees a batch view without any channel ids', async () => {
  const t = await boot(); const bid = t.add('Free batch', 'foundation', ['Accounts']); const b = t.app.db.batch.getOne(bid); const sid = b.subjects[0]._id; const ch = t.app.content.addChapter(bid, sid, 'Journal'); t.app.content.addLecture(bid, sid, ch._id, { name: 'Lecture 1', duration: 3600, channelMsgId: 6001 });
  const r = await fetch(`http://127.0.0.1:${t.port}/api/app/batch/${bid}/${sid}`); const j = await r.json(); assert.equal(r.status, 200); assert.equal(j.data.chapters[0].lectures[0].name, 'Lecture 1'); assert.equal(JSON.stringify(j).includes('6001'), false);
});
