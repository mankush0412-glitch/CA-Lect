'use strict';
/** Multi-account detection: the Mini App reports a browser fingerprint; accounts sharing a device (or IP) are flagged to the owner and listed in the admin panel. */
const WINDOW = 30 * 864e5, KEEP = 45 * 864e5;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function createDevices({ db, tg, cfg, ownerId, isStaff = () => false, now = () => Date.now() }) {
  const q = db.q;
  const name = (id) => { const u = db.user.findOne(String(id)) || {}; return [u.firstName, u.lastName].filter(Boolean).join(' ') || (u.username ? '@' + u.username : 'User ' + id); };
  const line = (id) => `• ${esc(name(id))} · <code>${id}</code>`;

  async function alertOwner(uid, sameDevice, sameIp) {
    if (!tg || !ownerId) return;
    const parts = [`👥 <b>Possible Multi-Account Detected</b>\n\n👤 ${esc(name(uid))} · <code>${uid}</code>`];
    if (sameDevice.length) parts.push(`🔴 <b>Same Device</b>\n${sameDevice.map(line).join('\n')}`);
    if (sameIp.length) parts.push(`🟡 <b>Same IP</b>\n${sameIp.map(line).join('\n')}`);
    parts.push(`Ban with /ban &lt;id&gt; &lt;reason&gt; or open Admin → Students → Multi-account.`);
    try { await tg.sendMessage(ownerId, parts.join('\n\n')); } catch (e) { /* owner never opened the bot */ }
  }

  /** Records one sighting; returns the other accounts linked to this one. Alerts the owner only for links that are new. */
  async function report(uid, fp, ip) {
    uid = String(uid); fp = String(fp || '').slice(0, 80); ip = String(ip || '').slice(0, 60);
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(fp)) return { ok: false };
    if (cfg().deviceAlerts === false || isStaff(uid) || db.ban.isBanned(uid)) return { ok: true };
    const t = now(); q('INSERT INTO sightings(userId,fp,ip,at) VALUES(?,?,?,?) ON CONFLICT(userId,fp,ip) DO UPDATE SET at=excluded.at').run(uid, fp, ip, t);
    if (Math.random() < 0.02) { q('DELETE FROM sightings WHERE at<?').run(t - KEEP); q('DELETE FROM multi_pairs WHERE at<?').run(t - KEEP); }
    const since = t - WINDOW; const ids = (rows) => rows.map((r) => r.userId).filter((x) => x !== uid && !isStaff(x) && !db.ban.isBanned(x));
    const dev = ids(q('SELECT DISTINCT userId FROM sightings WHERE fp=? AND at>?').all(fp, since));
    const same = ip ? ids(q('SELECT DISTINCT userId FROM sightings WHERE ip=? AND at>?').all(ip, since)).filter((x) => !dev.includes(x)) : [];
    const fresh = (list, kind) => list.filter((o) => { const [a, b] = uid < o ? [uid, o] : [o, uid]; return q('INSERT OR IGNORE INTO multi_pairs(a,b,kind,at) VALUES(?,?,?,?)').run(a, b, kind, t).changes > 0; });
    const nd = fresh(dev, 'device'), ni = fresh(same, 'ip');
    if (nd.length || ni.length) await alertOwner(uid, nd, ni);
    return { ok: true, linked: dev.length + same.length };
  }

  /** Admin list: pairs seen in the last 30 days, device matches first. */
  function flags() {
    const rows = q('SELECT a,b,kind,at FROM multi_pairs WHERE at>? ORDER BY (kind=\'device\') DESC, at DESC LIMIT 200').all(now() - WINDOW);
    return rows.filter((r) => !db.ban.isBanned(r.a) || !db.ban.isBanned(r.b)).map((r) => ({ a: r.a, aName: name(r.a), aBanned: db.ban.isBanned(r.a), b: r.b, bName: name(r.b), bBanned: db.ban.isBanned(r.b), kind: r.kind, at: r.at }));
  }
  return { report, flags };
}
module.exports = { createDevices };
