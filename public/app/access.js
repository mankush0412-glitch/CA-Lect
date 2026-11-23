/* Access tab: free-access window, ad servers, lecture-quota boosts, today's usage. */
(function () {
  'use strict';
  const { ic, esc, pl } = U; let st = null, at = 0, timer = null, host = null, ps = null;
  const SRV = { tv: ['#6f6df0', 'rgba(111,109,240,.16)'], target: ['#e09b2d', 'rgba(224,155,45,.16)'], book: ['#e09b2d', 'rgba(224,155,45,.16)'], rocket: ['#e09b2d', 'rgba(224,155,45,.16)'], download: ['#2fb67f', 'rgba(47,182,127,.16)'] };
  const left = () => (st ? Math.max(0, st.remainingMs - (Date.now() - at)) : 0);
  const p2 = (n) => String(n).padStart(2, '0');
  function dots(s) { let h = ''; for (let i = 0; i < s.perDay; i++) h += `<i class="${i < s.used ? 'u' : ''}"></i>`; return `<div class="dots">${h}</div>`; }
  function server(s, kind) { const lectures = kind === true || kind === 'lectures', dl = kind === 'dl'; const [c, bg] = SRV[s.icon] || SRV.tv; const limit = s.used >= s.perDay; const sub = dl ? `+${s.extraDownloads} downloads · ${s.used}/${s.perDay} used today` : lectures ? `+${s.extraLectures} lectures · ${s.used}/${s.perDay} used today` : `+${s.hours}h access · ${s.used}/${s.perDay} used today`; return `<div class="srv"><div class="ic" style="background:${bg};color:${c}">${ic(s.icon === 'target' ? 'target' : s.icon === 'book' ? 'book-2' : s.icon === 'rocket' ? 'rocket' : s.icon === 'download' ? 'download' : 'tv')}</div><div class="m"><b>${esc(s.name)}</b><div class="s">${sub}</div>${dots(s)}</div><button class="btn shine ${dl ? 'green' : 'amber'}" data-w="${esc(s.id)}" ${limit ? 'disabled' : ''}>${ic('player-play-filled')}${limit ? 'Done' : 'Watch'}</button></div>`; }
  function html() {
    const on = st.active; const u = st.usage;
    const prem = !!(st.adFree && st.adFree.active);
    const hero = on ? `<div class="ac-hero ac-on" style="color:var(--tx)">${prem ? `<span class="ac-pill" style="background:linear-gradient(135deg,#f5b942,#e8923a);color:#2a1a00">${ic('crown')}Premium member</span><h2 style="margin:8px 0 2px;font-size:19px">You're a Premium user</h2><p style="margin:0 0 6px;color:var(--mu);font-size:12px">No ads · full access · ${(ps && ps.adFree && ps.adFree.dailyLectures) || st.usage.lecturesLimit} lectures a day</p>` : '<span class="ac-pill"><i></i>Access active</span>'}<div class="ac-t">${ic('hourglass')}TIME REMAINING</div><div class="ac-cd"><div><b id="cdH">00</b><span>HRS</span></div><div><b id="cdM">00</b><span>MIN</span></div><div><b id="cdS">00</b><span>SEC</span></div></div><div class="ac-bar"><i id="cdBar" style="width:${st.pct}%"></i></div><div class="ac-sub" id="cdPct">${st.pct}% of this access window left</div></div>`
      : `<div class="ac-hero"><div class="ac-ring">${ic('lock')}</div><h2>No Active Access</h2><p>Watch an ad below to unlock ${st.servers[0] ? st.servers[0].hours : 24} hours of access</p><div class="dn">${ic('arrow-down')}</div></div>`;
    const servers = st.servers.length ? st.servers.map((s) => server(s, false)).join('') : U.empty('tv', 'No ad servers are set up yet.<br>Ask the admin to add one.');
    const afOn = !!(st.adFree && st.adFree.active); const afc = adfreeCard();
    const boost = st.lectureServers.length ? `<div class="ac-sec"><div class="ac-sh"><div class="ic" style="background:rgba(224,155,45,.16);color:#e09b2d">${ic('rocket')}</div><div><b>Increase today's lecture limit</b><span>Need more lectures today? Boost your quota</span></div></div>${st.lectureServers.map((s) => server(s, true)).join('')}</div>` : '';
    const dlSec = (st.downloadServers || []).length ? `<div class="ac-sec"><div class="ac-sh"><div class="ic" style="background:rgba(47,182,127,.16);color:#2fb67f">${ic('download')}</div><div><b>Download lectures</b><span>Save lectures to your phone · ${st.usage.downloadsLeft || 0} downloads left today</span></div></div>${st.downloadServers.map((s) => server(s, 'dl')).join('')}</div>` : '';
    const pctL = u.lecturesLimit ? Math.round(u.lecturesLeft / u.lecturesLimit * 100) : 0; const pctA = u.adsLimit ? Math.round(u.adsWatched / u.adsLimit * 100) : 0;
    return `<div class="fade">${hero}${afc}${afOn ? '' : `<div class="ac-sec"><div class="ac-sh"><div class="ic" style="background:var(--pSoft);color:var(--p)">${ic(on ? 'bolt' : 'lock-open')}</div><div><b>${on ? 'Extend access' : 'Get access'}</b><span>Each server below adds extra hours</span></div></div>${servers}</div>`}${boost}${dlSec}
      <div class="ac-sec"><div class="ac-sh"><div class="ic" style="background:var(--pSoft);color:var(--p)">${ic('chart-bar')}</div><div><b>Today's usage</b></div></div><div class="use"><div><div class="top"><span class="n">${u.lecturesLeft}<small>/${u.lecturesLimit}</small></span>${ic('video')}</div><div class="l">Lectures left</div><div class="prog"><i style="width:${pctL}%"></i></div></div><div><div class="top"><span class="n">${u.adsWatched}<small>/${u.adsLimit}</small></span><span style="color:var(--g)">${ic('tv')}</span></div><div class="l">Ads watched today</div><div class="prog"><i style="width:${pctA}%;background:var(--gradG)"></i></div></div></div>${on || u.adsWatched > 0 ? `<div class="rst"><span>${ic('refresh')} Daily limit resets in</span><b id="rstT">--:--:--</b></div>` : ''}</div>
      ${extras()}
      ${st.staff ? `<div class="chip p" style="margin:0 auto;display:flex;width:max-content">${ic('shield-check')}Staff account · unlimited access</div>` : ''}</div>`;
  }
  /** Paid "Ads-Free" plan: shown when it is on sale or already active. */
  function adfreeCard() {
    const a = ps && ps.adFree; if (!a || (!a.enabled && !a.active)) return '';
    const plans = (a.plans || []).map((p) => `<button class="btn ${a.active ? '' : 'p'}" data-pp="${esc(p.id)}" style="flex:1;min-width:120px">${esc(p.label)} · ₹${p.price}</button>`).join('');
    const till = a.active ? new Date(a.until).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="ac-sec"><div class="ac-sh"><div class="ic" style="background:rgba(47,182,127,.16);color:#2fb67f">${ic('shield-check')}</div><div><b>${a.active ? 'Premium · Ads-Free' : 'Ads-Free plan'}</b><span>${a.active ? 'Renew to add more days' : 'No ads and access for the whole plan'}</span></div></div>${a.active ? `<p style="margin:0 0 8.5px;font-size:12px">✅ Premium active till <b>${till}</b> (IST)</p>` : `<p style="color:var(--mu);margin:0 0 8.5px;font-size:11.5px">Ads dekhe bina padho — plan ke poore time ke liye access milega, ${a.dailyLectures || 0} lectures roz. Payment hote hi apne aap activate.</p>`}${plans ? `<div style="display:flex;gap:7.5px;flex-wrap:wrap">${plans}</div>` : ''}${a.active && plans ? '<p style="color:var(--mu);margin:7px 0 0;font-size:11px">Renew karne par naye din plan ke end me jud jate hain.</p>' : ''}</div>`;
  }
  /** Delivery-bot reminder + optional paid "save pass" (forward / save lectures). */
  function extras() {
    const d = (U.me && U.me.delivery) || {}; let h = '';
    if (d.separate && d.username && !d.started) h += `<div class="ac-sec"><div class="ac-sh"><div class="ic" style="background:var(--pSoft);color:var(--p)">${ic('send')}</div><div><b>Activate lecture delivery</b></div></div><p style="color:var(--mu);margin:0 0 8.5px;font-size:11.5px">Lectures aur notes <b>@${esc(d.username)}</b> bot me aayenge. Ek baar us bot ko Start karo.</p><button class="btn p" data-a="dlv" style="width:100%">Open @${esc(d.username)}</button></div>`;
    if (ps && ps.enabled) h += `<div class="ac-sec"><div class="ac-sh"><div class="ic" style="background:rgba(224,155,45,.16);color:#e09b2d">${ic('download')}</div><div><b>Save pass</b></div></div>${ps.active ? `<p style="margin:0;font-size:12px">✅ Active till ${new Date(ps.until).toLocaleString()}<br><span style="color:var(--mu)">Today: ${ps.left} of ${ps.dailyLimit} saves left</span></p>` : `<p style="color:var(--mu);margin:0 0 8.5px;font-size:11.5px">Lectures forward ya gallery me save karne ke liye pass lo (max ${ps.dailyLimit}/day).</p>`}<div style="display:flex;gap:7.5px;margin-top:8.5px"><button class="btn p" data-pp="day" style="flex:1">${esc(ps.day.label)} · ₹${ps.day.price}</button><button class="btn" data-pp="week" style="flex:1">${esc(ps.week.label)} · ₹${ps.week.price}</button></div></div>`;
    return h;
  }
  function loadRzp() { return new Promise((res, rej) => { if (window.Razorpay) return res(); const sc = document.createElement('script'); sc.src = 'https://checkout.razorpay.com/v1/checkout.js'; sc.onload = res; sc.onerror = () => rej(new Error('Payment window could not load')); document.head.appendChild(sc); }); }
  const afNote = 'Payment mil gaya hai toh 1–2 minute me apne aap activate ho jayega.';
  /** Re-reads the payment state from the server (and, server-side, from Razorpay). Never shows an error to the student. */
  async function afRefresh() { try { const r = await U.A('POST', '/pay/refresh', {}); if (ps && r && r.adFree) ps.adFree = r.adFree; await refresh(true); if (window.U && U.me && r && r.adFree) U.me.adFree = r.adFree.active ? { active: true, until: r.adFree.until } : null; } catch (e) { /* quiet */ } }
  async function buy(plan) {
    const af = /^af_/.test(plan); const lab = af ? 'Ads-Free' : 'Save pass'; let done = false;
    try { const o = await U.A('POST', '/pay/order', { plan }); await loadRzp();
      const rz = new window.Razorpay({ key: o.keyId, amount: o.amount, currency: o.currency, order_id: o.orderId, name: (U.me && U.me.brand) || lab, description: lab + ' · ' + o.label, theme: { color: '#4f8ef7' },
        modal: { ondismiss: () => { if (!done) setTimeout(afRefresh, 2500); } },
        handler: async (r) => { done = true; try { ps = await U.A('POST', '/pay/verify', { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }); await refresh(true); U.toast && U.toast(lab + ' active ✅'); } catch (e) { await afRefresh(); U.toast && U.toast(afNote); } } });
      rz.on && rz.on('payment.failed', () => { U.toast && U.toast('Payment complete nahi hua. Paise kate ho toh wapas aa jayenge — dobara try kar sakte ho.'); });
      rz.open();
    } catch (e) { U.fail(e); }
  }
  function tick() { if (!host || !host.isConnected || !st) return; const rt = $id('rstT'); if (rt) { const n = Date.now() + 330 * 60000; const ms = 864e5 - (n % 864e5); const t = Math.floor(ms / 1000); rt.textContent = p2(Math.floor(t / 3600)) + ':' + p2(Math.floor(t % 3600 / 60)) + ':' + p2(t % 60); } const l = left(); if (st.active) { const s = Math.floor(l / 1000); const h = $id('cdH'); if (h) { h.textContent = p2(Math.floor(s / 3600)); $id('cdM').textContent = p2(Math.floor(s % 3600 / 60)); $id('cdS').textContent = p2(s % 60); const pct = st.windowMs ? Math.min(100, Math.round(l / st.windowMs * 100)) : 0; $id('cdBar').style.width = pct + '%'; $id('cdPct').textContent = pct + '% of this access window left'; } if (l <= 0) refresh(); } }
  const $id = (i) => document.getElementById(i);
  async function refresh(silent) { try { st = await U.A('GET', '/access'); at = Date.now(); Access.state = st; if (window.Main) { Main.setAccessDot(st.active || st.staff); Main.setPremium(!!(st.adFree && st.adFree.active)); } if (host && host.isConnected) { host.innerHTML = html(); tick(); } } catch (e) { if (!silent && host) host.innerHTML = U.empty('wifi-off', esc(e.message), '<br><br><button class="btn" id="acRetry">Retry</button>'); } }
  function waitSheet(info, server) {
    let sec = info.minSeconds; const R = 54, C = 2 * Math.PI * R;
    const ov = U.sheet(`<div class="ad-w"><h3>${esc(server.name)}</h3><div class="sub2">Keep the ad open until the timer ends, then come back and tap Claim.</div><div class="rg"><svg viewBox="0 0 130 130"><circle cx="65" cy="65" r="${R}" fill="none" stroke="var(--line)" stroke-width="10"/><circle id="adArc" cx="65" cy="65" r="${R}" fill="none" stroke="url(#adg)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="0"/><defs><linearGradient id="adg"><stop offset="0" stop-color="#9b8ff0"/><stop offset="1" stop-color="var(--p2)"/></linearGradient></defs></svg><b id="adT">${sec}</b></div><div class="foot"><button class="btn ghost" data-a="reopen">${ic('external')}Open ad again</button><button class="btn green" id="adClaim" disabled>${ic('check')}Claim</button></div></div>`);
    const t = setInterval(() => { sec = Math.max(0, sec - 1); const el = ov.querySelector('#adT'); if (!el) return clearInterval(t); el.textContent = sec; ov.querySelector('#adArc').setAttribute('stroke-dashoffset', C * (1 - sec / info.minSeconds)); if (!sec) { ov.querySelector('#adClaim').disabled = false; ov.querySelector('#adT').innerHTML = ic('check'); clearInterval(t); } }, 1000);
    const oc = ov.close; ov.close = () => { clearInterval(t); oc(); };
    ov.addEventListener('click', async (e) => { if (e.target.closest('[data-a=reopen]')) return U.openLink(info.url); const b = e.target.closest('#adClaim'); if (!b) return; b.disabled = true; try { st = await U.A('POST', '/ad/claim', { token: info.token }); at = Date.now(); ov.close(); granted(server); } catch (err) { U.fail(err); b.disabled = err.status !== 425 ? true : false; } });
  }
  /** Success feedback: green "access is active" banner + refreshed screen. */
  function granted(server) {
    const dl = !server.hours && server.extraDownloads && (st.downloadServers || []).some((x) => x.id === server.id);
    if (server.hours) U.banner('Your access is active', `+${server.hours}h added — enjoy learning`); else if (dl) U.banner('Save quota added', `+${server.extraDownloads} downloads unlocked`); else U.banner('Extra lectures unlocked', `+${server.extraLectures} lectures added today`);
    if (host) { host.innerHTML = html(); tick(); } if (window.Main) Main.setAccessDot(true);
  }
  /** Adsgram first. If it cannot show an ad (no fill / moderation / bad block) → Monetag → access is granted anyway.
      An ad that was shown and skipped never earns access. Students never see ad-network errors. */
  async function runAdsgram(info, server) {
    const t0 = Date.now(); let r = null, err = null; if (info.blockId) { try { r = await Ads.adsgram(info.blockId); } catch (e) { err = e; } } else err = new Error('adsgram-off'); // no Adsgram block set in the admin panel → Monetag directly
    const skipped = () => U.toast('Ad poora dekhna padega access ke liye', 'err');
    if (err && err.skipped) return skipped(); if (!err && !r.done) return skipped();
    if (err) {
      const settle = (since) => new Promise((x) => setTimeout(x, Math.max(0, 2500 - (Date.now() - since)))); // give each ad network 2.5 s so ads are not cut off
      if (info.blockId) await settle(t0); const t1 = Date.now(); const m = await Ads.monetagReward(info.monetagAds || 1); if (m === 'skipped') return skipped(); if (m !== 'done') await settle(t1);
      try { st = await U.A('POST', '/ad/alt', { token: info.token, via: m === 'done' ? 'monetag' : 'fallback' }); at = Date.now(); return granted(server); } catch (e) { return U.fail(e); }
    }
    const wait = info.minSeconds * 1000 - (Date.now() - t0); if (wait > 0) await new Promise((x) => setTimeout(x, wait + 300));
    for (let i = 0; i < 4; i++) { try { st = await U.A('POST', '/ad/claim', { token: info.token }); at = Date.now(); return granted(server); } catch (e) { if (e.status === 425 && i < 3) { await new Promise((x) => setTimeout(x, 1500)); continue; } return U.fail(e); } }
  }
  async function watch(id) {
    const all = st.servers.concat(st.lectureServers, st.downloadServers || []); const s = all.find((x) => x.id === id); if (!s) return;
    try { const info = await U.A('POST', '/ad/start', { serverId: id });
      if (info.provider === 'adsgram') return runAdsgram(info, st.lectureServers.includes(s) || (st.downloadServers || []).includes(s) ? { ...s, hours: 0 } : s);
      U.openLink(info.url); waitSheet(info, st.lectureServers.includes(s) || (st.downloadServers || []).includes(s) ? { ...s, hours: 0 } : s); } catch (e) { U.fail(e); }
  }
  const Access = window.Access = {
    state: null,
    async render(el) { host = el; el.innerHTML = '<div class="wrap">' + U.sk + '</div>'; const w = document.createElement('div'); w.className = 'wrap'; el.innerHTML = ''; el.appendChild(w); host = w; w.innerHTML = U.sk; w.addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (b && !b.disabled) watch(b.dataset.w); if (e.target.closest('#acRetry')) refresh(); const pp = e.target.closest('[data-pp]'); if (pp) buy(pp.dataset.pp); if (e.target.closest('[data-a=dlv]')) U.openLink('https://t.me/' + U.me.delivery.username + '?start=go'); }); if (U.me && U.me.config && (U.me.config.savePass || U.me.config.adFree)) { try { ps = await U.A('GET', '/pay'); } catch (e) { ps = null; } if (ps && ps.adFree && ps.adFree.enabled && !ps.adFree.active) afRefresh(); } await refresh(); clearInterval(timer); timer = setInterval(tick, 1000); },
    buy, refresh, stop() { clearInterval(timer); },
    /** The "Remove Ads" pill: member → Access tab, otherwise a sheet with the plans. */
    promo(goTab) {
      const me = U.me || {}; if (me.adFree && me.adFree.active) return goTab('access');
      const pl = (me.config && me.config.adFreePlans) || []; if (!pl.length) return;
      const per = (p) => (p.id === 'af_week' ? '/week' : p.id === 'af_month' ? '/month' : ' · ' + p.label);
      const ov = U.sheet(`<h3 style="display:flex;align-items:center;gap:7px;color:var(--p)">${ic('sparkles')} Remove Ads<button data-pl="" aria-label="Close" style="margin-left:auto;border:0;background:var(--card2);color:var(--mu);width:30px;height:30px;border-radius:50%;display:grid;place-items:center">${ic('x')}</button></h3><div class="sub2" style="margin-bottom:12px">Koi ambient ad, koi lecture-click ad, koi ad-watch nahi — kuch bhi nahi. Poori app ad-free ho jayegi, plan ke poore time ke liye access ke saath.</div><div style="display:grid;gap:8px">${pl.map((p) => `<button class="btn" data-pl="${U.esc(p.id)}" style="width:100%">₹${p.price}${per(p)}</button>`).join('')}</div>`);
      ov.addEventListener('click', (e) => { const b = e.target.closest('[data-pl]'); if (!b) return; ov.close(); if (b.dataset.pl) buy(b.dataset.pl); });
    },
  };
})();
