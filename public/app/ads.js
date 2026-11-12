'use strict';
/**
 * Ads. Two networks, two jobs:
 *  - Monetag (zone from admin settings): ambient in-app ads, an ad every Nth lecture tap, and one after the force-join gate.
 *    Never blocks the student: if the SDK is missing, blocked or fails, the app carries on.
 *  - Adsgram: the rewarded ads on the Access tab (8h each, 3 a day = 24h). Reward is claimed through the server.
 */
(function () {
  let zone = '', on = false, sdk = null, fmt = 0, inApp = false, every = 3;
  const staff = () => !!(window.U && U.me && U.me.staff);
  const sc = (src, attrs) => new Promise((res) => { const s = document.createElement('script'); s.src = src; Object.entries(attrs || {}).forEach(([k, v]) => s.setAttribute(k, v)); s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); });
  const fn = () => (zone && typeof window['show_' + zone] === 'function') ? window['show_' + zone] : null;
  const load = () => sdk || (sdk = sc('https://libtl.com/sdk.js', { 'data-zone': zone, 'data-sdk': 'show_' + zone }));
  const Ads = window.Ads = {
    /** Call once the app config is known. */
    init(cfg) {
      const m = cfg && cfg.monetag; if (!m || !m.on || staff()) return; zone = m.zone; on = true; every = m.every; inApp = !!m.inApp;
      load().then(() => { if (inApp && fn()) { try { fn()({ type: 'inApp', inAppSettings: { frequency: 2, capping: 0.334, interval: 60, timeout: 5, everyPage: false } }); } catch (e) { /* ambient only */ } } });
    },
    /** One full-screen Monetag ad (rewarded interstitial / popup in turn). Always resolves; never throws. */
    async show() {
      if (!on || staff()) return false; await load(); const f = fn(); if (!f) return false;
      try { await Promise.race([fmt++ % 2 ? f('pop') : f(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 45000))]); return true; } catch (e) { return false; }
    },
    /** Every Nth lecture tap shows an ad first (the lecture is sent either way). */
    async lectureTap() {
      if (!on || !every || staff()) return; let n = 0; try { n = parseInt(localStorage.getItem('sm_lt') || '0', 10) + 1; localStorage.setItem('sm_lt', String(n)); } catch (e) { n = Date.now(); }
      if (n % every === 0) await Ads.show();
    },
    /** Adsgram rewarded ad. Resolves { done } — true only when the ad was watched to the end. */
    async adsgram(blockId) {
      if (!window.Adsgram) await sc('https://sad.adsgram.ai/js/sad.min.js');
      if (!window.Adsgram) throw new Error('Ad could not load. Turn off your ad-blocker and try again.');
      try { const c = window.Adsgram.init({ blockId: String(blockId) }); const r = await c.show(); return { done: !!(r && r.done !== false) }; }
      catch (e) { const d = (e && (e.description || e.message)) || 'No ad available right now'; const err = new Error(/no ad|not.?found|no_ads/i.test(d) ? 'No ad available right now. Try again in a minute.' : d); err.skipped = !!(e && e.done === false); throw err; }
    },
  };
})();
