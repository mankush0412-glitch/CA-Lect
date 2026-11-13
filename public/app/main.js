/* App shell: header, bottom navigation, theme, onboarding, popups. */
(function () {
  'use strict';
  const { ic, esc, TG } = U; const $app = document.getElementById('app');
  const NAV = [['access', 'Access', 'shield-check'], ['lectures', 'Lectures', 'play-circle'], ['study', 'Study', 'stopwatch'], ['referral', 'Referral', 'link'], ['points', 'Points', 'diamond']];
  let tab = '', autoTab = false, accessOn = false, unread = 0, studyLive = false, mainEl = null;
  function gate(icon, t, msg) { $app.innerHTML = `<div style="margin:auto;text-align:center;padding:24.5px;max-width:313px">${ic(icon).replace('class="i ', 'style="font-size:45.5px;color:var(--p)" class="i ')}<h2 style="margin:11.5px 0 6.5px">${esc(t)}</h2><p style="color:var(--mu)">${esc(msg)}</p></div>`; }
  function header() { const u = (U.me && U.me.name) || 'Student'; const lv = U.me.level; return `<header class="hdr"><div class="av">${esc(Array.from(u)[0] || 'S')}</div><div class="who"><b>${esc(u)}</b><span id="hl">${lv === 'foundation' ? 'CA Foundation' : lv === 'intermediate' ? 'CA Intermediate' : 'CA Student'}</span></div>${U.me.staff ? `<button class="hb" data-m="panel" aria-label="Admin panel"><span class="b" style="background:var(--p2);box-shadow:0 4px 13px rgba(var(--pr),.35)">${ic('settings')}</span>Panel</button>` : ''}<button class="hb" data-m="theme" aria-label="Toggle theme"><span class="tgl"></span>Theme</button>${U.me.config.supportLink ? `<button class="hb" data-m="support" aria-label="Support"><span class="b">${ic('headset')}</span>Support</button>` : ''}</header>`; }
  function nav() { return `<nav class="nav" aria-label="Main">${NAV.map(([id, l, i]) => `<button data-m="tab" data-v="${id}" class="${tab === id || (id === 'lectures' && tab === 'planner') ? 'on' : ''}" aria-label="${l}">${ic(i)}${l}${id === 'access' ? `<span class="nb" id="nbA" style="${accessOn ? 'display:none' : ''};min-width:8.5px;height:8.5px;padding:0;left:calc(50% + 9px);top:4px"></span>` : ''}${id === 'study' ? `<span class="nb" id="nbS" style="${unread ? '' : 'display:none'}">${unread > 9 ? '10+' : unread}</span>` : ''}</button>`).join('')}</nav>`; }
  /** Theme: 'level' = Foundation blue / Intermediate green (default), or always blue / always green (Admin → Bot configuration). */
  function applyTheme() { const c = (U.me && U.me.config) || {}; const pick = c.themeSkin === 'green' ? 'green' : c.themeSkin === 'blue' ? 'blue' : (U.me && U.me.level === 'intermediate' ? 'green' : 'blue'); document.documentElement.dataset.skin = pick; try { U.theme.set(U.theme.get()); } catch (e) {} }
  function applyScale() { const s = Number((U.me && U.me.config && U.me.config.uiScale) || 88); document.documentElement.style.setProperty('--zm', String(Math.min(1.1, Math.max(0.6, s / 100)))); }
  function shell() { applyTheme(); $app.innerHTML = header() + '<main id="main"></main>' + nav(); mainEl = document.getElementById('main'); $app.addEventListener('click', onClick); }
  function go(t) {
    if (tab === t && t !== 'lectures') return; try { if (tab === 'study' && window.Study) Study.leave(); if (window.Access && tab === 'access') Access.stop(); if (window.Planner && tab === 'planner') Planner.close(); Back.reset(); Back.setBase(t === 'access' ? null : () => go('access')); } catch (e) { /* never leave the screen blank because of a back-button hiccup */ }
    tab = t; document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === t || (b.dataset.v === 'lectures' && t === 'planner'))); mainEl.innerHTML = ''; mainEl.scrollTop = 0;
    const el = document.createElement('div'); mainEl.appendChild(el);
    try {
      if (t === 'access') Access.render(el); else if (t === 'lectures') Lectures.render(el); else if (t === 'study') Study.render(el); else if (t === 'referral') Rewards.referral(el); else if (t === 'points') Rewards.points(el);
      else if (t === 'planner') Planner.open(el, () => go('lectures'));
    } catch (err) { el.innerHTML = `<div class="wrap">${U.empty('wifi-off', 'This screen could not load — ' + esc(String(err && err.message || err).slice(0, 120)))}<button class="btn block" data-m="reload" style="margin-top:12px">Reload</button></div>`; }
    try { sessionStorage.setItem('sm_tab', t === 'planner' ? 'lectures' : t); } catch (e) {}
  }
  function onClick(e) { const b = e.target.closest('[data-m]'); if (!b) return; const k = b.dataset.m; U.tap(); if (k === 'tab') { autoTab = false; go(b.dataset.v); } else if (k === 'theme') U.theme.toggle(); else if (k === 'support') U.openLink(U.me.config.supportLink); else if (k === 'panel') location.href = '../admin/'; else if (k === 'reload') location.reload(); }
  function whatsapp() { const link = U.me.config.whatsappLink; if (!link || !/^https:\/\//.test(link)) return; let last = 0; try { last = +localStorage.getItem('sm_wa') || 0; } catch (e) {} if (Date.now() - last < 3 * 864e5) return; try { localStorage.setItem('sm_wa', Date.now()); } catch (e) {}
    const ov = U.modal(`<div class="em">🚨</div><h3>Join Our WhatsApp Channel Urgently</h3><p>Agar kal ko humara telegram channels bhi ban kar diya to kya karoge?\n\nDon't worry.\n\nIsliye join our WhatsApp channel too.</p><button class="btn block" data-w="go" style="padding:14.5px;font-size:14px">Click Here To Join</button><button class="btn ghost block" data-w="x" style="margin-top:8.5px;border:0;background:none;color:var(--mu)">Maybe later</button>`); ov.addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (b) { if (b.dataset.w === 'go') U.openLink(link); ov.close(); } }); }
  window.Main = {
    go, afterDraw() {}, setAccessDot(on) { accessOn = !!on; const d = document.getElementById('nbA'); if (d) d.style.display = on ? 'none' : ''; },
    setUnread(n) { unread = n || 0; const d = document.getElementById('nbS'); if (d) { d.style.display = unread ? '' : 'none'; d.textContent = unread > 9 ? '10+' : unread; } const g = document.querySelector('.stabs [data-v=groups]'); },
    setStudyLive(on) { studyLive = on; }, setLevel(l) { U.me.level = l; applyTheme(); const h = document.getElementById('hl'); if (h) h.textContent = l === 'foundation' ? 'CA Foundation' : 'CA Intermediate'; }, tab: () => tab,
  };
  /** Full-screen "join to unlock" gate: level channels with their photo, Join buttons, then Verify. */
  function joinGate(j) {
    return new Promise((done) => {
      const draw = (j, msg) => {
        const ini = (t) => esc((t || '?').trim().charAt(0).toUpperCase());
        $app.innerHTML = `<div class="jg fade"><div class="jg-logo">${ic('shield-check')}</div><h2>Join to unlock</h2><p class="jg-s">${esc(j.levelName || 'Our')} channels ko join karo, phir verify karo.</p>
          <div class="jg-l">${j.channels.map((c, i) => `<div class="jg-c ${c.joined ? 'ok' : ''}"><div class="jg-a">${c.photo ? `<img src="${esc(c.photo)}" alt="">` : ini(c.title)}</div><div class="jg-t"><b>${esc(c.title || 'Channel')}</b><span>${c.joined ? 'Joined' : 'Not joined yet'}</span></div>${c.joined ? `<span class="jg-k">${ic('check')}</span>` : `<button class="jg-j" data-i="${i}">Join</button>`}</div>`).join('')}</div>
          ${msg ? `<div class="jg-m">${esc(msg)}</div>` : ''}<button class="jg-v" id="jgv">${ic('check')} I've Joined — Verify</button></div>`;
        $app.querySelectorAll('.jg-j').forEach((b) => b.addEventListener('click', () => U.openLink(j.channels[+b.dataset.i].url)));
        document.getElementById('jgv').addEventListener('click', async (e) => { e.target.disabled = true; try { const r = await U.A('POST', '/join/verify', {}); if (r.allJoined) { if (window.Ads) await Ads.show(); return done(); } draw(r, 'Abhi sab channels join nahi hue. Join karke dobara verify karo.'); } catch (x) { draw(j, x.message); } });
      };
      draw(j, '');
    });
  }
  async function boot() {
    let th = null; try { th = localStorage.getItem('sm_theme'); } catch (e) {} U.theme.set(th || (TG && TG.colorScheme === 'light' ? 'light' : 'dark'));
    if (TG) { try { TG.ready(); TG.expand(); if (TG.disableVerticalSwipes) TG.disableVerticalSwipes(); if (/[?&]fs=1/.test(location.search) && TG.requestFullscreen) TG.requestFullscreen(); } catch (e) {} }
    if (!TG || !TG.initData) return gate('send', 'Open from Telegram', 'This app works inside the Telegram bot. Open the bot and tap “Open WebApp”.');
    try { U.me = await U.A('GET', '/me'); } catch (e) { return gate(e.status === 403 ? 'lock' : 'wifi-off', e.status === 403 ? 'Account blocked' : 'Could not load', e.message); }
    document.title = U.me.brand; applyScale();
    if (TG && U.me.config.fullscreen === true && TG.requestFullscreen && /android|ios/i.test(TG.platform || '') && !TG.isFullscreen) { try { TG.requestFullscreen(); } catch (e) {} }
    if (window.Ads) Ads.init(U.me.config);
    try { const j = await U.A('GET', '/join'); if (j.required && !j.allJoined) await joinGate(j); } catch (e) { /* never block the app if the check fails */ }
    shell(); Study.boot();
    let first = 'lectures'; try { first = sessionStorage.getItem('sm_tab') || ''; } catch (e) {} autoTab = false;
    if (!first) { // draw something within 1.5 s even if /access is slow; switch to Access afterwards if the student has none
      const p = U.A('GET', '/access'); const a = await Promise.race([p.catch(() => null), new Promise((r) => setTimeout(() => r(undefined), 1500))]);
      if (a === undefined) { first = 'lectures'; autoTab = true; p.then((x) => { Main.setAccessDot(x.active || x.staff); if (autoTab && tab === 'lectures' && !(x.active || x.staff)) go('access'); }).catch(() => {}); }
      else if (a) { Main.setAccessDot(a.active || a.staff); first = a.active || a.staff ? 'lectures' : 'access'; } else first = 'lectures'; }
    go(first); setTimeout(() => { autoTab = false; }, 8000); setTimeout(whatsapp, 1200);
    U.A('GET', '/access').then((a) => { if (window.Access && !Access.state) Access.state = a; Main.setAccessDot(a.active || a.staff); }).catch(() => {});
  }
  boot();
})();
