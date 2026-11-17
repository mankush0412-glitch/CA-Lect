'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
let chromium; try { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); } catch (e) { try { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); } catch (e2) {} }
const { boot, signInit, owner, OWNER, closeAll } = require('./helpers'); test.afterEach(closeAll);
const own = { id: String(OWNER), name: 'o', role: 'super_admin', perms: new Set(['*']) };
test('admin subject sheet: Regular / Fastrack toggle, teacher → attempt grouping, typed add', { skip: !chromium && 'playwright/chromium not installed' }, async () => {
  const t = await boot({ realtime: true }); const S = t.app.service; t.add('Seed', 'foundation', ['Accounts']);
  const f1 = S.faculty.create(own, { name: 'Prof Karan', institute: 'JK' }).id; S.subject.create(own, { name: 'Accounts', level: 'foundation' });
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort()); await page.addInitScript((d) => { window.Telegram = { WebApp: { initData: d, ready() {}, expand() {} } }; }, signInit(owner));
  await page.goto(`http://127.0.0.1:${t.port}/admin/`); await page.waitForSelector('.big .n');
  await page.click('.nav button[data-id=more]'); await page.click('[data-id=subjects]'); await page.waitForTimeout(500); await page.waitForSelector('[data-a=subject]', ); await page.locator('[data-a=subject]', { hasText: 'Accounts' }).first().click(); await page.waitForSelector('#sty button');
  assert.match(await page.textContent('#sty'), /Regular \(1\)[\s\S]*Fastrack \(0\)/); await page.click('#sty [data-v=fastrack]'); assert.match(await page.textContent('#att-list'), /No Fastrack teachers yet/);
  await page.click('[data-z=addt]'); await page.waitForSelector('#f_facultyId'); assert.match(await page.textContent('body'), /Add teacher · ⚡ Fastrack/); assert.equal(await page.locator('#f_type').count(), 0);
  await page.selectOption('#f_facultyId', f1); await page.fill('#f_label', 'May 2027'); await page.click('[data-x=s]'); await page.waitForTimeout(1000);
  const bs = S.batch.list(own, { size: 50 }).items.filter((b) => b.type === 'fastrack'); assert.equal(bs.length, 1); assert.equal(bs[0].label, 'May 2027'); assert.equal(bs[0].facultyName, 'Prof Karan'); assert.deepEqual(errors, []);
  await browser.close();
});
