/* App shell: header, bottom navigation, theme, onboarding, popups. */
(function () {
  'use strict';
  const { ic, esc, TG } = U; const $app = document.getElementById('app');
  const NAV = [['access', 'Access', 'shield-check'], ['lectures', 'Lectures', 'play-circle'], ['study', 'Study', 'stopwatch'], ['referral', 'Referral', 'link'], ['points', 'Points', 'diamond']];
  let tab = '', accessOn = false, unread = 0, studyLive = false, mainEl = null;
  function gate(icon, t, msg) { $app.innerHTML = `<div style="margin:auto;text-align:center;padding:30px;max-width:340px">${ic(icon).replace('class="i ', 'style="font-size:56px;color:var(--p)" class="i ')}<h2 style="margin:14px 0 8px">${esc(t)}</h2><p style="color:var(--mu)">${esc(msg)}</p></div>`; }
  function header() { const u = (U.me && U.me.name) || 'S'; const lv = U.me.level; return `<header class="hdr"><div class="av">${esc(Array.from(u)[0] || 'S')}</div><div class="lvl" id="hl">${lv === 'foundation' ? 'CA Foundation' : lv === 'intermediate' ? 'CA Intermediate' : esc(U.me.brand)}</div>${U.me.staff ? `<button class="hb" data-m="panel" aria-label="Admin panel"><span class="b" style="background:var(--p2);box-shadow:0 4px 14px rgba(95,109,240,.35)">${ic('settings')}</span>Panel</button>` : ''}<button class="hb" data-m="theme" aria-label="Toggle theme"><span class="tgl"></span>Theme</button>${U.me.config.supportLink ? `<button class="hb" data-m="support" aria-label="Support"><span class="b">${ic('headset')}</span>Support</button>` : ''}</header>`; }
  function nav() { return `<nav class="nav" aria-label="Main">${NAV.map(([id, l, i]) => `<button data-m="tab" data-v="${id}" class="${tab === id || (id === 'lectures' && tab === 'planner') ? 'on' : ''}" aria-label="${l}">${ic(i)}${l}${id === 'access' ? `<span class="nb" id="nbA" style="${accessOn ? 'display:none' : ''};min-width:10px;height:10px;padding:0;left:calc(50% + 10px);top:4px"></span>` : ''}${id === 'study' ? `<span class="nb" id="nbS" style="${unread ? '' : 'display:none'}">${unread > 9 ? '10+' : unread}</span>` : ''}</button>`).join('')}</nav>`; }
  function shell() { $app.innerHTML = header() + '<main id="main"></main>' + nav(); mainEl = document.getElementById('main'); $app.addEventListener('click', onClick); }
  function go(t) {
    if (tab === t && t !== 'lectures') return; if (tab === 'study' && window.Study) Study.leave(); if (window.Access && tab === 'access') Access.stop(); if (window.Planner && tab === 'planner') Planner.close(); Back.reset();
    tab = t; document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === t || (b.dataset.v === 'lectures' && t === 'planner'))); mainEl.innerHTML = ''; mainEl.scrollTop = 0;
    const el = document.createElement('div'); mainEl.appendChild(el);
    if (t === 'access') Access.render(el); else if (t === 'lectures') Lectures.render(el); else if (t === 'study') Study.render(el); else if (t === 'referral') Rewards.referral(el); else if (t === 'points') Rewards.points(el);
    else if (t === 'planner') Planner.open(el, () => go('lectures'));
    try { sessionStorage.setItem('sm_tab', t === 'planner' ? 'lectures' : t); } catch (e) {}
  }
  function onClick(e) { const b = e.target.closest('[data-m]'); if (!b) return; const k = b.dataset.m; U.tap(); if (k === 'tab') go(b.dataset.v); else if (k === 'theme') U.theme.toggle(); else if (k === 'support') U.openLink(U.me.config.supportLink); else if (k === 'panel') location.href = '../admin/'; }
  function whatsapp() { const link = U.me.config.whatsappLink; if (!link || !/^https:\/\//.test(link)) return; let last = 0; try { last = +localStorage.getItem('sm_wa') || 0; } catch (e) {} if (Date.now() - last < 3 * 864e5) return; try { localStorage.setItem('sm_wa', Date.now()); } catch (e) {}
    const ov = U.modal(`<div class="em">🚨</div><h3>Join Our WhatsApp Channel Urgently</h3><p>Agar kal ko humara telegram channels bhi ban kar diya to kya karoge?\n\nDon't worry.\n\nIsliye join our WhatsApp channel too.</p><button class="btn block" data-w="go" style="padding:18px;font-size:17px">Click Here To Join</button><button class="btn ghost block" data-w="x" style="margin-top:10px;border:0;background:none;color:var(--mu)">Maybe later</button>`); ov.addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (b) { if (b.dataset.w === 'go') U.openLink(link); ov.close(); } }); }
  window.Main = {
    go, afterDraw() {}, setAccessDot(on) { accessOn = !!on; const d = document.getElementById('nbA'); if (d) d.style.display = on ? 'none' : ''; },
    setUnread(n) { unread = n || 0; const d = document.getElementById('nbS'); if (d) { d.style.display = unread ? '' : 'none'; d.textContent = unread > 9 ? '10+' : unread; } const g = document.querySelector('.stabs [data-v=groups]'); },
    setStudyLive(on) { studyLive = on; }, setLevel(l) { U.me.level = l; const h = document.getElementById('hl'); if (h) h.textContent = l === 'foundation' ? 'CA Foundation' : 'CA Intermediate'; }, tab: () => tab,
  };
  async function boot() {
    let th = null; try { th = localStorage.getItem('sm_theme'); } catch (e) {} U.theme.set(th || (TG && TG.colorScheme === 'light' ? 'light' : 'dark'));
    if (TG) { try { TG.ready(); TG.expand(); if (TG.disableVerticalSwipes) TG.disableVerticalSwipes(); if (/[?&]fs=1/.test(location.search) && TG.requestFullscreen) TG.requestFullscreen(); } catch (e) {} }
    if (!TG || !TG.initData) return gate('send', 'Open from Telegram', 'This app works inside the Telegram bot. Open the bot and tap “Open WebApp”.');
    try { U.me = await U.A('GET', '/me'); } catch (e) { return gate(e.status === 403 ? 'lock' : 'wifi-off', e.status === 403 ? 'Account blocked' : 'Could not load', e.message); }
    document.title = U.me.brand; shell(); Study.boot();
    let first = 'lectures'; try { first = sessionStorage.getItem('sm_tab') || ''; } catch (e) {} if (!first) { try { const a = await U.A('GET', '/access'); Main.setAccessDot(a.active || a.staff); first = a.active || a.staff ? 'lectures' : 'access'; } catch (e) { first = 'lectures'; } } go(first); setTimeout(whatsapp, 1200);
    U.A('GET', '/access').then((a) => Main.setAccessDot(a.active || a.staff)).catch(() => {});
  }
  boot();
})();
