'use strict';
// Browser E2E of the student "Lectures" flow (public/index.html + lectures-v2.js) against the real catalog API.
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path');
let chromium; try { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); } catch (e) { try { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); } catch (e2) {} }
const { boot, signInit, OWNER } = require('./harness'); const SHOTS = process.env.SHOTS || '';
const OWN = { id: String(OWNER), name: 'o', role: 'super_admin', perms: new Set(['*']) };
const student = { id: 424242, first_name: 'Riya' };

function seedOld(t) {
  const S = t.service; t.dbs.userDb.upsert({ userId: '424242', firstName: 'Riya', lastName: '', username: 'riya', firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() });
  const lec = (id, n) => ({ _id: id, name: 'Lecture ' + n, link: 'CODE' + id, notes: n % 2 ? 'NOTE' + id : '', order: n, comingSoon: false, isDemo: false });
  const mk = (id, name, subj, premium) => t.dbs.batchDb.upsert({ _id: id, name, isPublic: true, isPremium: !!premium, price: premium ? 999 : 0, premiumUsers: [], subjects: subj.map((s, i) => ({ _id: id + 's' + i, name: s, icon: '📘', color: '#7c6fe0', chapters: [{ _id: id + 's' + i + 'c0', name: 'Basics of ' + s, lectures: [lec(id + 'a', 1), lec(id + 'b', 2), lec(id + 'c', 3)], units: [] }, { _id: id + 's' + i + 'c1', name: 'Journal', lectures: [], units: [{ _id: id + 'u', name: 'U', lectures: [lec(id + 'd', 4)] }] }] })) });
  const fN = S.faculty.create(OWN, { name: 'CA Nitin Goel', institute: 'PW' }).id, fM = S.faculty.create(OWN, { name: 'CA Manish Mahajan', institute: 'JK Shah' }).id, fF = S.faculty.create(OWN, { name: 'Prof Fast Track' }).id;
  ['Accounts', 'Laws', 'Economics', 'Quant'].forEach((n) => S.subject.create(OWN, { name: n, level: 'foundation' }));
  const setup = (id, name, subj, fid, label, extra = {}, premium) => { mk(id, name, subj, premium); S.batch.update(OWN, id, { facultyId: fid, level: 'foundation', label, status: 'active', ...extra }); };
  setup('aaaaaaaaaaaaaaaaaaaaaaa1', 'Nitin Sep 2026', ['Accounts', 'Laws'], fN, 'Sep 2026', { institute: 'PW', startDate: '2026-09-01' });
  setup('aaaaaaaaaaaaaaaaaaaaaaa2', 'Nitin May 2026', ['Accounts'], fN, 'May 2026', { institute: 'PW', startDate: '2026-05-01' });
  setup('aaaaaaaaaaaaaaaaaaaaaaa3', 'Manish Jan 2027', ['Accounts'], fM, 'Jan 2027', { institute: 'JK Shah', startDate: '2027-01-01' });
  setup('aaaaaaaaaaaaaaaaaaaaaaa4', 'Fast Accounts', ['Accounts'], fF, 'Fast 2026', { type: 'fastrack' });
  setup('aaaaaaaaaaaaaaaaaaaaaaa5', 'Premium Laws', ['Laws'], fM, 'Elite 2026', { institute: 'JK Shah' }, true);
  return { fN, fM, fF };
}
async function open(browser, t, { catalogOnly = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load|net::ERR|403|404/.test(m.text())) errors.push(m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url()); const p = u.pathname; const json = (o) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/catalog' || p.startsWith('/api/admin') || p.startsWith('/api/study')) return route.continue();
    if (p === '/api/config') return json({ ownerId: 1, botUsername: 'testbot', forceJoinRequired: false });
    if (p === '/api/batches') return json(t.dbs.batchDb.getAll());
    if (p === '/api/adsfree/status') return json({ success: true, data: { active: true } });
    if (p.startsWith('/api/access/')) return json({ hasAccess: true, expiresAt: new Date(Date.now() + 36e5).toISOString(), claimsToday: 0 });
    if (p === '/api/banned/me') return json({ banned: false });
    if (p.startsWith('/api/maintenance')) return json({ success: true, data: { show: false } });
    if (p === '/api/announcements') return json([]);
    return json({ success: true, data: {}, announcements: [] });
  });
  const init = signInit(student);
  await page.addInitScript((d) => { const noop = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : noop()), apply: () => undefined }); const wa = { initData: d, initDataUnsafe: { user: { id: 424242, first_name: 'Riya' } }, platform: 'android', version: '7.0', colorScheme: 'dark', themeParams: {}, safeAreaInset: { top: 0, bottom: 0 }, contentSafeAreaInset: { top: 0, bottom: 0 }, opened: [], openTelegramLink(u) { window.__opened.push(u); }, openLink(u) { window.__opened.push(u); } }; window.__opened = []; window.Telegram = { WebApp: new Proxy(wa, { get: (t, k) => (k in t ? t[k] : noop()) }) }; }, init);
  await page.goto(`http://127.0.0.1:${t.port}/index.html`); return { page, errors };
}
const shot = async (page, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, n + '.png') }); } };


test('study tab end-to-end (timer, rankings, recap, groups+chat, live, profile)', { skip: !chromium && 'playwright/chromium not installed' }, async () => {
  const t = await boot(); t.dbs.userDb.upsert({ userId: '424242', firstName: 'Riya', lastName: 'Shah', username: 'riya', firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() });
  t.dbs.userDb.upsert({ userId: '555555', firstName: 'Kabir', lastName: 'Rao', username: 'kab', firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() });
  const browser = await chromium.launch();
  try {
    const { page, errors } = await open(browser, t); await page.waitForSelector('#navStudy', { timeout: 15000 });
    await page.evaluate(() => switchNavTab('study')); await page.waitForSelector('#st .st-tabs'); assert.equal(await page.locator('.st-tabs button').count(), 6);
    assert.equal(await page.locator('.bottom-nav .nav-tab').allInnerTexts().then((a) => a.map((x) => x.trim()).join('|')), 'Access|Lectures|Study|Referral|Points');
    await page.waitForSelector('.st-sub'); assert.equal(await page.locator('.st-sub').count(), 8); await shot(page, 'y01-timer');
    assert.equal(await page.textContent('#stClock'), '00:00');
    // start Costing → ticks, then stop; server must have counted it
    await page.click('[data-st=toggle][data-v=Costing]'); await page.waitForSelector('.st-ring.run'); await page.waitForTimeout(2300); const c = await page.textContent('#stClock'); assert.match(c, /^00:0[2-9]$/); assert.match(await page.textContent('#stHint'), /Studying/); await shot(page, 'y02-running');
    await page.click('[data-st=toggle][data-v=Costing]'); await page.waitForFunction(() => !document.querySelector('.st-ring.run')); const secs = t.sqlite.prepare("SELECT seconds FROM study_day WHERE userId='424242' AND subject='Costing'").get().seconds; assert.ok(secs >= 2 && secs <= 5, 'server counted ' + secs);
    // pomodoro toggle persists
    await page.check('[data-st=pomo]'); await page.waitForFunction(() => /25 min focus/.test(document.body.textContent)); assert.equal(JSON.parse(JSON.stringify(t.store.get('study_profile', '424242'))).pomodoro, true); await page.uncheck('[data-st=pomo]');
    // rankings
    await page.click('[data-st=tab][data-v=rankings]'); await page.waitForSelector('.lb-r'); assert.match(await page.textContent('.lb'), /1 students/); assert.ok(await page.locator('.lb-r.me.t1').count() === 1); await shot(page, 'y03-rankings');
    await page.click('[data-st=rp][data-v=all]'); await page.waitForSelector('.lb-h b:has-text("ALL-TIME")');
    // recap + send to Telegram
    await page.click('[data-st=tab][data-v=recap]'); await page.waitForSelector('.rc'); assert.match(await page.textContent('.rc'), /THIS WEEK/); assert.match(await page.textContent('.rc'), /1\/7|1\/\d/); await shot(page, 'y04-recap');
    await page.click('[data-st=sendrecap]'); await page.waitForTimeout(500); assert.equal(t.sent.length, 1); await page.click('[data-st=rcp][data-v=day]'); await page.waitForSelector('.rc');
    // groups: official auto-joined, create, chat with live polling
    await page.click('[data-st=tab][data-v=groups]'); await page.waitForSelector('.gr'); assert.match(await page.textContent('#st'), /CA Intermediate/); assert.match(await page.textContent('#st'), /CA Foundation/); await shot(page, 'y05-groups');
    await page.click('[data-st=gcreate]'); await page.fill('#sf_name', 'Night Owls'); await page.check('#sf_pub'); await page.click('#st-ov [data-x=o]'); await page.waitForSelector('.gi'); assert.match(await page.textContent('.code'), /[A-Z2-9]{6}/); await shot(page, 'y06-group-info');
    const gid = t.store.list('study_group').find((g) => g.name === 'Night Owls').id; t.sqlite.prepare("INSERT OR IGNORE INTO study_member(groupId,userId,joinedAt,lastRead) VALUES(?,?,?,0)").run(gid, '555555', Date.now());
    await page.click('[data-st=chat]'); await page.waitForSelector('#stChat'); await page.fill('#chIn', 'Hello <b>team</b>'); await page.click('[data-st=csend]'); await page.waitForSelector('.msg.me'); assert.equal(await page.locator('.msg.me .x').textContent(), 'Hello <b>team</b>'); assert.equal(await page.locator('.msg.me b').count(), 0);
    t.sqlite.prepare("INSERT INTO study_msg(groupId,userId,name,text,at) VALUES(?,?,?,?,?)").run(gid, '555555', 'Kabir R.', 'Let us study FM', Date.now()); await page.waitForSelector('.msg:not(.me)', { timeout: 8000 }); assert.match(await page.textContent('#chMs'), /Let us study FM/); await shot(page, 'y07-chat');
    await page.click('[data-st=cback]'); await page.waitForSelector('.gi'); await page.click('[data-st=leave]'); await page.click('#st-ov [data-x=o]'); await page.waitForSelector('.gr');
    // live
    await page.click('[data-st=tab][data-v=timer]'); await page.click('[data-st=toggle][data-v=GST]'); await page.waitForSelector('.st-ring.run'); await page.click('[data-st=tab][data-v=live]'); await page.waitForSelector('.lc'); assert.match(await page.textContent('.lvg'), /GST/); assert.match(await page.textContent('#st'), /1 online/); await shot(page, 'y08-live');
    // profile: name, goal, custom subject, calendar, badges, danger zone
    await page.click('[data-st=tab][data-v=profile]'); await page.waitForSelector('.cal'); assert.match(await page.textContent('#st'), /0 \/ 14 earned/); await shot(page, 'y09-profile');
    await page.click('[data-st=editname]'); await page.fill('#sf_n', 'Riya Topper'); await page.click('#st-ov [data-x=o]'); await page.waitForFunction(() => /Riya Topper/.test(document.body.textContent));
    await page.click('.pf2 [data-st=goal]'); await page.fill('#sf_h', '6'); await page.click('#st-ov [data-x=o]'); await page.waitForFunction(() => /6h 0m/.test(document.body.textContent));
    await page.click('[data-st=addcustom]'); await page.fill('#sf_s', 'Maths'); await page.click('#st-ov [data-x=o]'); await page.waitForFunction(() => /1\/4 used/.test(document.body.textContent));
    await page.click('.cal button.td'); await page.waitForFunction(() => /GST|Costing/.test(document.querySelector('.cal').parentElement.textContent)); await shot(page, 'y10-history');
    await page.click('[data-st=tab][data-v=timer]'); await page.waitForSelector('.st-sub'); assert.ok(await page.locator('.st-sub', { hasText: 'Maths' }).count() === 1); assert.match(await page.textContent('#stGoalT'), /\/ 6h 0m/);
    await page.click('[data-st=tab][data-v=profile]'); await page.waitForSelector('.dz'); await page.click('[data-st=cleartoday]'); await page.click('#st-ov [data-x=o]'); await page.waitForTimeout(500); assert.equal(t.sqlite.prepare("SELECT COUNT(*) c FROM study_day WHERE userId='424242'").get().c, 0);
    await page.click('[data-st=deleteall]'); await page.fill('#sf_c', 'nope'); await page.click('#st-ov [data-x=o]'); await page.waitForSelector('#st-ov', { state: 'attached' }); await page.fill('#sf_c', 'DELETE'); await page.click('#st-ov [data-x=o]'); await page.waitForFunction(() => !document.getElementById('st-ov')); assert.equal(t.store.get('study_profile', '424242'), null); await shot(page, 'y11-danger');
    // unread badge for Study nav (message from another student in the official group)
    t.sqlite.prepare("INSERT INTO study_msg(groupId,userId,name,text,at) VALUES('official_intermediate','555555','Kabir R.','hi all',?)").run(Date.now()); await page.evaluate(() => { StudyV2.state.groups = null; }); await page.click('[data-st=tab][data-v=groups]'); await page.waitForSelector('.ub'); assert.equal(await page.locator('#studyNavBadge').isVisible(), true);
    assert.deepEqual(errors, [], 'no console/page errors');
  } finally { await browser.close(); t.close(); }
});
