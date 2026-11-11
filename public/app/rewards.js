/* Referral and Points tabs. */
(function () {
  'use strict';
  const { ic, esc, pl, hm } = U;
  const fmt = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  async function referral(el) {
    el.innerHTML = `<div class="wrap">${U.sk}</div>`; let d; try { d = await U.A('GET', '/referral'); } catch (e) { el.innerHTML = `<div class="wrap">${U.empty('wifi-off', esc(e.message))}</div>`; return; }
    el.innerHTML = `<div class="wrap fade"><div class="rw-hero"><small>YOUR REFERRALS</small><div class="n">${d.count}</div><p>${d.count ? 'Friends who joined using your link' : 'Invite friends and earn rewards'}</p></div>
      <div class="card"><div class="lab" style="margin-top:0">${ic('link')}Your invite link</div><div class="code"><div style="overflow:hidden"><small>LINK</small><b style="font-size:14px;letter-spacing:0;word-break:break-all">${esc(d.link.replace('https://', ''))}</b></div></div><div style="display:flex;gap:10px"><button class="btn" style="flex:1" data-r="share">${ic('share')}Share</button><button class="btn ghost" style="flex:1" data-r="copy">${ic('copy')}Copy</button></div></div>
      <div class="card"><div class="lab" style="margin-top:0">${ic('gift')}How it works</div><div class="stp"><div class="no">1</div><div><b>Share your link</b><span>Send it to friends preparing for CA.</span></div></div><div class="stp"><div class="no">2</div><div><b>They start the bot</b><span>Your friend opens the bot with your link.</span></div></div><div class="stp"><div class="no">3</div><div><b>You both win</b><span>You get <b style="color:var(--g)">+${d.rewardPoints} points</b>${d.rewardHours ? ` and <b style="color:var(--g)">+${d.rewardHours}h access</b>` : ''} for every friend.</span></div></div></div>
      <div class="lab">${ic('users')}Recent referrals</div><div class="card">${d.recent.length ? d.recent.map((r) => `<div class="lg"><span>${esc(r.name)}</span><span class="d">${fmt(r.at)}</span></div>`).join('') : U.empty('user-plus', 'No referrals yet')}</div></div>`;
    el.onclick = (e) => { const b = e.target.closest('[data-r]'); if (!b) return; if (b.dataset.r === 'copy') U.copy(d.link).then((ok) => U.toast(ok ? 'Link copied' : d.link, 'ok')); else U.openLink('https://t.me/share/url?url=' + encodeURIComponent(d.link) + '&text=' + encodeURIComponent(`Watch CA lectures free on ${U.me.brand}! Join with my link:`)); };
  }
  async function points(el) {
    el.innerHTML = `<div class="wrap">${U.sk}</div>`; let d; const load = async () => { d = await U.A('GET', '/points'); };
    const draw = () => { const opts = [1, 3, 6, 12, 24].filter((h) => h * d.perHour > 0); el.innerHTML = `<div class="wrap fade"><div class="rw-hero" style="background:linear-gradient(135deg,#e0861d,#f6b445)"><small>YOUR POINTS</small><div class="n">${d.balance}</div><p>${d.perHour ? `${d.perHour} points = 1 hour of access` : 'Redeeming is currently disabled'}</p></div>
      ${d.perHour ? `<div class="card"><div class="lab" style="margin-top:0">${ic('diamond')}Redeem for access</div><div class="pchips">${opts.map((h) => `<button class="pchip ${h * d.perHour <= d.balance ? '' : ''}" data-r="redeem" data-v="${h}" ${h * d.perHour > d.balance ? 'disabled style="opacity:.45"' : ''}>${h}h <span style="color:var(--mu);font-size:13px">· ${h * d.perHour} pts</span></button>`).join('')}</div><p style="color:var(--mu);font-size:14px">Earn points by inviting friends from the Referral tab.</p></div>` : ''}
      <div class="lab">${ic('history')}History</div><div class="card">${d.log.length ? d.log.map((l) => `<div class="lg"><div><div>${esc(l.reason || 'Points')}</div><div class="d">${fmt(l.at)}</div></div><span class="${l.delta >= 0 ? 'pos' : 'neg'}">${l.delta >= 0 ? '+' : ''}${l.delta}</span></div>`).join('') : U.empty('diamond', 'No points activity yet')}</div></div>`; };
    try { await load(); draw(); } catch (e) { el.innerHTML = `<div class="wrap">${U.empty('wifi-off', esc(e.message))}</div>`; return; }
    el.onclick = async (e) => { const b = e.target.closest('[data-r=redeem]'); if (!b || b.disabled) return; const h = +b.dataset.v; if (!(await U.confirm(`Redeem ${h}h of access?`, `This uses ${h * d.perHour} points.`, 'Redeem'))) return; try { const r = await U.A('POST', '/points/redeem', { hours: h }); d = r.points; U.toast(`+${h}h access added 🎉`, 'ok'); if (window.Main) Main.setAccessDot(true); draw(); } catch (x) { U.fail(x); } };
  }
  window.Rewards = { referral, points };
})();
