'use strict';
// Browser end-to-end test of public/admin.html against the real backend (needs Playwright + Chromium; skipped otherwise).
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path');
let chromium; try { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); } catch (e) { try { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); } catch (e2) {} }
const { boot, signInit, OWNER } = require('./harness');
const SHOTS = process.env.SHOTS || '';
const owner = { id: OWNER, first_name: 'Owner', last_name: 'Admin' };

async function open(browser, t, user, vp = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const init = user ? signInit(user) : '';
  await page.addInitScript((d) => { window.Telegram = { WebApp: { initData: d, ready() {}, expand() {} } }; }, init);
  await page.goto(`http://127.0.0.1:${t.port}/admin.html`); return { page, errors, ctx };
}
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
const seed = (t) => {
  for (let i = 1; i <= 6; i++) t.dbs.userDb.upsert({ userId: String(7000 + i), firstName: ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Isha'][i - 1], lastName: 'Sharma', username: 'stu' + i, firstSeen: new Date(Date.now() - (i % 4) * 864e5).toISOString(), lastSeen: new Date().toISOString() });
  const mk = (id, name, subs) => t.dbs.batchDb.upsert({ _id: id, name, isPublic: true, isPremium: false, premiumUsers: [], subjects: subs.map((s, i) => ({ _id: id + 's' + i, name: s, icon: '📘', color: '#7c6fe0', chapters: [{ _id: id + 'c' + i, name: 'Basics', lectures: [{ _id: id + 'l' + i, name: 'L1', link: 'x' }], units: [] }] })) });
  mk('aaaaaaaaaaaaaaaaaaaaaaa1', 'CA Nitin Goel · May 2026', ['Accounts', 'Laws']); mk('aaaaaaaaaaaaaaaaaaaaaaa2', 'CA Manish Mahajan · Jan 2027', ['Accounts']);
};

test('admin panel UI end-to-end', { skip: !chromium && 'playwright/chromium not installed' }, async () => {
  const t = await boot(); seed(t); const browser = await chromium.launch();
  try {
    // 1) Not inside Telegram → gate; unauthorised user → gate
    let { page, errors } = await open(browser, t, null); assert.match(await page.textContent('body'), /Open from Telegram/);
    ({ page } = await open(browser, t, { id: 4242, first_name: 'Nobody' })); await page.waitForSelector('.gate'); assert.match(await page.textContent('body'), /Not authorised/);

    // 2) Owner: dashboard shows DB numbers
    ({ page, errors } = await open(browser, t, owner)); await page.waitForSelector('.big .n');
    assert.equal(await page.textContent('.big .n'), '6'); await shot(page, '01-dashboard');
    assert.match(await page.textContent('.stats'), /2\s*Total batches/);

    // 3) Create faculty through the UI
    await page.click('.nav button[data-id=faculties]'); await page.waitForSelector('.fab'); await shot(page, '02-faculty-empty');
    await page.click('.fab'); await page.fill('#f_name', 'CA Nitin Goel'); await page.fill('#f_institute', 'PW'); await page.fill('#f_bio', 'Accounts specialist'); await page.click('[data-x=s]');
    await page.waitForSelector('.rowc .nm'); assert.equal(await page.textContent('.rowc .nm'), 'CA Nitin Goel'); assert.match(await page.textContent('.rowc'), /0 batches/);
    // duplicate is rejected with a visible error
    await page.click('.fab'); await page.fill('#f_name', 'ca nitin goel'); await page.click('[data-x=s]'); await page.waitForSelector('.toast.err'); assert.match(await page.textContent('.toast'), /already exists/); await page.click('[data-x=c]');

    // 4) Batch: assign faculty via edit form, then see it on the list + detail
    await page.click('.nav button[data-id=batches]'); await page.waitForSelector('.rowc'); assert.equal(await page.locator('.rowc').count(), 2);
    await page.locator('.rowc', { hasText: 'Nitin Goel' }).click(); await page.waitForSelector('.hero');
    await page.click('[data-a=b-edit]'); await page.selectOption('#f_facultyId', { label: 'CA Nitin Goel' }); await page.selectOption('#f_level', 'foundation'); await page.fill('#f_label', 'May 2026'); await page.fill('#f_institute', 'PW'); await page.selectOption('#f_status', 'active'); await page.click('[data-x=s]');
    await page.waitForFunction(() => document.body.textContent.includes('Primary faculty')); await shot(page, '03-batch-detail');
    // subject-wise assignment
    await page.click('[data-a=b-assign]'); await page.waitForSelector('#f_subjectName'); await page.click('[data-x=c]');
    // 5) Add students (bulk, with one bad id) and check counts
    await page.click('[data-a=b-addstu]'); await page.fill('#f_ids', '7001, 7002 99999'); await page.click('[data-x=s]'); await page.waitForSelector('.toast');
    await page.waitForFunction(() => /Students · 2/.test(document.body.textContent)); assert.equal(t.dbs.batchDb.getOne('aaaaaaaaaaaaaaaaaaaaaaa1').premiumUsers.length, 2);
    // 6) Student detail → block → blocked banner
    await page.click('[data-a=student][data-id="7001"]'); await page.waitForSelector('[data-a=s-block]'); await shot(page, '04-student');
    await page.click('[data-a=s-block]'); await page.fill('#f_reason', 'spam'); await page.click('[data-x=s]'); await page.waitForSelector('.lock'); assert.match(await page.textContent('.lock'), /Blocked.*spam/);
    // 7) Batches list reflects faculty/label
    await page.click('.nav button[data-id=batches]'); await page.waitForSelector('.rowc'); assert.match(await page.textContent('body'), /May 2026/); await shot(page, '05-batches');
    // 8) Subjects + resources + announcements + more
    await page.click('.nav button[data-id=more]'); await shot(page, '06-more'); await page.click('[data-id=subjects]'); await page.waitForSelector('.fab');
    await page.click('.fab'); await page.fill('#f_name', 'Accounts'); await page.click('[data-x=s]'); await page.waitForSelector('.sub'); await shot(page, '07-subjects');
    await page.click('.nav button[data-id=more]'); await page.click('[data-id=resources]'); await page.waitForSelector('.fab'); await page.click('.fab');
    await page.fill('#f_title', 'Journal notes'); await page.fill('#f_url', 'https://example.com/j.pdf'); await page.check('#f_batchIds input >> nth=0'); await page.click('[data-x=s]'); await page.waitForSelector('.rowc'); assert.match(await page.textContent('.rowc'), /pdf/);
    await page.click('.nav button[data-id=more]'); await page.click('[data-id=notifications]'); await page.waitForSelector('.fab'); await page.click('.fab');
    await page.fill('#f_title', 'Exam update'); await page.fill('#f_body', 'Classes resume Monday'); await page.click('[data-x=s]'); await page.waitForSelector('.rowc'); await page.click('.rowc'); await page.waitForSelector('[data-z=send]'); await shot(page, '08-announce');
    await page.click('[data-z=send]'); await page.click('[data-r="1"]'); await page.waitForFunction(() => true); await page.waitForTimeout(400);
    assert.equal(t.sent.length, 5); // 6 students minus 1 blocked
    // 9) Logs record the actions; analytics + backup open
    await page.click('.nav button[data-id=more]'); await page.click('[data-id=logs]'); await page.waitForSelector('.lg'); assert.match(await page.textContent('#list'), /faculty\.create/); await shot(page, '09-logs');
    await page.click('.nav button[data-id=more]'); await page.click('[data-id=analytics]'); await page.waitForSelector('.bars'); await shot(page, '10-analytics');
    assert.deepEqual(errors, [], 'no console/page errors');

    // 10) Faculty-role user: limited nav & server-side scope
    const fid = t.store.list('faculty')[0].id; await t.call(owner, 'POST', '/api/admin/admins', { userId: '900001', role: 'faculty', facultyId: fid });
    const fpage = (await open(browser, t, { id: 900001, first_name: 'Nitin' })).page; await fpage.waitForSelector('.big .n');
    await fpage.click('.nav button[data-id=batches]'); await fpage.waitForSelector('.rowc'); assert.equal(await fpage.locator('.rowc').count(), 1); assert.equal(await fpage.locator('.fab').count(), 0);
    await fpage.click('.nav button[data-id=more]'); const more = await fpage.textContent('.more'); assert.ok(!/Admin & staff|Backup|Bot config/.test(more)); await shot(fpage, '11-faculty-role');
    // 11) XSS: hostile names are rendered as text
    t.dbs.userDb.upsert({ userId: '7777', firstName: '<img src=x onerror=window.__x=1>', lastName: '', username: '', firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() });
    await page.click('.nav button[data-id=students]'); await page.waitForSelector('.rowc'); assert.equal(await page.evaluate(() => window.__x), undefined); assert.match(await page.textContent('#list'), /<img src=x/);
  } finally { await browser.close(); t.close(); }
});

test('admin panel desktop width stays centred (responsive)', { skip: !chromium && 'playwright/chromium not installed' }, async () => {
  const t = await boot(); seed(t); const browser = await chromium.launch();
  try { const { page } = await open(browser, t, owner, { width: 1280, height: 800 }); await page.waitForSelector('.big .n'); const w = await page.evaluate(() => document.getElementById('app').getBoundingClientRect().width); assert.ok(w <= 640); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); } finally { await browser.close(); t.close(); }
});

test('admin study tracker UI: live timing, overview, groups moderation', { skip: !chromium && 'playwright/chromium not installed' }, async () => {
  const t = await boot(); seed(t); const browser = await chromium.launch();
  try {
    const stuId = '7001'; t.study.start(stuId, 'FM', 'intermediate'); t.study.beat(stuId, 'intermediate');
    t.sqlite.prepare('INSERT INTO study_day(userId,day,subject,seconds) VALUES(?,?,?,?)').run('7002', t.study._t.dayOf(Date.now()), 'Costing', 5400);
    const gid = t.study.groups.create(stuId, { name: 'Study Club', isPublic: true }).id; t.study.groups.post(stuId, gid, { text: 'spam spam' });
    const { page, errors } = await open(browser, t, owner);
    await page.waitForSelector('.big .n'); assert.match(await page.textContent('#main'), /1 studying now/); await shot(page, 'a-dashboard-live');
    await page.click('.nav button[data-id=more]'); await page.click('[data-id=study]'); await page.waitForSelector('.rowc.green'); assert.match(await page.textContent('.big'), /STUDYING RIGHT NOW/); assert.match(await page.textContent('.rowc.green'), /FM/); await shot(page, 'a-study-live');
    await page.click('[data-a=seg][data-v=today]'); await page.waitForSelector('.bars'); assert.match(await page.textContent('#main'), /1h 30m/); await shot(page, 'a-study-overview');
    await page.click('[data-a=seg][data-v=groups]'); await page.waitForSelector('.rowc'); await page.locator('.rowc', { hasText: 'Study Club' }).click(); await page.waitForSelector('[data-z=delmsg]'); await shot(page, 'a-study-group');
    await page.click('[data-z=delmsg]'); await page.click('[data-r="1"]'); await page.waitForFunction(() => !document.querySelector('[data-z=delmsg]')); assert.equal(t.sqlite.prepare('SELECT COUNT(*) c FROM study_msg').get().c, 0);
    assert.deepEqual(errors, []);
    // student detail shows study activity; support role cannot see moderation buttons and the server rejects it anyway
    await t.call(owner, 'POST', '/api/admin/admins', { userId: '900002', role: 'support' }); const sp = (await open(browser, t, { id: 900002, first_name: 'Sup' })).page; await sp.waitForSelector('.big .n');
    await sp.evaluate(() => go('student', { id: '7002' })); await sp.waitForSelector('text=Study activity'); assert.equal(await sp.locator('[data-a=s-studyreset]').count(), 0);
  } finally { await browser.close(); t.close(); }
});
