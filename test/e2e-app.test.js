'use strict';
// Real-browser test of the Mini App: flows + visual QA (full-screen, no overflow, no missing icons) on every screen.
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path');
let chromium; try { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); } catch (e) { try { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); } catch (e2) {} }
const { boot, signInit, owner, OWNER, closeAll } = require('./helpers'); test.afterEach(closeAll);
const SHOTS = process.env.SHOTS || ''; const own = { id: String(OWNER), name: 'o', role: 'super_admin', perms: new Set(['*']) };
const student = { id: 424242, first_name: 'Riya', last_name: 'Shah' }; const H = 3600;

function seed(t) {
  const S = t.app.service; const C = t.app.content; t.app.db.user.upsert({ userId: '424242', firstName: 'Riya', lastName: 'Shah', username: 'riya', firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() });
  const F = (n, inst, c) => S.faculty.create(own, { name: n, institute: inst, color: c }).id; const fN = F('CA Nitin Goel', 'PW', '#7c6fe0'), fM = F('CA Manish Mahajan', 'JK Shah', '#2f7cc4'), fS = F('Prof Sagar Waghela', 'JK Shah', '#3f9b5a'), fF = F('Prof Fast Track', '', '#c4466e');
  ['Accounts', 'Laws', 'Economics', 'Quant'].forEach((n) => S.subject.create(own, { name: n, level: 'foundation' }));
  const mkBatch = (name, fid, label, subj, o = {}) => { const b = S.batch.create(own, { name, level: 'foundation', isPublic: true, status: 'active', facultyId: fid, label, institute: o.inst || '', type: o.type || 'regular', startDate: o.start || '2026-05-01' }); subj.forEach((sn) => { const s = C.addSubject(b.id, { name: sn }); ['Basics of Accounts', 'Journal', 'Ledger', 'Trial Balance'].forEach((cn, ci) => { const c = C.addChapter(b.id, s._id, cn); [2 * H + 300, 2 * H + 60, 2 * H + 120, H + 900].slice(0, ci === 2 ? 1 : 4).forEach((d, i) => C.addLecture(b.id, s._id, c._id, { name: `Lecture ${i + 1}`, duration: d, channelMsgId: 8000 + ci * 10 + i })); if (ci < 2) C.addNote(b.id, s._id, c._id, { name: `${cn} notes`, channelMsgId: 8500 + ci, fileType: 'document' }); }); }); return b.id; };
  const ids = { n1: mkBatch('Nitin Sep 2026', fN, 'Sep 2026', ['Accounts', 'Laws'], { inst: 'PW', start: '2026-09-01' }), n2: mkBatch('Nitin May 2026', fN, 'May 2026', ['Accounts'], { inst: 'PW', start: '2026-05-01' }), m1: mkBatch('Manish Jan 2027', fM, 'Jan 2027', ['Accounts', 'Economics'], { inst: 'JK Shah', start: '2027-01-01' }), s1: mkBatch('Sagar Sep 2026', fS, 'Sep 2026', ['Accounts', 'Quant'], { inst: 'JK Shah', start: '2026-09-01' }), f1: mkBatch('Fast', fF, 'Fast 2026', ['Accounts'], { type: 'fastrack' }) };
  const pb = mkBatch('Premium Laws', fM, 'Elite 2026', ['Laws'], { inst: 'JK Shah' }); const d = t.app.db.batch.getOne(pb); d.isPremium = true; d.price = 999; t.app.db.batch.upsert(d); ids.prem = pb;
  S.config.set(own, { supportLink: 'https://t.me/support', whatsappLink: 'https://whatsapp.com/channel/abc', premiumInfo: 'Unlimited lectures\nPriority support', minAdSeconds: 1, dailyLectureLimit: 15 });
  t.app.access.adminServers.save({ name: 'Ad Server #1', url: 'https://ads.example/1?t={token}', hours: 12, perDay: 3 }); t.app.access.adminServers.save({ name: 'Ad Server #3', url: 'https://ads.example/3', hours: 24, perDay: 1, icon: 'target' }); t.app.access.adminServers.save({ name: 'Extra Lectures', url: 'https://ads.example/x', type: 'lectures', extraLectures: 3, perDay: 1 });
  return ids;
}
async function open(browser, t, vp, user = student) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: vp.width < 600, hasTouch: vp.width < 600 }); const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const init = signInit(user);
  await page.addInitScript((d) => { const noop = () => new Proxy(function () {}, { get: (tt, k) => (k === 'then' ? undefined : noop()), apply: () => undefined }); const wa = { initData: d, initDataUnsafe: {}, platform: 'android', version: '8.0', colorScheme: 'dark', themeParams: {}, openLink(u) { window.__opened.push(u); }, openTelegramLink(u) { window.__opened.push(u); }, close() { window.__closed = true; } }; window.__opened = []; window.Telegram = { WebApp: new Proxy(wa, { get: (tt, k) => (k in tt ? tt[k] : noop()) }) }; }, init);
  await page.goto(`http://127.0.0.1:${t.port}/app/`); await page.waitForSelector('.nav'); await page.waitForSelector('.modal [data-w=x]', { timeout: 4000 }).then(() => page.click('.modal [data-w=x]')).catch(() => {}); return { page, errors, ctx };
}
/** Visual QA applied to every screen. */
async function qa(page, label, issues) {
  const r = await page.evaluate(() => { const vw = innerWidth, vh = innerHeight; const app = document.getElementById('app').getBoundingClientRect(); const main = document.getElementById('main'); const bad = []; document.querySelectorAll('#main *, .nav *, .hdr *').forEach((el) => { const b = el.getBoundingClientRect(); if (!b.width || !b.height) return; if (b.right > vw + 1 || b.left < -1) { let p = el.parentElement, clipped = false; while (p && p !== document.body) { const cs = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(cs.overflowX) && p.scrollWidth <= p.clientWidth + 1 && p.getBoundingClientRect().right <= vw + 1) { clipped = true; break; } p = p.parentElement; } if (!clipped) bad.push((el.className && el.className.baseVal === undefined ? el.className : el.tagName) + '|' + el.textContent.trim().slice(0, 24)); } });
    const sq = [...document.querySelectorAll('#main svg.i, .nav svg.i, .hdr svg.i')].filter((s) => s.dataset.missing).map((s) => s.dataset.missing); const ov = [...document.querySelectorAll('#main *')].find((e) => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'visible' && e.clientWidth > 0 && e.children.length === 0 && getComputedStyle(e).display !== 'inline');
    return { vw, vh, appOk: Math.abs(app.width - vw) < 1 && Math.abs(app.height - vh) < 1, docOverflow: document.documentElement.scrollWidth > vw, mainOverflow: main.scrollWidth > main.clientWidth + 1, bad: bad.slice(0, 5), missing: sq, navBottom: Math.round(document.querySelector('.nav').getBoundingClientRect().bottom), textOverflow: ov ? ov.className + '|' + ov.textContent.slice(0, 20) : '' }; });
  if (!r.appOk) issues.push(`${label}: #app does not fill the screen`); if (r.docOverflow) issues.push(`${label}: page scrolls horizontally`); if (r.mainOverflow) issues.push(`${label}: main overflows horizontally`); if (r.bad.length) issues.push(`${label}: elements outside screen: ${r.bad.join(', ')}`); if (r.missing.length) issues.push(`${label}: missing icons ${r.missing.join(',')}`); if (Math.abs(r.navBottom - r.vh) > 1) issues.push(`${label}: nav not at the bottom (${r.navBottom} vs ${r.vh})`);
}
const shot = async (page, n, w) => { if (SHOTS && w === 390) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, n + '.png') }); } };
const settle = (page) => page.waitForTimeout(450);

/** Visit every screen of the app and run the visual QA. */
async function walk(page, t, ids, vp) {
  const issues = []; const Q = async (n) => { await settle(page); await qa(page, `${vp.width}px ${n}`, issues); await shot(page, n, vp.width); };
  await page.waitForSelector('.nav'); await page.waitForSelector('.ac-hero'); await Q('01-access-none');
  // access: active state
  t.app.access.grantHours(String(student.id), 11.99); await page.evaluate(() => Access.refresh()); await page.waitForSelector('.ac-cd'); await Q('02-access-active');
  // lectures
  await page.click('.nav [data-v=lectures]'); await page.waitForSelector('.pickl'); await Q('03-level');
  await page.click('.lvc[data-v=foundation]'); await page.waitForSelector('.sub'); await Q('04-subjects');
  await page.click('[data-l=tab][data-v=premium]'); await settle(page); await Q('05-premium-tab'); await page.click('[data-l=tab][data-v=free]');
  await page.click('[data-l=subject][data-v=Accounts]'); await page.waitForSelector('.fc'); await Q('06-faculty');
  await page.locator('.fc', { hasText: 'CA Nitin Goel' }).click(); await page.waitForSelector('.fc'); await Q('07-batches');
  await page.locator('.fc').first().click(); await page.waitForSelector('.ch'); await Q('08-chapters');
  await page.locator('[data-l=lectures]').first().click(); await page.waitForSelector('#pk .tile'); await settle(page); await Q('09-picker');
  await page.click('#pk [data-z=multi]'); await page.locator('#pk .tile').nth(0).click(); await page.locator('#pk .tile').nth(2).click(); await Q('10-picker-multi'); await page.click('#pk [data-z=close], #pk [data-z=cancel]'); await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => { const o = document.getElementById('pk'); if (o) o.close(); });
  // study
  await page.click('.nav [data-v=study]'); await page.waitForSelector('.ring'); await Q('11-study-timer');
  for (const [tabn, sel, n] of [['rankings', '.lb', '12-rankings'], ['recap', '.rc', '13-recap'], ['groups', '.gr', '14-groups'], ['live', '.empty, .lvg', '15-live'], ['profile', '.dz', '16-profile']]) { await page.click(`.stabs [data-v=${tabn}]`); await page.waitForSelector(sel); await Q(n); }
  await page.click('.stabs [data-v=groups]'); await page.waitForSelector('.gr'); await page.locator('.gr').first().click(); await page.waitForSelector('.gi'); await Q('17-group-info'); await page.click('[data-s=chat]'); await page.waitForSelector('#chatv'); await Q('18-chat'); await page.click('[data-s=cback]'); await page.waitForSelector('.gi');
  // rewards
  await page.click('.nav [data-v=referral]'); await page.waitForSelector('.rf-hero'); await Q('19-referral'); await page.click('.nav [data-v=points]'); await page.waitForSelector('.pt-hero'); await Q('20-points');
  // planner wizard
  await page.click('.nav [data-v=lectures]'); await page.waitForSelector('.sub'); await page.click('[data-l=planner]'); await page.waitForSelector('.pchip, .empty'); await Q('21-plan-step1');
  await page.click('.pchip[data-v=Accounts]'); await page.click('[data-p=mode][data-v=mixed]'); await Q('22-plan-step1b'); await page.click('[data-p=next]'); await page.waitForSelector('.chl'); await page.locator('.chl[data-p=pick]').first().click(); await Q('23-plan-step2');
  await page.click('[data-p=next]'); await page.waitForSelector('.pl-h'); await page.click('.pl-h'); await Q('24-plan-step3'); await page.click('[data-p=next]'); await page.waitForSelector('#pvBox .card'); await Q('25-plan-step4');
  await page.click('#goReview'); await page.waitForSelector('[data-p=gen]'); await Q('26-plan-review'); await page.click('[data-p=gen]'); await page.waitForSelector('.today'); await Q('27-plan-today');
  return issues;
}

test('Mini App: flows work end to end (access, lectures, delivery, study, planner, rewards)', { skip: !chromium && 'playwright/chromium not installed' }, async () => {
  const t = await boot({ realtime: true }); const ids = seed(t); const browser = await chromium.launch(); const { page, errors } = await open(browser, t, { width: 390, height: 844 });
  await page.waitForSelector('.ac-hero'); assert.match(await page.textContent('.ac-hero'), /No Active Access/); assert.equal(await page.locator('.srv').count(), 3);
  // watch an ad → claim → access active
  await page.click('[data-w]:not([disabled]) >> nth=0'); await page.waitForSelector('[data-t=ok]', { timeout: 3000 }).then(() => page.click('[data-t=ok]')).catch(() => {}); await page.waitForSelector('#adClaim'); assert.ok((await page.evaluate(() => window.__opened[0])).startsWith('https://ads.example/1?t=')); await page.waitForFunction(() => !document.getElementById('adClaim').disabled, null, { timeout: 5000 }); await page.click('#adClaim'); await page.waitForSelector('.ac-cd'); assert.match(await page.textContent('#cdH'), /11|12/); assert.match(await page.textContent('.use'), /15\s*\/15/); assert.equal(await page.locator('.dots i.u').count(), 1);
  // lectures flow + delivery through the API (checks the fake Telegram saw real copyMessage calls)
  await page.click('.nav [data-v=lectures]'); await page.click('.lvc[data-v=foundation]'); await page.waitForSelector('.sub'); assert.match(await page.locator('.sub', { hasText: 'Accounts' }).textContent(), /4 teachers/); await page.click('[data-l=subject][data-v=Accounts]'); await page.waitForSelector('.fc');
  assert.match(await page.textContent('.seg.soft'), /Regular \(3\)/); assert.match(await page.textContent('.seg.soft'), /Fastrack \(1\)/); const nit = page.locator('.fc', { hasText: 'CA Nitin Goel' }); assert.match(await nit.textContent(), /2 batches/); assert.match(await nit.textContent(), /Latest:\s*Sep 2026/); const man = page.locator('.fc', { hasText: 'Manish' }); assert.match(await man.textContent(), /4 chapters/); assert.match(await man.textContent(), /\d+h \d+m/);
  await nit.click(); await page.locator('.fc').first().click(); await page.waitForSelector('.ch'); assert.match(await page.textContent('.trow'), /Accounts › CA Nitin Goel/); assert.equal(await page.locator('.lock').count(), 0); assert.match(await page.textContent('.ch'), /4 lectures · 7h/);
  t.tg.clear(); await page.locator('[data-l=lectures]').first().click(); await page.waitForSelector('#pk .tile'); assert.match(await page.textContent('#pk'), /15 available quota/); assert.match(await page.locator('#pk .tile').first().textContent(), /2h 5m/); await page.click('#pk [data-z=multi]'); await page.locator('#pk .tile').nth(0).click(); await page.locator('#pk .tile').nth(1).click(); assert.match(await page.textContent('#pk [data-z=send]'), /Send 2 Lectures to Bot/);
  await page.click('#pk [data-z=send]'); await page.waitForSelector('.toast .tact'); assert.match(await page.textContent('.toast'), /2 lectures sent to bot/); assert.equal(t.tg.of('copyMessage').length, 2); assert.equal(String(t.tg.of('copyMessage')[0].chat_id), String(student.id)); await page.click('.toast .tact'); assert.notEqual(await page.evaluate(() => window.__closed), true); // the Mini App stays open (it sits in Telegram's recents)
  assert.equal(t.app.access.quota(String(student.id)).left, 13);
  // notes
  await page.locator('[data-l=notes]').first().click(); await page.waitForSelector('.nt-c'); assert.match(await page.textContent('.nt-hero'), /file/); t.tg.clear(); await page.locator('.nt-c').first().click(); await page.waitForSelector('.toast'); assert.match(await page.textContent('.toast'), /1 note sent to bot/); assert.equal(t.tg.of('copyMessage').length, 1); await page.click('[data-l=ntall]'); assert.match(await page.textContent('.nt-send'), /Send \d+ Note/); await page.click('[data-l=ntmulti]'); await page.click('[data-l=back]');
  // pin
  await page.click('[data-l=back]'); await page.click('[data-l=back]'); await page.waitForSelector('.fc'); await page.locator('.pin').first().click(); await page.waitForSelector('.pin.on');
  // premium batch is locked with an unlock call-to-action
  await page.click('[data-l=back]'); await page.click('[data-l=tab][data-v=premium]'); await page.click('[data-l=subject][data-v=Laws]'); await page.locator('.fc').first().click(); await page.waitForSelector('.lock.prem'); assert.match(await page.textContent('.acts'), /Unlock · ₹999/); await page.click('.acts [data-l=benefits]'); await page.waitForSelector('.sheet'); assert.match(await page.textContent('.sheet'), /Unlimited lectures/); await page.click('.sheet [data-m=x]');
  // study timer ticks and the server counts it
  await page.click('.nav [data-v=study]'); await page.waitForSelector('.ssub'); await page.click('.play[data-v=Accounts]'); await page.waitForSelector('.ring.run'); await page.waitForTimeout(2300); assert.match(await page.textContent('#clk'), /^00:0[2-9]/); await page.click('.play[data-v=Accounts]'); await page.waitForFunction(() => !document.querySelector('.ring.run')); assert.ok(t.app.db.q("SELECT seconds FROM study_day WHERE userId='424242'").get().seconds >= 2);
  // theme toggle persists and flips tokens
  const bg1 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor); await page.click('[data-m=theme]'); assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), bg1); assert.equal(await page.evaluate(() => localStorage.getItem('sm_theme')), 'light');
  assert.deepEqual(errors, [], 'no console errors'); await browser.close();
});

test('Mini App: visual QA on every screen at 320/360/390/430 px and desktop (full-screen, no overflow, no missing icons)', { skip: !chromium && 'playwright/chromium not installed' }, async () => {
  const browser = await chromium.launch(); const all = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 640 }, { width: 360, height: 740 }, { width: 430, height: 932 }, { width: 1280, height: 800 }]) {
    const t = await boot({ realtime: true }); const ids = seed(t); const { page, errors } = await open(browser, t, vp); try { all.push(...await walk(page, t, ids, vp)); if (errors.length) all.push(`${vp.width}px console errors: ${errors.join(' | ')}`); } catch (e) { all.push(`${vp.width}px walk failed: ${e.message.split('\n')[0]}`); } await page.context().close(); await t.close();
  }
  await browser.close(); assert.deepEqual(all, []);
});

test('Mini App: Test Series asks for a subject first, then opens that subject’s link', { skip: !chromium && 'playwright/chromium not installed' }, async () => {
  const t = await boot({ realtime: true }); seed(t); t.app.service.config.set(own, { testSeriesItems: [{ level: 'foundation', subject: 'Accounts', title: 'Full tests', url: 'https://t.example/acc' }, { level: 'intermediate', subject: 'Costing', url: 'https://t.example/cost' }, { subject: 'Laws', url: 'https://t.example/laws' }] });
  const browser = await chromium.launch(); const { page, errors } = await open(browser, t, { width: 390, height: 844 });
  t.app.access.grantHours(String(student.id), 5); await page.reload(); await page.waitForSelector('.nav');
  await page.click('.nav [data-v=lectures]'); await page.click('.lvc[data-v=foundation]').catch(() => {}); await page.waitForSelector('[data-l=tests]'); await page.click('[data-l=tests]'); await page.waitForSelector('[data-l=ttest]');
  assert.equal(await page.locator('[data-l=ttest]').count(), 2); assert.match(await page.textContent('#main'), /Accounts/); assert.doesNotMatch(await page.textContent('#main'), /Costing/);
  await page.locator('[data-l=ttest]', { hasText: 'Accounts' }).click(); assert.equal(await page.evaluate(() => window.__opened.pop()), 'https://t.example/acc'); assert.deepEqual(errors, []); await browser.close();
});

test('Mini App never stays blank: a slow /access still lets the first screen draw, then moves to Access if the student has none', { skip: !chromium && 'playwright/chromium not installed' }, async () => {
  const t = await boot({ realtime: true }); seed(t); const browser = await chromium.launch(); const { page, errors } = await open(browser, t, { width: 390, height: 844 });
  await page.route('**/api/app/access', async (route) => { await new Promise((r) => setTimeout(r, 4000)); route.continue(); });
  await page.evaluate(() => sessionStorage.clear()); await page.reload(); await page.waitForSelector('.nav');
  await page.waitForFunction(() => document.querySelector('#main') && document.querySelector('#main').textContent.trim().length > 10, null, { timeout: 3500 }); // drawn long before the 4 s /access answers
  await page.waitForFunction(() => document.querySelector('.nav button.on') && document.querySelector('.nav button.on').dataset.v === 'access', null, { timeout: 8000 }); // then switched to Access (no access yet)
  assert.deepEqual(errors, []); await browser.close();
});
