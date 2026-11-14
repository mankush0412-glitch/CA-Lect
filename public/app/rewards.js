/* Referral and Points tabs. */
(function () {
  'use strict';
  const { ic, esc, pl, hm } = U;
  const fmt = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  async function referral(el) {
    el.innerHTML = `<div class="wrap">${U.sk}</div>`; let d; try { d = await U.A('GET', '/referral'); } catch (e) { el.innerHTML = `<div class="wrap">${U.empty('wifi-off', esc(e.message))}</div>`; return; }
    const row = (icon, tone, t, sub, pill) => `<div class="ep"><div class="ei ${tone}">${ic(icon)}</div><div class="et"><b>${t}</b><span>${sub}</span></div>${pill ? `<span class="epill">${pill}</span>` : ''}</div>`;
    el.innerHTML = `<div class="wrap fade"><div class="rf-hero"><div class="rf-top"><div><small>YOUR REFERRAL LINK</small><h2>Invite friends, earn points</h2></div><div class="rf-gift">${ic('gift')}</div></div>
      <div class="rf-link">${ic('link')}<code>${esc(d.link)}</code><button data-r="copy">${ic('copy')}Copy</button></div><button class="rf-share" data-r="share">${ic('share')}Share with friends</button></div>
      <div class="rf-stats"><div class="rf-s"><div class="ri">${ic('users')}</div><b>${d.count}</b><span>Total referrals</span></div><div class="rf-s act"><div class="ri">${ic('user-check')}</div><b>${d.active || 0}</b><span>Active referrals</span></div></div>
      <div class="card ep-card"><div class="ep-h"><div class="ei a">${ic('diamond')}</div><h3>How you earn points</h3></div>
        ${row('user-plus', 'p', 'Friend joins via your link', 'They click your link and start the bot.', `+${d.rewardPoints} point${d.rewardPoints === 1 ? '' : 's'}${d.rewardHours ? ` · +${d.rewardHours}h` : ''}`)}
        ${d.activePoints > 0 ? row('book', 'g', 'Friend requests their first chapter', 'They start the bot with your link and request a chapter.', `+${d.activePoints} pts`) : ''}
        ${row('info', 'b', 'Who is an active referral?', 'Anyone who has requested at least 1 chapter.', '')}
        <div class="ep-note">${ic('sparkles')}<span>Collect points and redeem them for access in the Points tab!</span></div></div>
      ${d.recent.length ? `<div class="lab">${ic('users')}Recent referrals</div><div class="card">${d.recent.map((r) => `<div class="lg"><span>${esc(r.name)}</span><span class="d">${fmt(r.at)}</span></div>`).join('')}</div>` : ''}</div>`;
    el.onclick = (e) => { const b = e.target.closest('[data-r]'); if (!b) return; if (b.dataset.r === 'copy') U.copy(d.link).then((ok) => U.toast(ok ? 'Link copied' : d.link, 'ok')); else U.openLink('https://t.me/share/url?url=' + encodeURIComponent(d.link) + '&text=' + encodeURIComponent(`Watch CA lectures free on ${U.me.brand}! Join with my link:`)); };
  }
  const TIER_IC = ['bolt', 'calendar', 'calendar-event', 'crown'];
  function benefits() {
    const cfg = (U.me && U.me.config) || {}; const txt = cfg.premiumInfo && cfg.premiumInfo.trim();
    const ov = U.sheet(`<h3>${ic('crown')} Premium benefits</h3><div class="sub2">${txt ? '' : 'Premium batches are unlocked by the admin after enrolment.'}</div>${txt ? `<div class="card" style="white-space:pre-line;line-height:1.55">${esc(txt)}</div>` : ''}<div class="foot">${cfg.supportLink ? `<button class="btn amber" data-m="support">${ic('headset')}Contact support</button>` : ''}<button class="btn ghost" data-m="x">Close</button></div>`);
    ov.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; if (b.dataset.m === 'support') U.openLink(cfg.supportLink); ov.close(); });
  }
  async function points(el) {
    el.innerHTML = `<div class="wrap">${U.sk}</div>`; let d; const load = async () => { d = await U.A('GET', '/points'); };
    const draw = () => {
      const tiers = d.tiers || []; const nxt = tiers.find((t) => t.points > d.balance); const top = tiers.length ? tiers[tiers.length - 1].points : 0; const pct = (p) => (top ? Math.min(100, (p / top) * 100) : 0);
      const track = tiers.length ? `<div class="pt-track"><div class="pt-line"><i style="width:${Math.min(100, pct(d.balance))}%"></i></div>${tiers.map((t, k) => `<div class="pt-m ${d.balance >= t.points ? 'on' : ''}"><span>${ic(TIER_IC[k % 4])}</span><small>${t.points}</small></div>`).join('')}</div>` : '';
      el.innerHTML = `<div class="wrap fade"><div class="pt-hero"><div class="pt-top"><div><small>POINTS BALANCE</small><div class="pt-n">${d.balance}<span>pts</span></div></div><div class="pt-coin">${ic('diamond')}</div></div>
        ${nxt ? `<div class="pt-next">Next: <b>${esc(nxt.label)}</b> (${nxt.points} pts)</div>` : tiers.length ? '<div class="pt-next"><b>You can redeem every option 🎉</b></div>' : ''}${track}${nxt ? `<div class="pt-go">${ic('trending-up')}${nxt.points - d.balance} pts to go</div>` : ''}</div>
        <div class="card rd"><div class="ep-h"><div class="ei g">${ic('gift')}</div><div><h3>Redeem points</h3><p>Turn your points into access</p></div></div>
          <button class="btn amber block rd-b" data-r="benefits">${ic('crown')}Check Premium Benefits</button>
          ${tiers.map((t, k) => { const ok = d.balance >= t.points; return `<div class="rd-c ${ok ? 'ok' : ''}"><div class="ei ${['g', 'b', 'p', 'a'][k % 4]}">${ic(TIER_IC[k % 4])}</div><div class="et"><b>${esc(t.label)}</b><span>${t.points} pts${ok ? '' : ` — need ${t.points - d.balance} more`}</span>${ok ? '' : `<div class="rd-p"><i style="width:${Math.min(100, d.balance / t.points * 100)}%"></i></div>`}</div><button class="rd-k" data-r="tier" data-v="${t.i}" ${ok ? '' : 'disabled'}>${ic(ok ? 'gift' : 'lock')}${ok ? 'Redeem' : 'Locked'}</button></div>`; }).join('') || (d.perHour ? `<div class="pchips">${[1, 3, 6, 12, 24].filter((h) => h * d.perHour > 0).map((h) => `<button class="pchip" data-r="redeem" data-v="${h}" ${h * d.perHour > d.balance ? 'disabled style="opacity:.45"' : ''}>${h}h <span style="color:var(--mu);font-size:10.5px">· ${h * d.perHour} pts</span></button>`).join('')}</div>` : '<p style="color:var(--mu)">Redeeming is currently disabled.</p>')}</div>
        <div class="lab">${ic('history')}History</div><div class="card">${d.log.length ? d.log.map((l) => `<div class="lg"><div><div>${esc(l.reason || 'Points')}</div><div class="d">${fmt(l.at)}</div></div><span class="${l.delta >= 0 ? 'pos' : 'neg'}">${l.delta >= 0 ? '+' : ''}${l.delta}</span></div>`).join('') : U.empty('diamond', 'No points activity yet')}</div></div>`; };
    try { await load(); draw(); } catch (e) { el.innerHTML = `<div class="wrap">${U.empty('wifi-off', esc(e.message))}</div>`; return; }
    el.onclick = async (e) => { const b = e.target.closest('[data-r]'); if (!b || b.disabled) return; if (b.dataset.r === 'benefits') return benefits(); const tier = b.dataset.r === 'tier'; const t = tier ? d.tiers[+b.dataset.v] : null; const h = +b.dataset.v; if (b.dataset.r !== 'tier' && b.dataset.r !== 'redeem') return;
      if (!(await U.confirm(tier ? `Redeem ${t.label}?` : `Redeem ${h}h of access?`, tier ? `This uses ${t.points} points.` : `This uses ${h * d.perHour} points.`, 'Redeem'))) return;
      try { const r = await U.A('POST', '/points/redeem', tier ? { tier: t.i } : { hours: h }); d = r.points; U.toast(tier ? `${t.label} added 🎉` : `+${h}h access added 🎉`, 'ok'); if (window.Main) Main.setAccessDot(true); draw(); } catch (x) { U.fail(x); } };
  }
  window.Rewards = { referral, points };
})();
