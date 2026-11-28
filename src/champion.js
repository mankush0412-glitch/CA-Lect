'use strict';
/**
 * Day-end study champions. Shortly after IST midnight the bot ranks everyone by study time for the day that just ended,
 * sends the Top 10 to every student, and gives the #1 student Ads-Free (no ads, full access) for the configured time.
 * Everything is switchable in the admin panel (Bot config → Champions) and each run is kept as history.
 */
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TZ = 330 * 60000, MEDAL = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const hm = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateTxt = (day) => { const [y, m, d] = day.split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const stamp = (ts) => { const t = new Date(ts + TZ); let h = t.getUTCHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${t.getUTCDate()} ${MON[t.getUTCMonth()]} ${t.getUTCFullYear()}, ${h}:${String(t.getUTCMinutes()).padStart(2, '0')} ${ap}`; };

function createChampion({ db, store, study, pay, sendMessage, cfg, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), webBtn = () => null }) {
  const KIND = 'champion'; let running = false;
  const dayOf = (ts) => new Date(ts + TZ).toISOString().slice(0, 10);
  const prevDay = (day) => new Date(Date.parse(day + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);
  const history = (n = 30) => store.list(KIND).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, n);
  const at = () => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(cfg().championAt || '')); return m ? +m[1] * 60 + +m[2] : 5; };

  const COURSES = [['foundation', 'CA Foundation'], ['intermediate', 'CA Inter'], ['final', 'CA Final']];
  const levelOf = (uid) => { const u = db.user.findOne(String(uid)) || {}; return u.level === 'foundation' || u.level === 'final' ? u.level : 'intermediate'; };
  const until = (b) => stamp(b.until), plural = (rec) => (rec.days === 1 ? '24 hours' : rec.days + ' days');

  /** The message one student gets: the Top 10 of THEIR course (or of everyone when courses are combined) + the other courses' champions. */
  function message(rec, boards, uid, recent) {
    const mine = rec.boards.length === 1 ? rec.boards[0] : rec.boards.find((b) => b.key === levelOf(uid)) || rec.boards[0];
    const full = boards[mine.key] || []; const rank = full.findIndex((r) => r.userId === uid); const win = mine.rows[0]; const won = mine.winnerId && mine.winnerId === uid;
    const lines = mine.rows.map((r, i) => `✅ ${MEDAL[i]} <b>${esc(r.name)}</b> — ${hm(r.seconds)}`).join('\n');
    const scope = rec.boards.length > 1 ? ` · <b>${esc(mine.label)}</b>` : '';
    let prize;
    if (mine.winnerId) {
      prize = won
        ? `\n\n✅ 🎉 <b>Congratulations, ${esc(win.name)}!</b>\nYou studied the most${rec.boards.length > 1 ? ' in ' + esc(mine.label) : ''}, so you have won <b>Premium for ${plural(rec)}</b>.\n✅ No ads, no pop-ups — full access.\n🗓 <b>Valid till:</b> ${until(mine)}`
        : `\n\n✅ 🎉 <b>Congratulations, ${esc(win.name)}!</b>\n<b>${esc(win.name)}</b> studied the most yesterday${rec.boards.length > 1 ? ' in ' + esc(mine.label) : ''} and has won <b>Premium for ${plural(rec)}</b> — no ads, full access — till <b>${until(mine)}</b>.\nStudy more today — you could be next! 🚀`;
    } else prize = `\n\n🎁 Premium goes to the #1 student when they study at least <b>${rec.minMin} minutes</b> — nobody reached that yesterday. Be the first today!`;
    const others = rec.boards.length > 1 ? rec.boards.filter((b) => b.key !== mine.key && b.winnerId) : []; const oth = others.length ? `\n\n🏅 <b>Other courses' champions</b>\n` + others.map((b) => `• ${esc(b.label)} — <b>${esc(b.rows[0].name)}</b> (${hm(b.rows[0].seconds)}) · Premium till ${until(b)}`).join('\n') : '';
    const you = won ? '' : rank >= 0 ? `\n\n📍 <b>Your rank:</b> #${rank + 1} of ${full.length}${rec.boards.length > 1 ? ' in ' + esc(mine.label) : ''} · ${hm(full[rank].seconds)} studied` : '\n\n📍 You did not study that day — start your timer today and make it to the Top 10!';
    const hist = recent.length ? `\n\n🗓 <b>Recent champions</b>\n` + recent.map((h) => { const b = (h.boards || []).find((x) => x.key === mine.key) || (h.boards || [])[0]; return b && b.rows.length ? `• ${dateTxt(h.day)} — <b>${esc(b.rows[0].name)}</b> (${hm(b.rows[0].seconds)})${b.winnerId ? '' : ' — no premium'}` : null; }).filter(Boolean).join('\n') : '';
    return `🏆 <b>Daily Study Champions</b>\n📅 <b>${dateTxt(rec.day)}</b>${scope}\n\n<b>Top ${mine.rows.length} students of the day</b>\n\n${lines}${prize}${oth}${you}${hist}\n\nKeep studying — a new board starts every midnight. 💪`;
  }

  /** Rank `day`, hand out the premium and tell every student. Safe to call twice: a day is only ever processed once (unless force). */
  async function run(day, { force = false, notify = true } = {}) {
    if (running) return { skipped: 'busy' }; day = day || prevDay(dayOf(now()));
    const old = store.get(KIND, day); if (old && !force) return { skipped: 'done', record: old };
    running = true;
    try {
      const c = cfg(); const per = c.championPerLevel !== false; const minMin = Math.max(0, Number(c.championMinMin) || 0), days = Math.max(1, Math.min(7, Number(c.championDays) || 1));
      const defs = per ? COURSES : [['all', 'All courses']]; const full = {}; const boards = [];
      for (const [key, label] of defs) {
        const all = study.dayBoard(day, per ? key : undefined); full[key] = all; const rows = all.slice(0, 10).map((r) => ({ userId: r.userId, name: r.name, seconds: r.seconds }));
        const b = { key, label, rows, students: all.length, winnerId: '', until: 0 };
        if (rows.length && pay && rows[0].seconds >= minMin * 60) {
          const prev = old && (old.boards || []).find((x) => x.key === key);
          if (prev && prev.winnerId === rows[0].userId) { b.winnerId = prev.winnerId; b.until = prev.until; } else { const r = pay.grantAdFree(rows[0].userId, days, 'champion'); b.winnerId = rows[0].userId; b.until = r ? r.until : now() + days * 864e5; }
        }
        boards.push(b);
      }
      const first = boards.find((b) => b.rows.length) || boards[0];
      const rec = { id: day, day, boards, rows: first.rows, winnerId: first.winnerId, until: first.until, students: boards.reduce((n, b) => n + b.students, 0), days, minMin, sent: 0, at: now() };
      store.put(KIND, day, rec);
      if (!boards.some((b) => b.rows.length) || !notify || c.championEnabled === false) return { record: rec, sent: 0 };
      const recent = history(6).filter((h) => h.day < day && h.boards).slice(0, 4);
      const users = db.user.listAll().filter((u) => !db.ban.isBanned(u.userId) && !db.kv.get('rfblk:' + u.userId)); let sent = 0;
      for (const u of users) {
        try { const w = webBtn('🎓 Open WebApp'); await sendMessage(u.userId, message(rec, full, String(u.userId), recent), w ? { reply_markup: { inline_keyboard: [[w]] } } : {}); sent++; } catch (e) { if (/blocked|deactivated|Forbidden|chat not found/i.test((e && e.message) || '')) db.kv.set('rfblk:' + u.userId, '1'); }
        await sleep(45);
      }
      rec.sent = sent; store.put(KIND, day, rec); return { record: rec, sent };
    } finally { running = false; }
  }
  /** Called every 30 s: once the configured IST time has passed, yesterday's board is processed exactly once. */
  async function tick() {
    const c = cfg(); if (c.championEnabled === false) return null; const t = new Date(now() + TZ); const m = t.getUTCHours() * 60 + t.getUTCMinutes(); if (m < at()) return null;
    const day = prevDay(t.toISOString().slice(0, 10)); if (store.get(KIND, day) || db.kv.get('champ:' + day)) return null; db.kv.set('champ:' + day, '1'); return run(day);
  }
  return { run, tick, history, message };
}
module.exports = { createChampion };
