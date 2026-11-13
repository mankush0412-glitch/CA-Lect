/* Core utilities shared by every screen. */
(function () {
  'use strict';
  const TG = window.Telegram && window.Telegram.WebApp;
  const U = window.U = { TG, me: null, missingIcons: new Set() };
  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.pl = (n, w, p) => n + ' ' + (n === 1 ? w : (p || w + 's'));
  U.hm = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + 'h ' + m + 'm' : m + 'm'; };
  U.clock = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60, p = (n) => ('0' + n).slice(-2); return h ? p(h) + ':' + p(m) + ':' + p(x) : p(m) + ':' + p(x); };
  const PAL = ['var(--p)', '#2f7cc4', '#e09b2d', '#3f9b5a', '#c4466e', '#2f9e8f', '#d0643a', '#8a5bd0'];
  U.color = (id) => { let h = 0; String(id).split('').forEach((c) => { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return PAL[h % PAL.length]; };
  U.ini = (n) => U.esc(String(n || '?').replace(/^(CA|Prof|Dr)\.?\s+/i, '').trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0] || '').join('').toUpperCase() || '?');
  /** Inline SVG icon from the bundled Material Design icon set. Unknown names are recorded so tests fail loudly. */
  U.ic = (name, cls) => { const d = window.ICONS && window.ICONS[name]; if (!d) { U.missingIcons.add(name); return `<svg class="i ${cls || ''}" viewBox="0 0 24 24" data-missing="${U.esc(name)}"><circle cx="12" cy="12" r="4"/></svg>`; } return `<svg class="i ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`; };
  U.chip = (t, c, i) => `<span class="chip ${c || ''}">${i ? U.ic(i) : ''}${U.esc(t)}</span>`;
  U.sk = '<div class="sk"></div><div class="sk"></div><div class="sk"></div>';
  U.empty = (icon, t, extra) => `<div class="empty">${U.ic(icon)}${t}${extra || ''}</div>`;

  /* ── API ── */
  async function call(base, method, path, body) {
    const h = { 'Content-Type': 'application/json', 'x-tg-init-data': (TG && TG.initData) || '' };
    const ctl = typeof AbortController === 'function' ? new AbortController() : null; const to = ctl ? setTimeout(() => ctl.abort(), 25000) : null; /* never hang forever behind a slow proxy/CDN */
    let r; try { r = await fetch(base + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined }); } catch (e) { const x = new Error('No connection. Check your internet and try again.'); x.network = true; throw x; }
    let j = {}; try { j = await r.json(); } catch (e) { /* non-JSON */ } finally { if (to) clearTimeout(to); }
    if (!r.ok || !j.success) { const err = new Error(j.error || `Something went wrong (${r.status})`); err.status = r.status; throw err; } return j.data;
  }
  U.A = (method, path, body) => call('/api/app', method, path, body);
  U.S = (method, path, body) => call('/api/study', method, path, body);

  /* ── feedback ── */
  U.toast = (msg, kind) => { document.querySelectorAll('.toast').forEach((t) => t.remove()); const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.setAttribute('role', 'status'); t.innerHTML = U.ic(kind === 'err' ? 'alert-circle' : 'circle-check') + '<span>' + U.esc(msg) + '</span>'; document.body.appendChild(t); setTimeout(() => t.remove(), 2800); if (TG && TG.HapticFeedback) { try { TG.HapticFeedback.notificationOccurred(kind === 'err' ? 'error' : 'success'); } catch (e) {} } };
  U.fail = (e) => U.toast(e && e.message ? e.message : 'Something went wrong', 'err');
  U.tap = () => { if (TG && TG.HapticFeedback) { try { TG.HapticFeedback.selectionChanged(); } catch (e) {} } };
  U.sheet = (html, opts = {}) => {
    const ov = document.createElement('div'); ov.className = 'ov'; ov.innerHTML = `<div class="sheet" role="dialog"><div class="grab"></div>${html}</div>`;
    const close = () => { ov.remove(); if (U._sheetBack) { Back.pop(U._sheetBack); U._sheetBack = null; } if (opts.onClose) opts.onClose(); }; ov.close = close;
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); }); document.body.appendChild(ov); U._sheetBack = Back.push(close); return ov;
  };
  U.modal = (html) => { const ov = document.createElement('div'); ov.className = 'ov modal'; ov.innerHTML = `<div class="box" role="dialog">${html}</div>`; ov.close = () => ov.remove(); ov.addEventListener('click', (e) => { if (e.target === ov) ov.close(); }); document.body.appendChild(ov); return ov; };
  U.confirm = (title, text, ok, danger) => new Promise((res) => { const ov = U.sheet(`<h3>${U.esc(title)}</h3><div class="sub2">${U.esc(text)}</div><div class="foot"><button class="btn ghost" data-r="0">Cancel</button><button class="btn ${danger ? 'rose' : ''}" data-r="1">${U.esc(ok || 'Confirm')}</button></div>`); let done = false; ov.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { done = true; ov.close(); res(b.dataset.r === '1'); } }); const o = ov.close; ov.close = () => { o(); if (!done) res(false); }; });
  /** fields: [{k,label,type,value,max,ph,options,hint}] — callback may return a promise; errors keep the sheet open. */
  U.ask = (title, sub, fields, ok, cb, danger) => {
    const f = (x) => { const id = 'af_' + x.k; if (x.type === 'check') return `<label class="tgl-row" style="padding:9.5px 11.5px"><span style="flex:1;color:var(--tx)">${U.esc(x.label)}</span><input type="checkbox" class="sw" id="${id}" ${x.value ? 'checked' : ''}></label>`; if (x.type === 'select') return `<div class="fld"><label>${U.esc(x.label)}</label><select class="sel" id="${id}">${x.options.map(([v, l]) => `<option value="${U.esc(v)}" ${String(v) === String(x.value) ? 'selected' : ''}>${U.esc(l)}</option>`).join('')}</select></div>`; return `<div class="fld"><label>${U.esc(x.label || '')}</label><input class="inp" id="${id}" type="${x.type || 'text'}" inputmode="${x.type === 'number' ? 'decimal' : 'text'}" placeholder="${U.esc(x.ph || '')}" value="${U.esc(x.value == null ? '' : x.value)}" maxlength="${x.max || 60}" autocomplete="off">${x.hint ? `<div style="color:var(--dm);font-size:10px;margin-top:4.5px">${U.esc(x.hint)}</div>` : ''}</div>`; };
    const ov = U.sheet(`<h3>${U.esc(title)}</h3>${sub ? `<div class="sub2">${U.esc(sub)}</div>` : ''}${fields.map(f).join('')}<div class="foot"><button class="btn ghost" data-x="c">Cancel</button><button class="btn ${danger ? 'rose' : ''}" data-x="o">${U.esc(ok)}</button></div>`);
    ov.addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (!b) return; if (b.dataset.x === 'c') return ov.close(); const v = {}; fields.forEach((x) => { const el = ov.querySelector('#af_' + x.k); v[x.k] = x.type === 'check' ? el.checked : el.value; }); b.disabled = true; Promise.resolve(cb(v, ov)).then(() => ov.close()).catch((err) => { U.fail(err); b.disabled = false; }); });
    const first = ov.querySelector('input.inp'); if (first) setTimeout(() => first.focus(), 80); return ov;
  };

  /* ── Telegram BackButton stack ── */
  const stack = []; let base = null;
  const Back = window.Back = {
    push(fn) { stack.push(fn); Back.sync(); return fn; },
    pop(fn) { const i = stack.lastIndexOf(fn); if (i >= 0) stack.splice(i, 1); Back.sync(); },
    reset() { stack.length = 0; Back.sync(); },
    setBase(fn) { base = fn; Back.sync(); },
    run() { const fn = stack[stack.length - 1] || base; if (fn) { fn(); return true; } return false; },
    sync() { if (!TG || !TG.BackButton) return; try { (stack.length || base) ? TG.BackButton.show() : TG.BackButton.hide(); } catch (e) {} },
  };
  if (TG && TG.BackButton) { try { TG.BackButton.onClick(() => Back.run()); } catch (e) {} }

  /* ── theme ── */
  U.theme = { get: () => document.documentElement.dataset.theme, set(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('sm_theme', t); } catch (e) {} const g = document.documentElement.dataset.skin === 'green'; const bg = t === 'dark' ? (g ? '#07120d' : '#0a0e1a') : (g ? '#eefaf3' : '#f0f4ff'); if (TG) { try { TG.setHeaderColor(bg); TG.setBackgroundColor(bg); TG.setBottomBarColor && TG.setBottomBarColor(t === 'dark' ? (g ? '#0a1912' : '#0d1224') : '#ffffff'); } catch (e) {} } }, toggle() { U.theme.set(U.theme.get() === 'dark' ? 'light' : 'dark'); } };
  U.copy = (txt) => { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt).then(() => true, () => false); return Promise.resolve(false); };
  U.openLink = (url) => { if (TG && /^https?:\/\/(t\.me|telegram\.me)\//.test(url) && TG.openTelegramLink) return TG.openTelegramLink(url); if (TG && TG.openLink) return TG.openLink(url); window.open(url, '_blank', 'noopener'); };
  U.dayIST = (t = Date.now()) => new Date(t + 330 * 60000).toISOString().slice(0, 10);
  U.addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  U.fmtDate = (d, o) => { const dt = new Date(d + 'T00:00:00Z'); if (o) return dt.toLocaleDateString('en-GB', { timeZone: 'UTC', ...o }); return dt.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short' }) + ', ' + dt.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }); };
})();
