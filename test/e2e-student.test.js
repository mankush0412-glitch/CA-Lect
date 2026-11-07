'use strict';
// Browser E2E of the student "Lectures" flow (public/index.html + lectures-v2.js) against the real catalog API.
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path');
let chromium; try { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); } catch (e) { try { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); } catch (e2) {} }
const { boot, signInit, OWNER } = require('./harness'); const SHOTS = process.env.SHOTS || '';
const OWN = { id: String(OWNER), name: 'o', role: 'super_admin', perms: new Set(['*']) };
const student = { id: 424242, first_name: 'Riya' };

function seed(t) {
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
const txt0 = (page, sel) => page.textContent(sel);
const shot = async (page, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, n + '.png') }); } };

test('student lectures flow end-to-end', { skip: !chromium && 'playwright/chromium not installed' }, async () => {
  const t = await boot(); seed(t); t.service.config.set(OWN, { whatsappLink: 'https://whatsapp.com/channel/abc' }); const browser = await chromium.launch();
  try {
    const { page, errors } = await open(browser, t);
    await page.waitForSelector('.lv-pick', { timeout: 15000 }); await shot(page, 's01-level');
    await page.click('[data-lv=level][data-v=foundation]'); await page.waitForSelector('.lv-sub');
    await page.waitForSelector('#lv2-wa'); assert.match(await txt0(page, '#lv2-wa'), /Join Our WhatsApp Channel Urgently/); await shot(page, 's02a-whatsapp'); await page.click('#lv2-wa [data-w=go]'); assert.deepEqual(await page.evaluate(() => window.__opened), ['https://whatsapp.com/channel/abc']); await page.evaluate(() => { window.__opened.length = 0; }); assert.equal(await page.locator('#lv2-wa').count(), 0); await shot(page, 's02-subjects');
    const txt = (sel) => page.textContent(sel);
    assert.equal(await page.locator('.lv-sub').count(), 4);
    assert.match(await page.locator('.lv-sub', { hasText: 'Accounts' }).textContent(), /3 teachers/); // Nitin, Manish, Fast track (free tab)
    assert.match(await page.locator('.lv-sub', { hasText: 'Laws' }).textContent(), /1 teacher\b/); // Nitin only (Manish's Laws batch is premium)
    assert.match(await txt('.lv-hl'), /CA Foundation/);

    // Subject → faculty list with Regular/Fastrack counts
    await page.click('[data-lv=subject][data-v=Accounts]'); await page.waitForSelector('.lv-card'); await shot(page, 's03-faculty');
    assert.match(await txt('.lv-seg.reg'), /Regular \(2\)/); assert.match(await txt('.lv-seg.reg'), /Fastrack \(1\)/);
    const nitin = page.locator('.lv-card', { hasText: 'CA Nitin Goel' }); assert.match(await nitin.textContent(), /2 batches/); assert.match(await nitin.textContent(), /Latest:\s*Sep 2026/);
    const manish = page.locator('.lv-card', { hasText: 'Manish' }); assert.match(await manish.textContent(), /Jan 2027/); assert.match(await manish.textContent(), /JK Shah/); assert.match(await manish.textContent(), /2 chapters/); assert.equal(await manish.locator('.lv-pin').count(), 1);
    await page.click('[data-lv=type][data-v=fastrack]'); await page.waitForSelector('.lv-card'); assert.match(await txt('#lv2'), /Prof Fast Track/); await page.click('[data-lv=type][data-v=regular]');

    // Faculty with several batches → batch list → batch page
    await page.locator('.lv-card', { hasText: 'CA Nitin Goel' }).click(); await page.waitForSelector('.lv-title'); assert.match(await txt('.lv-title'), /2 batches available/); await shot(page, 's04-batches');
    assert.equal(await page.locator('.lv-card').count(), 2); assert.match(await page.locator('.lv-card').first().textContent(), /Sep 2026/); // newest first
    await page.locator('.lv-card').first().click(); await page.waitForSelector('.lv-hero'); assert.match(await txt('.lv-title'), /Accounts › CA Nitin Goel/); assert.match(await txt('.lv-hero'), /PW/);
    assert.equal(await page.locator('.lv-ch').count(), 2); assert.equal(await page.locator('.lv-num').first().textContent(), '01'); assert.equal(await page.locator('.lv-lock').count(), 0); await shot(page, 's05-chapters');
    assert.equal(await page.locator('.lv-b2').count(), 1); // only chapter 1 has notes

    // Lecture picker: single tap delivers via the existing bot deep link
    await page.locator('[data-lv=lectures]').first().click(); await page.waitForSelector('#lv2-ov .t'); assert.equal(await page.locator('#lv2-ov .t').count(), 3); await shot(page, 's06-picker');
    await page.locator('#lv2-ov .t').nth(1).click(); assert.deepEqual(await page.evaluate(() => window.__opened), ['https://t.me/testbot?start=CODEaaaaaaaaaaaaaaaaaaaaaaa1b']);
    // multi-select + send
    await page.click('[data-z=multi]'); await page.locator('#lv2-ov .t').nth(0).click(); await page.locator('#lv2-ov .t').nth(2).click(); assert.match(await txt('#lv2-ov .ft'), /2 selected · 1 remaining/); assert.match(await txt('[data-z=send]'), /Send 2 Lectures to Bot/); await shot(page, 's07-multi');
    await page.click('[data-z=send]'); await page.waitForFunction(() => window.__opened.length === 3, null, { timeout: 8000 });
    assert.deepEqual((await page.evaluate(() => window.__opened)).slice(1), ['https://t.me/testbot?start=CODEaaaaaaaaaaaaaaaaaaaaaaa1a', 'https://t.me/testbot?start=CODEaaaaaaaaaaaaaaaaaaaaaaa1c']);
    // Select All, notes picker, and the chapter whose lectures live in a unit
    await page.locator('[data-lv=lectures]').nth(1).click(); await page.waitForSelector('#lv2-ov .t'); assert.equal(await page.locator('#lv2-ov .t').count(), 1); await page.click('[data-z=all]'); assert.match(await txt('#lv2-ov .ft'), /1 selected/); await page.click('[data-z=cancel]'); await page.click('[data-z=close]');
    await page.locator('[data-lv=notes]').first().click(); await page.waitForSelector('#lv2-ov .t'); assert.equal(await page.locator('#lv2-ov .t').count(), 2); await page.click('[data-z=close]');

    // Pin (favourite) persists using the app's own storage
    await page.click('[data-lv=back]'); await page.waitForSelector('.lv-card'); await page.locator('.lv-pin').first().click(); await page.waitForSelector('.lv-pin.on');
    assert.ok((await page.evaluate(() => localStorage.getItem('favBatches_424242'))).includes('aaaaaaaaaaaaaaaaaaaaaaa'));

    // Locked (no free access): banner, padlocks, no Lectures buttons
    await page.evaluate(() => { window._adsFreeActive = false; accessExpiresAt = null; LV2.refresh(); }); await page.locator('.lv-card').first().click().catch(() => {});
    await page.waitForSelector('.lv-lock'); assert.match(await txt('.lv-lock'), /Activate your free access in the Access tab/); assert.equal(await page.locator('[data-lv=lectures]').count(), 0); assert.ok(await page.locator('.lv-ch .padl').count() >= 1); await shot(page, 's08-locked');
    await page.click('[data-lv=access]'); await page.waitForSelector('#page-access.active');
    await page.evaluate(() => { window._adsFreeActive = true; }); await page.click('#navHome'); await page.waitForSelector('#lv2');

    // Premium tab: premium batch needs buy/unlock; free tab hides it
    await page.evaluate(() => { LV2.state.view = 'home'; LV2.state.tab = 'free'; LV2.refresh(); }); await page.click('[data-lv=tab][data-v=premium]'); await page.waitForSelector('.lv-sub'); await shot(page, 's09-premium');
    assert.equal(await page.locator('.lv-sub').filter({ hasText: /Laws/ }).count(), 1); await page.click('[data-lv=subject][data-v=Laws]'); await page.locator('.lv-card').first().click(); await page.waitForSelector('.lv-lock.prem'); assert.match(await txt('#lv2'), /Buy ₹999/); await shot(page, 's10-premium-batch');

    // Admin archives a batch → disappears for students after reload
    t.service.batch.setStatus(OWN, 'aaaaaaaaaaaaaaaaaaaaaaa1', 'archive'); await page.evaluate(() => { LV2.state.view = 'home'; LV2.state.tab = 'free'; return LV2.reload(); });
    await page.click('[data-lv=subject][data-v=Accounts]'); await page.waitForSelector('.lv-card'); assert.match(await page.locator('.lv-card', { hasText: 'CA Nitin Goel' }).textContent(), /May 2026/); assert.doesNotMatch(await page.locator('.lv-card', { hasText: 'CA Nitin Goel' }).textContent(), /batches/);
    assert.deepEqual(errors, [], 'no console/page errors');
  } finally { await browser.close(); t.close(); }
});
