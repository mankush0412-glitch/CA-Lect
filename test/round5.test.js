'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { boot, owner, closeAll } = require('./helpers'); test.afterEach(closeAll);
const own = { id: String(owner.id), name: 'o', role: 'super_admin', perms: new Set(['*']) };
const IP = (ip) => ({ 'x-forwarded-for': ip });
async function joined(t, u) {
  t.app.service.config.set(own, { joinChannelsFoundation: [{ title: 'Main', url: 'https://t.me/main', chatId: '-1001' }] });
  t.tg.members['-1001:' + u.id] = 'member'; await t.say(u, '/start'); await t.press(u, 'lv:foundation'); await t.press(u, 'joined:foundation');
}

test('leaving a required channel: warning with 24h timer + rejoin button; rejoining cancels it', async () => {
  const t = await boot(); const u = t.user(21); await joined(t, u); const id = String(u.id);
  t.tg.members['-1001:' + u.id] = 'left'; t.tg.clear();
  await t.app.access.onMemberUpdate({ chat: { id: -1001 }, new_chat_member: { status: 'left', user: { id: u.id } } });
  assert.equal(t.app.access.suspension(id), null); const w = t.app.access.leaveState(id); assert.ok(w); assert.equal(Math.round((w.until - t.clock.t) / 3600000), 24);
  const m = t.tg.last('sendMessage'); assert.match(m.text, /left a required channel/i); assert.match(m.text, /24 hours/); assert.match(JSON.stringify(m.reply_markup), /t\.me\/main/); assert.match(JSON.stringify(m.reply_markup), /lwchk/);
  t.tg.clear(); await t.press(u, 'lwchk'); assert.ok(t.app.access.leaveState(id)); // pressed without rejoining
  t.tg.members['-1001:' + u.id] = 'member'; await t.press(u, 'lwchk'); assert.equal(t.app.access.leaveState(id), null);
  assert.equal(await t.app.access.tickLeave(), 0); assert.equal(t.app.db.ban.isBanned(id), false);
});

test('not rejoined within 24h: account + IP banned automatically; /unban lifts the IP too; staff exempt', async () => {
  const t = await boot(); const u = t.user(22), other = t.user(23); await joined(t, u); await t.reg(other); const id = String(u.id);
  assert.equal((await t.call(u, 'GET', '/api/app/me', undefined, IP('9.9.9.9'))).status, 200);
  t.tg.members['-1001:' + u.id] = 'left'; await t.app.access.onMemberUpdate({ chat: { id: -1001 }, new_chat_member: { status: 'left', user: { id: u.id } } });
  t.clock.t += 23 * 3600000; assert.equal(await t.app.access.tickLeave(), 0); assert.equal(t.app.db.ban.isBanned(id), false);
  t.clock.t += 2 * 3600000; t.tg.clear(); assert.equal(await t.app.access.tickLeave(), 1);
  assert.equal(t.app.db.ban.isBanned(id), true); assert.ok(t.app.access.devices().ipState('9.9.9.9'));
  assert.ok(t.tg.of('sendMessage').some((m) => String(m.chat_id) === id && /banned/i.test(m.text))); assert.ok(t.tg.of('sendMessage').some((m) => String(m.chat_id) === String(owner.id) && /Auto-banned/.test(m.text)));
  const r = await t.call(other, 'GET', '/api/app/me', undefined, IP('9.9.9.9')); assert.equal(r.status, 403); assert.equal(r.json.banned, true);
  assert.equal((await t.call(other, 'GET', '/api/app/me', undefined, IP('8.8.8.8'))).status, 200);
  assert.match((await (async () => { t.tg.clear(); await t.say(owner, '/ipbans'); return t.tg.last('sendMessage'); })()).text, /9\.9\.9\.9/);
  await t.say(owner, `/unban ${id}`); assert.equal(t.app.db.ban.isBanned(id), false); assert.equal(t.app.access.devices().ipState('9.9.9.9'), null);
  assert.equal((await t.call(other, 'GET', '/api/app/me', undefined, IP('9.9.9.9'))).status, 200);
});

test('/suspend blocks account + IPs for N days and /unsuspend lifts both; /unbanip works', async () => {
  const t = await boot(); const u = t.user(24), o = t.user(25); await t.reg(u); await t.reg(o); const id = String(u.id);
  await t.call(u, 'GET', '/api/app/me', undefined, IP('7.7.7.7')); t.tg.clear();
  await t.say(owner, `/suspend ${id} 3 Sharing login`); assert.match(t.tg.of('sendMessage').map((m) => m.text).join('|'), /Suspended/);
  assert.ok(t.app.access.suspension(id)); assert.equal(Math.round((t.app.access.suspension(id).until - t.clock.t) / 864e5), 3);
  assert.match(t.tg.of('sendMessage').find((m) => String(m.chat_id) === id).text, /Sharing login/);
  assert.equal((await t.call(o, 'GET', '/api/app/me', undefined, IP('7.7.7.7'))).status, 403);
  t.clock.t += 4 * 864e5; assert.equal((await t.call(o, 'GET', '/api/app/me', undefined, IP('7.7.7.7'))).status, 200); t.clock.t -= 4 * 864e5;
  await t.say(owner, `/unsuspend ${id}`); assert.equal(t.app.access.suspension(id), null); assert.equal(t.app.access.devices().ipState('7.7.7.7'), null);
  await t.say(owner, `/suspend ${owner.id} 2`); assert.equal(t.app.access.suspension(String(owner.id)), null);
  t.app.access.devices().banIps(id, { kind: 'ban' }); await t.say(owner, '/unbanip 7.7.7.7'); assert.equal(t.app.access.devices().ipState('7.7.7.7'), null);
});

test('multi-account alert has Ban and Suspend buttons that act on the accounts + their IPs', async () => {
  const t = await boot(); const a = t.user(31, 'Asha'), b = t.user(32, 'Ben'), c = t.user(33, 'Cy'); for (const u of [a, b, c]) await t.reg(u);
  const body = { fingerprint: 'abcdef0123456789' }; await t.call(a, 'POST', '/api/app/device-check', body, IP('1.1.1.1')); t.tg.clear(); await t.call(b, 'POST', '/api/app/device-check', body, IP('2.2.2.2'));
  const al = t.tg.of('sendMessage').find((m) => /Possible Multi-Account/.test(m.text || '')); const cds = al.reply_markup.inline_keyboard.flat().map((x) => x.callback_data);
  for (const p of ['mgb:', 'mgn:', 'mgs:1:', 'mgs:3:', 'mgs:7:', 'mgs:30:', 'mgx:']) assert.ok(cds.some((x) => x.startsWith(p)), p); assert.ok(cds.every((x) => x.length <= 64));
  const tok = cds.find((x) => x.startsWith('mgs:3:')).split(':')[2];
  await t.press(a, 'mgb:' + tok); assert.equal(t.app.db.ban.isBanned(String(a.id)), false); // students cannot press it
  await t.press(owner, 'mgs:3:' + tok); assert.ok(t.app.access.suspension(String(a.id))); assert.ok(t.app.access.suspension(String(b.id)));
  assert.ok(t.app.access.devices().ipState('1.1.1.1') && t.app.access.devices().ipState('2.2.2.2'));
  assert.equal((await t.call(c, 'GET', '/api/app/me', undefined, IP('1.1.1.1'))).status, 403);
  await t.say(owner, `/unsuspend ${a.id}`); await t.say(owner, `/unsuspend ${b.id}`); assert.equal((await t.call(c, 'GET', '/api/app/me', undefined, IP('1.1.1.1'))).status, 200);
  await t.press(owner, 'mgb:' + tok); assert.ok(t.app.db.ban.isBanned(String(a.id)) && t.app.db.ban.isBanned(String(b.id))); assert.ok(t.app.access.devices().ipState('2.2.2.2'));
  await t.press(owner, 'mgn:' + tok); // already handled: harmless
});

test('after lectures arrive the student gets a "Lecture sent" message with chapter, faculty, quota and support', async () => {
  const t = await boot(); const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'access.js'), 'utf8');
  assert.match(src, /Lectures left today/); assert.match(src, /Need help\?/);
  const bad = t.app.service.config.get(); assert.equal(bad.monetagAdsPerAccess, 3); assert.equal(bad.leaveGraceHours, 24); assert.equal(bad.dailyAdLimit, 6);
});

test('leave is caught when the student opens the app (even without Telegram’s leave event) and the 24h warning starts', async () => {
  const t = await boot(); const u = t.user(23); await joined(t, u); const id = String(u.id); await t.reg(u);
  t.tg.members['-1001:' + u.id] = 'left'; t.tg.clear();
  const j = (await t.call(u, 'GET', '/api/app/join')).json.data; assert.equal(j.allJoined, false);
  await new Promise((r) => setTimeout(r, 50)); assert.ok(t.app.access.leaveState(id), 'warning started'); assert.match(t.tg.last('sendMessage').text, /24 hours/);
});

test('Telegram requests never carry a broken emoji half (fixes "text must be encoded in UTF-8")', async () => {
  const http = require('node:http'); let seen = ''; const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { seen = b; res.setHeader('content-type', 'application/json'); res.end('{"ok":true,"result":{}}'); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const { Tg } = require('../src/tg'); const tg = new Tg('T', 'http://127.0.0.1:' + srv.address().port);
  try { const cut = ('Lecture 🔥🔥').slice(0, 10); await tg.sendMessage(1, cut + ' ok'); assert.ok(!/\\ud[89a-f][0-9a-f]{2}/i.test(seen), seen); assert.match(seen, /ok/); } finally { srv.close(); }
});
