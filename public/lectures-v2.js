/* Lectures v2 — reference-style student flow:
 * Level → Free/Premium → Subjects → Faculty (Regular/Fastrack) → Batches → Chapters → Lecture picker.
 * Data: /api/catalog (faculty/batch metadata managed in the admin panel) + the app's existing `batches`
 * (chapters/lectures). Reuses existing access, purchase, unlock, favourites and lecture delivery functions. */
(function () {
  'use strict';
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var LS = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var LEVEL_LABEL = { foundation: 'CA Foundation', intermediate: 'CA Intermediate' };
  var LEVEL_BLURB = { foundation: 'Accounts, Laws, Economics & Quant', intermediate: 'Group I & Group II subjects' };
  var ICONS = { accounts: 'book-2', 'adv. accounts': 'book-2', laws: 'scale', law: 'scale', 'corp. laws': 'scale', economics: 'trending-up', quant: 'calculator', costing: 'calculator', auditing: 'book', fm: 'trending-up', sm: 'calculator', taxation: 'receipt-tax', gst: 'receipt-tax', 'income tax': 'receipt-tax' };
  var st = { level: LS.get('lv2_level'), tab: 'free', view: 'home', subj: null, fac: null, bid: null, type: 'regular', cat: null, err: null, loading: false, sheet: null };
  var root = null;
  var isLight = function () { return document.body.classList.contains('light-mode'); };
  var getTg = function () { return window.Telegram && window.Telegram.WebApp; };
  var fn = function (n) { return typeof window[n] === 'function' ? window[n] : null; };
  var tiIcon = function (name, fb) { var k = String(name || '').toLowerCase(); return '<i class="ti ti-' + (ICONS[k] || fb || 'book') + '"></i>'; };
  var pl = function (n, w, p) { return n + ' ' + (n === 1 ? w : (p || w + 's')); };

  var CSS = '#lv2{padding:2px 0 20px;font-family:"DM Sans",system-ui,sans-serif}' +
    'body.lv2-on #page-home>.topbar,body.lv2-on #page-home .search-wrap,body.lv2-on #batchSection,body.lv2-on #lockedMsg,body.lv2-on #accessBanner{display:none!important}' +
    '#lv2{--p:#7c7be6;--card:#16172b;--card2:#1b1c33;--line:#26284a;--line2:#303360;--tx:#ecebf8;--mu:#8a8bb0;--dm:#5d5f86;--g:#2fb67f;--a:#f0a030;--r:#e5484d;--rose:#a8385c;color:var(--tx)}' +
    'body.light-mode #lv2{--card:#fff;--card2:#f4f5fc;--line:#dfe1f2;--line2:#c9ccea;--tx:#191a33;--mu:#65678f;--dm:#9a9cc0}' +
    '.lv-head{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);margin:0 -16px 14px;background:var(--card2)}' +
    '.lv-av{width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#4b3fa8,#3a3485);display:grid;place-items:center;color:#fff;font-weight:700}' +
    '.lv-head .lv-hl{flex:1;color:var(--mu);font-size:15px}.lv-hb{display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:0;color:var(--mu);font-size:11px;cursor:pointer}' +
    '.lv-hb .ic{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:18px;background:var(--r)}.lv-hb .tg{width:56px;height:34px;border-radius:999px;background:linear-gradient(135deg,#7c7be6,#6a6ee8);position:relative}' +
    '.lv-hb .tg:after{content:"🌙";position:absolute;top:3px;right:3px;width:28px;height:28px;border-radius:50%;background:#fff;display:grid;place-items:center;font-size:15px}body.light-mode .lv-hb .tg:after{content:"☀️";right:auto;left:3px}' +
    '.lv-seg{display:flex;gap:4px;padding:5px;border:1px solid var(--line);border-radius:18px;background:var(--card2);margin-bottom:14px}' +
    '.lv-seg button{flex:1;border:0;background:none;color:var(--mu);padding:13px 8px;border-radius:14px;cursor:pointer;font:600 15px/1 inherit;display:flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap}' +
    '.lv-seg button.on{color:#fff;background:linear-gradient(135deg,#5f6df0,#8a7fe6);box-shadow:0 6px 18px rgba(106,110,232,.4)}.lv-seg.prem button.on{background:linear-gradient(135deg,#f6b445,#e0861d);box-shadow:0 6px 18px rgba(224,134,29,.35)}' +
    '.lv-seg.blue button.on{background:linear-gradient(135deg,#1f6fbf,#2f86d6);box-shadow:0 6px 18px rgba(47,124,196,.4)}.lv-seg.reg button.on{background:linear-gradient(135deg,#6f66dc,#8a7fe6)}' +
    '.lv-title{display:flex;align-items:center;gap:14px;margin:4px 0 16px}.lv-sq{width:52px;height:52px;border-radius:16px;border:1px solid var(--line);background:var(--card2);display:grid;place-items:center;font-size:22px;color:var(--tx);cursor:pointer;flex-shrink:0}' +
    '.lv-title h2{margin:0;font-size:22px;font-weight:700}.lv-title p{margin:2px 0 0;color:var(--mu);font-size:15px}' +
    '.lv-lab{display:flex;align-items:center;gap:8px;color:var(--mu);font-size:13px;letter-spacing:1.4px;font-weight:600;margin:6px 2px 12px}' +
    '.lv-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}' +
    '.lv-sub{position:relative;border:1px solid var(--line);border-radius:22px;padding:16px;min-height:170px;cursor:pointer;overflow:hidden;background:linear-gradient(160deg,var(--card),var(--card2))}' +
    '.lv-sub .ic{width:56px;height:56px;border-radius:16px;display:grid;place-items:center;font-size:26px;background:var(--card2);border:1px solid var(--line2)}.lv-sub .go{position:absolute;right:14px;top:14px;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:rgba(124,123,230,.15)}' +
    '.lv-sub .t{font-size:18px;font-weight:600;margin:14px 0 10px}.lv-sub .bar{position:absolute;left:16px;bottom:0;width:56px;height:5px;border-radius:5px 5px 0 0}' +
    '.lv-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;font-size:13.5px;border:1px solid var(--line2);color:var(--mu);background:var(--card2);white-space:nowrap}.lv-chip.p{color:var(--p);border-color:rgba(124,123,230,.5);background:rgba(124,123,230,.12)}' +
    '.lv-chip.d{background:#0c0d1c;color:var(--tx);border-color:transparent}body.light-mode .lv-chip.d{background:#e9ebf8}.lv-chip.a{color:var(--a);border-color:rgba(240,160,48,.5);background:rgba(240,160,48,.12)}.lv-chip.g{color:var(--g);border-color:rgba(47,182,127,.45);background:rgba(47,182,127,.12)}' +
    '.lv-big{display:flex;align-items:center;gap:14px;border:1px solid var(--line);border-radius:20px;padding:16px;margin-bottom:12px;cursor:pointer}.lv-big .ic{width:52px;height:52px;border-radius:15px;background:var(--card2);display:grid;place-items:center;font-size:24px;border:1px solid var(--line2)}.lv-big b{display:block;font-size:18px}.lv-big span{color:var(--mu);font-size:14px}.lv-big .go{margin-left:auto;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:#fff}' +
    '.lv-card{position:relative;display:flex;align-items:center;gap:14px;border:1px solid var(--line);border-radius:24px;padding:18px 14px 18px 22px;margin-bottom:12px;background:var(--card);cursor:pointer;overflow:hidden}.lv-card:before{content:"";position:absolute;left:0;top:20px;bottom:20px;width:4px;border-radius:0 4px 4px 0;background:#6a6ee8}' +
    '.lv-ci{width:60px;height:60px;border-radius:50%;flex-shrink:0;display:grid;place-items:center;font-weight:700;font-size:20px;color:#fff;background:linear-gradient(145deg,#8a82ee,#5d54c4);border:2px solid rgba(255,255,255,.2);box-shadow:0 6px 16px rgba(80,70,200,.35);overflow:hidden}.lv-ci img{width:100%;height:100%;object-fit:cover}' +
    '.lv-mid{flex:1;min-width:0}.lv-nm{font-size:18px;font-weight:600;line-height:1.2}.lv-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}.lv-meta{display:flex;gap:16px;color:var(--mu);font-size:14.5px;margin-top:10px;align-items:center}' +
    '.lv-chev{width:44px;height:44px;border-radius:50%;background:rgba(124,123,230,.14);color:var(--p);display:grid;place-items:center;flex-shrink:0}.lv-pin{display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--mu);font-size:12px;background:none;border:0;cursor:pointer;min-width:38px}.lv-pin i{font-size:30px}.lv-pin.on{color:#e5484d}' +
    '.lv-hero{position:relative;border:1px solid var(--line2);border-radius:24px;padding:20px;margin-bottom:14px;background:linear-gradient(135deg,#1d1f3f,#16172b);overflow:hidden;display:flex;gap:16px;align-items:flex-start;color:#ecebf8}body.light-mode .lv-hero{background:linear-gradient(135deg,#eceefe,#fff);color:#191a33}' +
    '.lv-hero:before{content:"";position:absolute;right:-50px;top:-50px;width:190px;height:190px;border-radius:50%;background:rgba(124,123,230,.16)}.lv-hero>*{position:relative}.lv-hero .lv-ci{width:78px;height:78px;font-size:26px}.lv-hero h3{margin:0;font-size:23px}' +
    '.lv-lock{display:flex;gap:14px;align-items:center;border:1px solid rgba(229,72,77,.45);background:linear-gradient(135deg,rgba(229,72,77,.18),rgba(229,72,77,.06));color:#ff6b70;border-radius:18px;padding:16px;margin-bottom:12px;font-weight:600;font-size:16.5px;line-height:1.35}.lv-lock .i{width:50px;height:50px;border-radius:14px;background:rgba(229,72,77,.2);display:grid;place-items:center;font-size:22px;flex-shrink:0}.lv-lock.prem{border-color:rgba(240,160,48,.5);background:rgba(240,160,48,.1);color:#f0a030}' +
    '.lv-act{display:flex;gap:8px;flex-wrap:wrap;margin:-2px 0 14px}.lv-btn{border:0;cursor:pointer;border-radius:14px;padding:12px 16px;font:600 14.5px inherit;color:#fff;display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#6a6ee8,#8a7fe6)}.lv-btn.a{background:linear-gradient(135deg,#f6b445,#e0861d)}.lv-btn.gh{background:var(--card);border:1px solid var(--line2);color:var(--tx)}' +
    '.lv-ch{position:relative;border:1px solid var(--line);border-radius:22px;padding:16px 16px 16px 14px;margin-bottom:12px;background:var(--card);display:flex;gap:14px;align-items:flex-start}.lv-ch.lk{opacity:.78}.lv-num{width:58px;height:58px;border-radius:16px;border:1px solid var(--line2);background:var(--card2);display:grid;place-items:center;font-size:19px;color:var(--mu);flex-shrink:0}' +
    '.lv-ch .nm{font-size:19px;font-weight:600;line-height:1.25;margin-bottom:8px;padding-right:30px}.lv-ch .padl{position:absolute;right:16px;top:16px;font-size:26px;color:var(--mu)}.lv-btns{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}' +
    '.lv-b1{display:inline-flex;align-items:center;gap:9px;border-radius:14px;padding:12px 18px;border:0;font:600 17px inherit;color:#fff;background:linear-gradient(135deg,#6f6df0,#8a7fe6);box-shadow:0 6px 16px rgba(106,110,232,.35);cursor:pointer}.lv-b2{display:inline-flex;align-items:center;gap:9px;border-radius:14px;padding:12px 18px;border:1px solid rgba(47,182,127,.4);background:rgba(47,182,127,.1);color:var(--g);font:600 17px inherit;cursor:pointer}' +
    '.lv-empty{text-align:center;color:var(--dm);padding:46px 20px}.lv-empty i{font-size:42px;display:block;margin-bottom:10px}' +
    '.lv-prem{border:1px solid rgba(240,160,48,.35);border-radius:24px;padding:22px;text-align:center;background:linear-gradient(160deg,rgba(240,160,48,.12),transparent);box-shadow:0 0 40px rgba(240,160,48,.12)}.lv-prem .ic{width:72px;height:72px;border-radius:22px;margin:0 auto 12px;display:grid;place-items:center;font-size:34px;color:#fff;background:linear-gradient(135deg,#f6b445,#e0861d)}' +
    '.lv-pick{text-align:center;padding:30px 4px}.lv-pick .ic{width:92px;height:92px;border-radius:28px;margin:0 auto 16px;display:grid;place-items:center;font-size:42px;color:#fff;background:linear-gradient(135deg,#6f6df0,#8a7fe6);box-shadow:0 0 40px rgba(106,110,232,.4)}.lv-pick h2{margin:0 0 8px}.lv-pick p{color:var(--mu);margin:0 8px 22px}' +
    '.lv-lvl{display:flex;align-items:center;gap:14px;border-radius:22px;padding:16px;margin-bottom:12px;cursor:pointer;text-align:center;border:1px solid}.lv-lvl .ic{width:60px;height:60px;border-radius:18px;background:rgba(0,0,0,.25);display:grid;place-items:center;font-size:26px}.lv-lvl .m{flex:1}.lv-lvl b{display:block;font-size:20px}.lv-lvl span{font-size:14px;color:var(--mu)}.lv-lvl .go{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;color:#fff}' +
    '#lv2-ov{position:fixed;inset:0;z-index:300;background:rgba(3,4,12,.65);backdrop-filter:blur(5px);display:flex;align-items:flex-end;justify-content:center}#lv2-ov .sh{width:100%;max-width:480px;max-height:90vh;overflow:auto;background:#0f1020;color:#ecebf8;border:1px solid #303360;border-bottom:0;border-radius:28px 28px 0 0;padding:10px 18px calc(22px + env(safe-area-inset-bottom));animation:lvup .25s cubic-bezier(.2,.9,.3,1)}body.light-mode #lv2-ov .sh{background:#fff;color:#191a33;border-color:#dfe1f2}@keyframes lvup{from{transform:translateY(40px);opacity:0}}' +
    '#lv2-ov .grab{width:56px;height:5px;border-radius:9px;background:#303360;margin:0 auto 16px}#lv2-ov .hd{display:flex;gap:14px;align-items:center}#lv2-ov .pl{width:60px;height:60px;border-radius:18px;background:linear-gradient(135deg,#6f6df0,#8a7fe6);display:grid;place-items:center;color:#fff;font-size:28px;box-shadow:0 8px 20px rgba(106,110,232,.4);flex-shrink:0}#lv2-ov .hd h3{margin:0 0 8px;font-size:23px}' +
    '#lv2-ov .x{margin-left:auto;width:46px;height:46px;border-radius:50%;border:1px solid #303360;background:none;color:inherit;font-size:20px;cursor:pointer}#lv2-ov .tip{display:flex;gap:10px;align-items:center;color:#8a8bb0;margin:18px 0 14px;font-size:16px}#lv2-ov .tip:before{content:"";width:9px;height:9px;border-radius:50%;background:#5d5f86}' +
    '#lv2-ov .tiles{display:flex;flex-wrap:wrap;gap:12px;padding-bottom:18px;border-bottom:1px solid #26284a}#lv2-ov .t{width:calc(25% - 9px);min-width:76px;height:76px;border-radius:20px;border:1px solid #303360;background:#16172b;color:#7c7be6;font:600 25px inherit;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;position:relative}body.light-mode #lv2-ov .t{background:#f4f5fc}' +
    '#lv2-ov .t small{font-size:12px;color:#8a8bb0;font-weight:500}#lv2-ov .t.sel{background:linear-gradient(135deg,#6f6df0,#8a7fe6);color:#fff;border-color:transparent;box-shadow:0 8px 18px rgba(106,110,232,.4)}#lv2-ov .t.sel small{color:#fff}#lv2-ov .t.w:after{content:"✓";position:absolute;top:5px;right:8px;font-size:12px;color:#2fb67f}#lv2-ov .t.dis{opacity:.4;cursor:not-allowed}' +
    '#lv2-ov .ft{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}#lv2-ov .pill{display:inline-flex;gap:9px;align-items:center;padding:13px 18px;border-radius:999px;border:1px solid #303360;background:none;color:#7c7be6;font:600 16px inherit;cursor:pointer}#lv2-ov .pill.on{background:linear-gradient(135deg,#6f6df0,#8a7fe6);color:#fff;border-color:transparent}' +
    '#lv2-ov .wide{width:100%;margin-top:14px;padding:17px;border-radius:20px;border:1px solid #303360;background:none;color:inherit;font:500 18px inherit;cursor:pointer}#lv2-ov .row2{display:flex;gap:12px;margin-top:14px}#lv2-ov .row2 .wide{margin:0;flex:1}#lv2-ov .row2 .send{flex:2;border:0;color:#fff;background:linear-gradient(135deg,#6f6df0,#8a7fe6);font-weight:600;box-shadow:0 8px 20px rgba(106,110,232,.35)}#lv2-ov .row2 .send:disabled{opacity:.5}';

  var CSS2 = "#lv2-wa{position:fixed;inset:0;z-index:320;background:rgba(3,4,12,.7);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:22px}#lv2-wa .bx{width:100%;max-width:400px;background:#16172b;color:#ecebf8;border:1px solid #303360;border-radius:26px;padding:24px;animation:lvup .25s}body.light-mode #lv2-wa .bx{background:#fff;color:#191a33;border-color:#dfe1f2}#lv2-wa .em{font-size:54px;line-height:1}#lv2-wa h3{font-size:25px;margin:12px 0 14px}#lv2-wa p{color:#8a8bb0;font-size:17px;line-height:1.6;margin:0 0 14px;white-space:pre-line}#lv2-wa .go{width:100%;border:0;border-radius:14px;padding:18px;font:600 18px inherit;color:#fff;background:linear-gradient(135deg,#7c7be6,#6a6ee8);cursor:pointer}#lv2-wa .x{width:100%;margin-top:10px;border:0;background:none;color:#8a8bb0;font:15px inherit;cursor:pointer;padding:8px}";
  function injectCss() { if (document.getElementById('lv2-css')) return; var s = document.createElement('style'); s.id = 'lv2-css'; s.textContent = CSS + CSS2; document.head.appendChild(s); }

  /* ── data ── */
  var catalog = null, catAt = 0, catPromise = null;
  function loadCatalog(force) {
    if (catPromise && !force) return catPromise;
    var tg = getTg(); var h = tg && tg.initData ? { 'x-tg-init-data': tg.initData } : {};
    catPromise = fetch('/api/catalog', { headers: h }).then(function (r) { return r.json(); }).then(function (j) { if (!j.success) throw new Error(j.error || 'Failed'); catalog = j.data; catAt = Date.now(); st.err = null; setTimeout(maybeWhatsApp, 600); return catalog; }).catch(function (e) { st.err = e.message; catPromise = null; throw e; });
    return catPromise;
  }
  var allBatches = function () { return window.batches || []; };
  var batchById = function (id) { return allBatches().find(function (b) { return b._id === id; }); };
  function batchLocked(b) {
    if (window.isAdmin) return false;
    if (!b) return true;
    if (b.isPremium) { var uid = String(fn('getUserId') ? getUserId() : ''); var owner = !!(b.premiumUsers && b.premiumUsers.indexOf(uid) >= 0); return !(owner || (fn('hasBatchRewardAccess') && hasBatchRewardAccess(b._id)) || (fn('hasBatchReferralAccess') && hasBatchReferralAccess(b._id)) || b.referralUnlocked); }
    return !(fn('hasAccess') && hasAccess());
  }
  var lecsOf = function (ch) { var out = (ch.lectures || []).slice(); (ch.units || []).forEach(function (u) { (u.lectures || []).forEach(function (l) { out.push(l); }); }); return out; };
  function sortBatches(a, b) { return String(b.startDate || '').localeCompare(String(a.startDate || '')) || 0; }
  function subjectEntry() { return catalog && catalog.subjects.find(function (s) { return s.level === st.level && s.name === st.subj; }); }
  function visFacs(s) { // faculties having at least one batch in the active free/premium tab
    return (s.faculties || []).map(function (f) { return Object.assign({}, f, { batches: f.batches.filter(function (b) { return st.tab === 'premium' ? b.premium : !b.premium; }).sort(sortBatches) }); }).filter(function (f) { return f.batches.length; });
  }

  /* ── render ── */
  var ci = function (f) { return '<div class="lv-ci"' + (f.color && !f.pic ? ' style="background:linear-gradient(145deg,' + E(f.color) + ',#4b3fa8)"' : '') + '>' + (f.pic ? '<img src="' + E(f.pic) + '" alt="">' : E(f.initials || '?')) + '</div>'; };
  function head() {
    var tg = getTg(), u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user; var cfg = (catalog && catalog.config) || {};
    return '<div class="lv-head"><div class="lv-av">' + E(((u && u.first_name) || 'S')[0].toUpperCase()) + '</div><div class="lv-hl">' + E(LEVEL_LABEL[st.level] || 'Lectures') + '</div>' +
      (window.isAdmin ? '<button class="lv-hb" data-lv="panel"><span class="ic" style="background:#6a6ee8"><i class="ti ti-settings"></i></span>Panel</button>' : '') +
      '<button class="lv-hb" data-lv="theme"><span class="tg"></span>Theme</button>' + (cfg.supportLink ? '<button class="lv-hb" data-lv="support"><span class="ic"><i class="ti ti-headset"></i></span>Support</button>' : '') + '</div>';
  }
  var tabs = function () { return '<div class="lv-seg ' + (st.tab === 'premium' ? 'prem' : '') + '"><button class="' + (st.tab === 'free' ? 'on' : '') + '" data-lv="tab" data-v="free"><i class="ti ti-school"></i>Free Lectures</button><button class="' + (st.tab === 'premium' ? 'on' : '') + '" data-lv="tab" data-v="premium"><i class="ti ti-crown"></i>Premium <i class="ti ti-lock" style="font-size:15px"></i></button></div>'; };
  var title = function (t, sub, back) { return '<div class="lv-title"><button class="lv-sq" data-lv="back"><i class="ti ti-chevron-left"></i></button><div><h2>' + t + '</h2><p>' + sub + '</p></div></div>'; };

  function vLevelPick() {
    var mk = function (lv, color, icon) { return '<div class="lv-lvl" data-lv="level" data-v="' + lv + '" style="border-color:' + color + '55;background:linear-gradient(135deg,' + color + '22,transparent)"><div class="ic" style="color:' + color + '"><i class="ti ti-' + icon + '"></i></div><div class="m"><b style="color:' + color + '">' + LEVEL_LABEL[lv] + '</b><span>' + LEVEL_BLURB[lv] + '</span></div><div class="go" style="background:' + color + '"><i class="ti ti-chevron-right"></i></div></div>'; };
    return '<div class="lv-pick"><div class="ic"><i class="ti ti-school"></i></div><h2>Choose your level</h2><p>Pick what you’re studying. You can switch any time from the Lectures tab.</p>' + mk('foundation', '#2f7cc4', 'book') + mk('intermediate', '#4a8a1f', 'school') + '</div>';
  }
  function vHome() {
    var subs = catalog.subjects.filter(function (s) { return s.level === st.level; });
    var shown = subs.filter(function (s) { return visFacs(Object.assign({}, s)).length || (st.tab === 'free' && !s.faculties.length); });
    var premiumAny = catalog.subjects.some(function (s) { return s.level === st.level && s.faculties.some(function (f) { return f.batches.some(function (b) { return b.premium; }); }); });
    var h = tabs() + '<div class="lv-seg blue"><button class="' + (st.level === 'foundation' ? 'on' : '') + '" data-lv="switch" data-v="foundation"><i class="ti ti-book"></i>Foundation</button><button class="' + (st.level === 'intermediate' ? 'on' : '') + '" data-lv="switch" data-v="intermediate"><i class="ti ti-school"></i>Intermediate</button></div>';
    if (st.tab === 'premium' && !premiumAny) return h + '<div class="lv-prem"><div class="ic"><i class="ti ti-crown"></i></div><h2 style="margin:0 0 6px">Premium Lectures</h2><p style="color:var(--mu);margin:0 0 16px">Premium faculty batches unlock with a Premium subscription.</p><button class="lv-btn a" data-lv="benefits" style="width:100%;justify-content:center;padding:16px"><i class="ti ti-crown"></i>Check Premium Benefits</button></div>';
    h += '<div class="lv-lab"><i class="ti ti-books"></i>SUBJECTS</div>';
    if (!subs.length) return h + '<div class="lv-empty"><i class="ti ti-books"></i>No subjects available yet</div>';
    h += '<div class="lv-grid">' + subs.map(function (s) { var n = visFacs(s).length; var c = E(s.color || '#7c7be6'); return '<div class="lv-sub" data-lv="subject" data-v="' + E(s.name) + '" style="background:linear-gradient(160deg,' + c + '1f,var(--card))"><div class="go" style="color:' + c + '"><i class="ti ti-chevron-right"></i></div><div class="ic" style="color:' + c + '">' + tiIcon(s.name, 'book') + '</div><div class="t">' + E(s.name) + '</div><span class="lv-chip p" style="color:' + c + '"><i class="ti ti-user"></i>' + pl(n, 'teacher') + '</span><div class="bar" style="background:' + c + '"></div></div>'; }).join('') + '</div>';
    return h;
  }
  function vSubject() {
    var s = subjectEntry(); if (!s) return vHome();
    var facs = visFacs(s); var cnt = function (t) { return facs.filter(function (f) { return f.batches.some(function (b) { return b.type === t; }); }).length; };
    var list = facs.filter(function (f) { return f.batches.some(function (b) { return b.type === st.type; }); }).map(function (f) { return Object.assign({}, f, { batches: f.batches.filter(function (b) { return b.type === st.type; }) }); });
    var h = tabs() + title(E(s.name), pl(facs.length, 'teacher') + ' · choose one') + '<div class="lv-seg reg"><button class="' + (st.type === 'regular' ? 'on' : '') + '" data-lv="type" data-v="regular"><i class="ti ti-book"></i>Regular (' + cnt('regular') + ')</button><button class="' + (st.type === 'fastrack' ? 'on' : '') + '" data-lv="type" data-v="fastrack"><i class="ti ti-bolt"></i>Fastrack (' + cnt('fastrack') + ')</button></div>';
    if (!list.length) return h + '<div class="lv-empty"><i class="ti ti-user-off"></i>No ' + st.type + ' batches yet</div>';
    return h + list.map(function (f) {
      var bs = f.batches, one = bs.length === 1, b0 = bs[0];
      var meta = one ? '<div class="lv-row"><span class="lv-chip p">' + E(b0.label || '—') + '</span>' + (b0.institute ? '<span class="lv-chip d"><i class="ti ti-building"></i>' + E(b0.institute) + '</span>' : '') + (b0.premium ? '<span class="lv-chip a"><i class="ti ti-crown"></i>Premium</span>' : '') + '</div><div class="lv-meta"><span><i class="ti ti-book"></i> ' + pl(b0.chapters, 'chapter') + '</span><span><i class="ti ti-player-play"></i> ' + pl(b0.lectures, 'lecture') + '</span></div>'
        : '<div class="lv-row"><span class="lv-chip p">' + pl(bs.length, 'batch', 'batches') + '</span></div><div class="lv-meta" style="gap:6px">Latest: <b style="color:var(--tx)">' + E(bs[0].label || '—') + '</b></div>';
      var fav = one && fn('isFavoriteBatch') && isFavoriteBatch(b0.batchId);
      return '<div class="lv-card" data-lv="' + (one ? 'batch' : 'faculty') + '" data-v="' + E(one ? b0.batchId : f.id) + '">' + ci(f) + '<div class="lv-mid"><div class="lv-nm">' + E(f.name) + '</div>' + meta + '</div><div class="lv-chev"><i class="ti ti-chevron-right"></i></div>' + (one ? '<button class="lv-pin ' + (fav ? 'on' : '') + '" data-lv="pin" data-v="' + E(b0.batchId) + '"><i class="ti ti-heart' + (fav ? '-filled' : '') + '"></i>Pin</button>' : '') + '</div>';
    }).join('');
  }
  function vFaculty() {
    var s = subjectEntry(); var f = s && visFacs(s).find(function (x) { return x.id === st.fac; }); if (!f) return vSubject();
    var bs = f.batches.filter(function (b) { return b.type === st.type; });
    return tabs() + title(E(f.name), pl(bs.length, 'batch', 'batches') + ' available — choose one') + bs.map(function (b) {
      var fav = fn('isFavoriteBatch') && isFavoriteBatch(b.batchId);
      return '<div class="lv-card" data-lv="batch" data-v="' + E(b.batchId) + '">' + ci(f) + '<div class="lv-mid"><div class="lv-nm">' + E(f.name) + '</div><div class="lv-row"><span class="lv-chip p">' + E(b.label || '—') + '</span>' + (b.institute ? '<span class="lv-chip d"><i class="ti ti-building"></i>' + E(b.institute) + '</span>' : '') + '</div><div class="lv-meta"><span><i class="ti ti-book"></i> ' + pl(b.chapters, 'chapter') + '</span><span><i class="ti ti-player-play"></i> ' + pl(b.lectures, 'lecture') + '</span></div></div><div class="lv-chev"><i class="ti ti-chevron-right"></i></div><button class="lv-pin ' + (fav ? 'on' : '') + '" data-lv="pin" data-v="' + E(b.batchId) + '"><i class="ti ti-heart' + (fav ? '-filled' : '') + '"></i>Pin</button></div>';
    }).join('');
  }
  function vBatch() {
    var s = subjectEntry(); var b = batchById(st.bid); var fac = null, meta = null;
    if (s) s.faculties.forEach(function (f) { f.batches.forEach(function (x) { if (x.batchId === st.bid) { fac = f; meta = x; } }); });
    if (!b || !meta) return '<div class="lv-empty"><i class="ti ti-alert-circle"></i>This batch is not available<br><br><button class="lv-btn" data-lv="back">Go back</button></div>';
    var subj = (b.subjects || []).find(function (x) { return x._id === meta.subjectId; }) || { chapters: [] };
    var locked = batchLocked(b); var chs = subj.chapters || [];
    var h = '<div class="lv-title" style="margin-bottom:12px"><button class="lv-sq" data-lv="back" style="width:48px;height:48px"><i class="ti ti-chevron-left"></i></button><div><h2 style="font-size:20px">' + E(st.subj) + ' › ' + E(fac.name) + '</h2></div></div>' +
      '<div class="lv-hero">' + ci(fac) + '<div><h3>' + E(fac.name) + '</h3><div class="lv-row"><span class="lv-chip"><i class="ti ti-book"></i>' + E(st.subj) + '</span><span class="lv-chip">' + E(meta.label || '—') + '</span>' + (meta.institute ? '<span class="lv-chip"><i class="ti ti-building"></i>' + E(meta.institute) + '</span>' : '') + '<span class="lv-chip">' + pl(chs.length, 'chapter') + '</span></div></div></div>';
    if (locked) {
      if (b.isPremium) h += '<div class="lv-lock prem"><div class="i"><i class="ti ti-crown"></i></div><div>Premium batch — buy or unlock it to open chapters</div></div><div class="lv-act">' + (fn('buyBatch') ? '<button class="lv-btn a" data-lv="buy"><i class="ti ti-shopping-cart"></i>Buy' + (b.price ? ' ₹' + E(b.price) : '') + '</button>' : '') + (fn('openBatchReferralUnlockModal') ? '<button class="lv-btn" data-lv="refer"><i class="ti ti-users"></i>Refer & Unlock</button>' : '') + (fn('_getAllDemoLectures') && _getAllDemoLectures(b).length ? '<button class="lv-btn gh" data-lv="demo"><i class="ti ti-player-play"></i>View Demo</button>' : '') + '</div>';
      else h += '<div class="lv-lock"><div class="i"><i class="ti ti-lock"></i></div><div>Activate your free access in the Access tab to open chapters</div></div><div class="lv-act"><button class="lv-btn" data-lv="access"><i class="ti ti-shield-check"></i>Open Access tab</button>' + (fn('_getAllDemoLectures') && _getAllDemoLectures(b).length ? '<button class="lv-btn gh" data-lv="demo"><i class="ti ti-player-play"></i>View Demo</button>' : '') + '</div>';
    }
    if (!chs.length) return h + '<div class="lv-empty"><i class="ti ti-book-off"></i>No chapters yet</div>';
    return h + chs.map(function (c, i) {
      var ls = lecsOf(c); var hasN = ls.some(function (l) { return l.notes; }); var num = ('0' + (i + 1)).slice(-2);
      return '<div class="lv-ch ' + (locked ? 'lk' : '') + '"><div class="lv-num">' + num + '</div><div style="flex:1;min-width:0"><div class="nm">' + E(c.name) + '</div>' + (ls.length ? '<span class="lv-chip"><i class="ti ti-player-play-filled" style="font-size:12px"></i> ' + pl(ls.length, 'lecture') + '</span>' : '<span class="lv-chip">Coming soon</span>') +
        (locked ? '' : '<div class="lv-btns">' + (ls.length ? '<button class="lv-b1" data-lv="lectures" data-v="' + E(c._id) + '"><i class="ti ti-player-play"></i>Lectures</button>' : '') + (hasN ? '<button class="lv-b2" data-lv="notes" data-v="' + E(c._id) + '"><i class="ti ti-file-text"></i>Notes</button>' : '') + '</div>') + '</div>' + (locked ? '<i class="ti ti-lock padl"></i>' : '') + '</div>';
    }).join('');
  }

  function render() {
    if (!root) return;
    var body;
    if (st.level && !catalog && !catPromise) loadCatalog().then(render).catch(render);
    if (!st.level) body = vLevelPick();
    else if (st.err && !catalog) body = '<div class="lv-empty"><i class="ti ti-wifi-off"></i>' + E(st.err) + '<br><br><button class="lv-btn" data-lv="retry">Retry</button></div>';
    else if (!catalog) body = '<div class="lv-empty"><i class="ti ti-loader-2"></i>Loading…</div>';
    else body = { home: vHome, subject: vSubject, faculty: vFaculty, batch: vBatch }[st.view]();
    root.innerHTML = (st.level ? head() : '') + body;
  }

  /* ── lecture picker sheet ── */
  var lecUrl = function (code) { return /^https?:/.test(code) ? code : 'https://t.me/' + (window._botUsername || '') + '?start=' + code; };
  function closeSheet() { var o = document.getElementById('lv2-ov'); if (o) o.remove(); st.sheet = null; }
  function openPicker(chId, mode) {
    var b = batchById(st.bid); var s = subjectEntry(); var meta, fac; s.faculties.forEach(function (f) { f.batches.forEach(function (x) { if (x.batchId === st.bid) { meta = x; fac = f; } }); });
    var subj = b.subjects.find(function (x) { return x._id === meta.subjectId; }); var ch = subj.chapters.find(function (c) { return c._id === chId; }); if (!ch) return;
    var all = lecsOf(ch); var items = mode === 'notes' ? all.map(function (l, i) { return { l: l, n: i + 1 }; }).filter(function (x) { return x.l.notes; }) : all.map(function (l, i) { return { l: l, n: i + 1 }; });
    st.sheet = { chId: chId, mode: mode, multi: false, sel: {}, items: items, chName: ch.name, fac: fac.name, total: all.length };
    drawSheet();
  }
  function usable(x, mode) { return !x.l.comingSoon && (mode === 'notes' ? x.l.notes : x.l.link); }
  function drawSheet() {
    var S = st.sheet; if (!S) return; var o = document.getElementById('lv2-ov'); if (!o) { o = document.createElement('div'); o.id = 'lv2-ov'; o.addEventListener('click', onSheetClick); document.body.appendChild(o); }
    var selN = Object.keys(S.sel).length; var notes = S.mode === 'notes';
    o.innerHTML = '<div class="sh"><div class="grab"></div><div class="hd"><div class="pl"><i class="ti ti-' + (notes ? 'file-text' : 'player-play-filled') + '"></i></div><div style="min-width:0"><h3>' + E(S.chName) + '</h3><div class="lv-row" style="margin:0"><span class="lv-chip" style="background:#16172b;color:#ecebf8">' + E(S.fac) + '</span><span class="lv-chip p">' + pl(S.items.length, notes ? 'note' : 'lecture') + '</span></div></div><button class="x" data-z="close"><i class="ti ti-x"></i></button></div>' +
      '<div class="tip">' + (S.multi ? 'Tap ' + (notes ? 'notes' : 'lectures') + ' to select, then send them all at once.' : 'Tap a ' + (notes ? 'note' : 'lecture') + ' number to receive it instantly.') + '</div>' +
      '<div class="tiles">' + S.items.map(function (x) { var u = usable(x, S.mode); var w = !notes && fn('isLectureWatched') && isLectureWatched(x.l._id); return '<button class="t ' + (S.sel[x.l._id] ? 'sel ' : '') + (w ? 'w ' : '') + (u ? '' : 'dis') + '" data-z="tile" data-v="' + E(x.l._id) + '" title="' + E(x.l.name) + '">' + (S.sel[x.l._id] ? '<i class="ti ti-check" style="font-size:24px"></i>' : x.n) + '<small>' + (x.l.comingSoon ? 'soon' : (u ? E(String(x.l.name).slice(0, 9)) : 'locked')) + '</small></button>'; }).join('') + '</div>' +
      (S.multi ? '<div class="ft"><span class="pill"><i class="ti ti-circle-filled" style="font-size:9px"></i>' + selN + ' selected · ' + (S.items.filter(function (x) { return usable(x, S.mode); }).length - selN) + ' remaining</span></div><div class="row2"><button class="wide" data-z="cancel">Cancel</button><button class="wide send" data-z="send" ' + (selN ? '' : 'disabled') + '><i class="ti ti-send"></i> Send ' + selN + ' ' + (notes ? 'Note' : 'Lecture') + (selN === 1 ? '' : 's') + ' to Bot</button></div>'
        : '<div class="ft"><button class="pill" data-z="multi"><i class="ti ti-square"></i>Select Multiple</button><button class="pill on" data-z="all"><i class="ti ti-checkbox"></i>Select All</button></div><button class="wide" data-z="close">Close</button>') + '</div>';
  }
  async function sendOne(x, first, mode) {
    if (mode === 'notes') { if (first) return openLecLink(x.l.notes, 'notes'); return openLink(lecUrl(x.l.notes), 'notes'); }
    if (fn('markLectureWatched')) markLectureWatched(x.l._id);
    if (first) return openLecLink(x.l.link, 'lecture'); // applies the existing ad gate once
    return openLink(lecUrl(x.l.link), 'lecture');
  }
  async function onSheetClick(ev) {
    var S = st.sheet; if (ev.target.id === 'lv2-ov') return closeSheet(); var z = ev.target.closest('[data-z]'); if (!z || !S) return; var k = z.dataset.z;
    if (k === 'close') return closeSheet();
    if (k === 'multi') { S.multi = true; S.sel = {}; return drawSheet(); }
    if (k === 'cancel') { S.multi = false; S.sel = {}; return drawSheet(); }
    if (k === 'all') { S.multi = true; S.sel = {}; S.items.forEach(function (x) { if (usable(x, S.mode)) S.sel[x.l._id] = 1; }); return drawSheet(); }
    if (k === 'tile') { var x = S.items.find(function (i) { return i.l._id === z.dataset.v; }); if (!x || !usable(x, S.mode)) return fn('toast') && toast(x && x.l.comingSoon ? 'Coming soon' : 'Not available', 'error'); if (S.multi) { if (S.sel[x.l._id]) delete S.sel[x.l._id]; else S.sel[x.l._id] = 1; return drawSheet(); } await sendOne(x, true, S.mode); return drawSheet(); }
    if (k === 'send') { var picked = S.items.filter(function (i) { return S.sel[i.l._id]; }); if (!picked.length) return; var mode = S.mode; closeSheet();
      for (var i = 0; i < picked.length; i++) { try { await sendOne(picked[i], i === 0, mode); } catch (e) {} if (i < picked.length - 1) await new Promise(function (r) { setTimeout(r, 1800); }); }
      if (fn('toast')) toast(picked.length + ' sent — check your bot chat', 'success'); }
  }

  /* ── events ── */
  function nav(view, extra) { Object.assign(st, { view: view }, extra || {}); render(); window.scrollTo && root.scrollIntoView && root.scrollIntoView({ block: 'start' }); }
  function onClick(ev) {
    var t = ev.target.closest('[data-lv]'); if (!t) return; var k = t.dataset.lv, v = t.dataset.v; ev.stopPropagation();
    switch (k) {
      case 'level': st.level = v; LS.set('lv2_level', v); st.view = 'home'; render(); break;
      case 'switch': if (v !== st.level) { var go = function () { st.level = v; LS.set('lv2_level', v); st.view = 'home'; render(); }; if (window.confirm('Switch to ' + LEVEL_LABEL[v] + '?')) go(); } break;
      case 'tab': st.tab = v; if (st.view === 'batch') st.view = 'home'; render(); break;
      case 'type': st.type = v; render(); break;
      case 'subject': nav('subject', { subj: v, type: 'regular' }); break;
      case 'faculty': nav('faculty', { fac: v }); break;
      case 'batch': { var sEntry = subjectEntry(); st.bid = v; nav('batch'); break; }
      case 'back': if (st.view === 'batch') { var s2 = subjectEntry(); var f2 = s2 && visFacs(s2).find(function (f) { return f.batches.some(function (b) { return b.batchId === st.bid; }); }); var cnt = f2 && f2.batches.filter(function (b) { return b.type === st.type; }).length; nav(cnt > 1 ? 'faculty' : 'subject', f2 && cnt > 1 ? { fac: f2.id } : {}); } else if (st.view === 'faculty') nav('subject'); else if (st.view === 'subject') nav('home'); else { st.level = null; LS.set('lv2_level', ''); render(); } break;
      case 'pin': if (fn('toggleFavoriteBatch')) toggleFavoriteBatch(v); break; /* re-renders through renderBatches */
      case 'lectures': openPicker(v, 'lectures'); break;
      case 'notes': openPicker(v, 'notes'); break;
      case 'buy': buyBatch(st.bid); break;
      case 'refer': openBatchReferralUnlockModal(st.bid); break;
      case 'demo': openDemoModal(st.bid); break;
      case 'access': if (fn('switchNavTab')) switchNavTab('access'); break;
      case 'benefits': if (fn('switchNavTab')) switchNavTab('access'); break;
      case 'theme': { var tt = document.getElementById('themeToggle'); if (tt && fn('toggleTheme')) { tt.checked = !tt.checked; toggleTheme(tt.checked); } else document.body.classList.toggle('light-mode'); render(); break; }
      case 'support': { var tg = getTg(), l = catalog && catalog.config.supportLink; if (l) { if (tg && /^https?:\/\/t\.me\//.test(l) && tg.openTelegramLink) tg.openTelegramLink(l); else if (tg) tg.openLink(l); else window.open(l, '_blank', 'noopener'); } break; }
      case 'panel': location.href = '/admin.html'; break;
      case 'retry': st.err = null; render(); loadCatalog(true).then(render).catch(render); break;
    }
  }


  /* "Join our WhatsApp channel" reminder: shown at most once every 3 days, only when a link is configured in the admin panel. */
  function maybeWhatsApp() {
    var link = catalog && catalog.config && catalog.config.whatsappLink; if (!link || !/^https:\/\//.test(link) || document.getElementById('lv2-wa')) return;
    var last = parseInt(LS.get('lv2_wa') || '0', 10); if (Date.now() - last < 3 * 864e5) return; LS.set('lv2_wa', String(Date.now()));
    var o = document.createElement('div'); o.id = 'lv2-wa'; o.innerHTML = '<div class="bx"><div class="em">🚨</div><h3>Join Our WhatsApp Channel Urgently</h3><p>Agar kal ko humara telegram channels bhi ban kar diya to kya karoge?\n\nDon\u2019t worry.\n\nIsliye join our WhatsApp channel too.</p><button class="go" data-w="go">Click Here To Join</button><button class="x" data-w="x">Maybe later</button></div>';
    o.addEventListener('click', function (ev) { var b = ev.target.closest('[data-w]'); if (ev.target === o || (b && b.dataset.w === 'x')) return o.remove(); if (b) { var tg = getTg(); if (tg && tg.openLink) tg.openLink(link); else window.open(link, '_blank', 'noopener'); o.remove(); } });
    document.body.appendChild(o);
  }
  function mount() {
    injectCss(); var body = document.querySelector('#page-home .page-body'); if (!body) return false;
    root = document.getElementById('lv2'); if (!root) { root = document.createElement('div'); root.id = 'lv2'; body.insertBefore(root, body.firstChild); root.addEventListener('click', onClick); }
    document.body.classList.add('lv2-on');
    var nh = document.getElementById('navHome'); if (nh && !nh.dataset.lv) { nh.dataset.lv = 1; nh.innerHTML = '<i class="ti ti-player-play"></i><span>Lectures</span>'; }
    return true;
  }
  function refresh() { if (!root && !mount()) return; if (st.level && (!catalog || Date.now() - catAt > 20000)) { loadCatalog().then(render).catch(render); } render(); if (st.sheet) drawSheet(); }
  var orig = window.renderBatches;
  window.renderBatches = function () { try { if (orig) orig.apply(this, arguments); } catch (e) { console.error(e); } refresh(); };
  window.LV2 = { refresh: refresh, state: st, reload: function () { return loadCatalog(true).then(render); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mount(); refresh(); }); else { mount(); refresh(); }
})();
