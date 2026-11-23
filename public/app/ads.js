'use strict';
/**
 * Ads. Two networks, two jobs:
 *  - Monetag (zone from admin settings): ambient in-app ads, an ad every Nth lecture tap, and one after the force-join gate.
 *    Never blocks the student: if the SDK is missing, blocked or fails, the app carries on.
 *  - Adsgram: the rewarded ads on the Access tab (8h each, 3 a day = 24h). Reward is claimed through the server.
 */
(function () {
  let zone = '', on = false, sdk = null, fmt = 0, inApp = false, every = 3;
  const staff = () => !!(window.U && U.me && U.me.staff) || !!(window.U && U.me && U.me.adFree && U.me.adFree.active); /* Ads-Free members count like staff: no Monetag anywhere */
  const sc = (src, attrs) => new Promise((res) => { const s = document.createElement('script'); s.src = src; Object.entries(attrs || {}).forEach(([k, v]) => s.setAttribute(k, v)); s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); });
  const fn = () => (zone && typeof window['show_' + zone] === 'function') ? window['show_' + zone] : null;
  const load = () => sdk || (sdk = sc('https://libtl.com/sdk.js', { 'data-zone': zone, 'data-sdk': 'show_' + zone }));
  /** Ad-blocker wall (admin switch "Ad-blocker wall"). Never for staff, Ads-Free members or when Monetag is off. */
  const probe = () => new Promise((res) => { let done = false; const s = document.createElement('script'); const fin = (ok) => { if (done) return; done = true; s.remove(); res(ok); }; s.src = 'https://libtl.com/sdk.js?_probe=' + Date.now(); s.onload = () => fin(true); s.onerror = () => fin(false); document.head.appendChild(s); setTimeout(() => fin(false), 5000); });
  const exempt = () => staff() || !!(window.U && U.me && U.me.adFree && U.me.adFree.active) || !(window.U && U.me && U.me.config && U.me.config.blockGate);
  const wall = () => document.getElementById('adBlockGate');
  function showWall() {
    if (wall()) return; const pl = (U.me && U.me.config && U.me.config.adFreePlans) || []; const el = document.createElement('div'); el.id = 'adBlockGate';
    el.style.cssText = 'position:fixed;inset:0;z-index:250;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center';
    el.innerHTML = `<div style="font-size:54px">🛡️</div><h2 style="margin:10px 0 6px">Ad Blocker Detected</h2><p style="color:var(--mu);max-width:320px;margin:0 0 16px;font-size:13px;line-height:1.5">This app is supported by ads. Please disable your ad blocker or ad-blocking DNS (like AdGuard DNS / NextDNS) for this site, then retry.</p><button class="btn" id="abRetry">🔄 I've Disabled It — Retry</button><p style="color:var(--mu);max-width:300px;margin:14px 0 0;font-size:11px;line-height:1.5">⚠️ Still not working after disabling it? Fully close Telegram (not just this window) and reopen it — sometimes Telegram needs a fresh restart to pick up the change.</p>${pl.length ? '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line);width:100%;max-width:280px"><div style="font-size:11px;color:var(--mu);margin-bottom:10px">Ya phir, ad-blocker ki tension hi khatam karo</div><button class="btn" id="abPromo" style="background:linear-gradient(135deg,#8b5cf6,#6d28d9)">✨ Remove Ads — Plans dekho</button></div>' : ''}`;
    document.body.appendChild(el); el.querySelector('#abRetry').onclick = () => location.reload(); const pb = el.querySelector('#abPromo'); if (pb) pb.onclick = () => { if (window.Access) Access.promo(() => {}); };
  }
  /** Checks now (and every 45 s) whether the ad SDK can be reached; shows the wall while it cannot. */
  function gate(first) {
    if (exempt()) { const w = wall(); if (w) w.remove(); return; }
    probe().then((ok) => { if (!ok && !exempt()) showWall(); else { const w = wall(); if (w) w.remove(); } });
    if (first && !gate.t) gate.t = setInterval(() => gate(false), 45000);
  }
  const Ads = window.Ads = {
    /** Called after a purchase: lifts the wall straight away. */
    unblock() { const w = wall(); if (w) w.remove(); on = false; clearInterval(gate.t); try { const x = document.querySelectorAll('iframe[src*="libtl"],iframe[src*="monetag"]'); x.forEach((n) => n.remove()); } catch (e) { /* ignore */ } },
    /** Call once the app config is known. */
    init(cfg) {
      const m = cfg && cfg.monetag; if (!m || !m.on || staff()) return; zone = m.zone; on = true; every = m.every; inApp = !!m.inApp;
      if (cfg.blockGate && !(U.me && U.me.adFree)) gate(true);
      load().then(() => { if (inApp && fn()) { try { fn()({ type: 'inApp', inAppSettings: { frequency: 2, capping: 0.334, interval: 60, timeout: 5, everyPage: false } }); } catch (e) { /* ambient only */ } } });
    },
    /** One full-screen Monetag ad (rewarded interstitial / popup in turn). Always resolves; never throws. */
    async show() {
      if (!on || staff()) return false; await load(); const f = fn(); if (!f) return false;
      try { await Promise.race([fmt++ % 2 ? f('pop') : f(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))]); return true; } catch (e) { return false; }
    },
    /** Every Nth lecture tap shows an ad first (the lecture is sent either way). */
    async lectureTap() {
      if (!on || !every || staff()) return; let n = 0; try { n = parseInt(localStorage.getItem('sm_lt') || '0', 10) + 1; localStorage.setItem('sm_lt', String(n)); } catch (e) { n = Date.now(); }
      if (n % every === 0) await Ads.show();
    },
    /** Backup rewarded ad. 'done' = watched, 'skipped' = closed early (no reward), 'error' = could not show (caller may fall back). */
    async monetagReward(n = 1) {
      if (!on || staff()) return 'error'; await load(); if (!fn()) return 'error'; n = Math.max(1, Math.min(5, n | 0 || 1)); let shown = 0;
      for (let i = 0; i < n; i++) { const m = await Ads.monetagOne(); if (m === 'skipped') return 'skipped'; if (m === 'error') break; shown++; if (i < n - 1) { if (window.U && U.toast) U.toast(`Ad ${i + 1} of ${n} done — next one…`, 'ok'); await new Promise((x) => setTimeout(x, 700)); } }
      return shown ? 'done' : 'error'; // one failing ad never costs the student the access
    },
    async monetagOne() {
      const f = fn(); if (!f) return 'error'; const t0 = Date.now();
      try { await Promise.race([f(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))]); return 'done'; }
      catch (e) { const d = String((e && (e.message || e.description)) || e || ''); return Date.now() - t0 < 3000 || /no.?ad|error|fail|not.?found|timeout|block/i.test(d) ? 'error' : 'skipped'; }
    },
    /** Adsgram rewarded ad. Resolves { done } — true only when the ad was watched to the end. */
    async adsgram(blockId) {
      if (!window.Adsgram) await sc('https://sad.adsgram.ai/js/sad.min.js');
      if (!window.Adsgram) throw new Error('Ad could not load. Turn off your ad-blocker and try again.');
      /* Adsgram pops up its own native alert for set-up problems ("Block … is not active"). Students must never see it — the caller falls back to Monetag. */
      const W = window.Telegram && window.Telegram.WebApp, undo = []; const quiet = (obj, name) => { if (obj && typeof obj[name] === 'function') { const o = obj[name]; obj[name] = function (m, cb) { if (/adsgram/i.test(typeof m === 'object' ? JSON.stringify(m) : String(m))) { if (typeof cb === 'function') { try { cb(); } catch (e) { /* ignore */ } } return; } return o.apply(obj, arguments); }; undo.push(() => { obj[name] = o; }); } };
      quiet(W, 'showAlert'); quiet(W, 'showPopup'); quiet(window, 'alert');
      try { const c = window.Adsgram.init({ blockId: String(blockId), debug: false }); const r = await c.show(); return { done: !!(r && r.done !== false) }; }
      catch (e) { const d = (e && (e.description || e.message)) || 'No ad available right now'; const err = new Error(/no ad|not.?found|no_ads/i.test(d) ? 'No ad available right now. Try again in a minute.' : d); const st = String((e && e.state) || ''); err.skipped = !!(e && e.done === false && (st === 'playing' || st === 'destroy' || /skip|user|clos|cancel/i.test(d)) && !/no.?ad|not.?found|moderat|error/i.test(d)); throw err; }
      finally { setTimeout(() => undo.forEach((u) => u()), 1500); }
    },
  };
})();
