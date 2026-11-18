'use strict';
/** Multi-account detection: the Mini App reports a browser fingerprint; accounts sharing a device (or IP) are flagged to the owner and listed in the admin panel. */
const WINDOW = 30 * 864e5, KEEP = 45 * 864e5;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function createDevices({ db, tg, cfg, ownerId, isStaff = () => false, now = () => Date.now() }) {
  const q = db.q;
  const name = (id) => { const u = db.user.findOne(String(id)) || {}; return [u.firstName, u.lastName].filter(Boolean).join(' ') || (u.username ? '@' + u.username : 'User ' + id); };
  const line = (id) => `• ${esc(name(id))} · <code>${id}</code>`;

  /* ── IP bans / suspensions ──────────────────────────────────────────────
     "Ban" in the bot = the account AND every IP address we have seen it use; "suspend" = the same, for N days. Stored in kv as ipb:<ip>. */
  const TTL = 60 * 864e5;
  const ipsOf = (uid) => { uid = String(uid); const s = new Set(q('SELECT DISTINCT ip FROM sightings WHERE userId=? AND ip<>\'\' AND at>?').all(uid, now() - TTL).map((r) => r.ip)); const l = db.kv.get('lastip:' + uid); if (l) s.add(l); return [...s]; };
  /** Remembers the latest IP of a student (written only when it changes). */
  function seen(uid, ip) { ip = String(ip || '').slice(0, 60); if (!ip) return; uid = String(uid); if (db.kv.get('lastip:' + uid) !== ip) db.kv.set('lastip:' + uid, ip); }
  function ipState(ip) {
    if (!ip) return null; const raw = db.kv.get('ipb:' + ip); if (!raw) return null; let x = null; try { x = JSON.parse(raw); } catch (e) { return null; }
    if (!x) return null; if (x.until && x.until <= now()) { db.kv.set('ipb:' + ip, ''); return null; } return x;
  }
  /** kind 'ban' (until = 0) or 'suspend' (until = timestamp). Returns the IPs that were blocked. */
  function banIps(uid, { kind = 'ban', reason = '', until = 0, by = '' } = {}) {
    uid = String(uid); if (isStaff(uid)) return []; const ips = ipsOf(uid);
    for (const ip of ips) db.kv.set('ipb:' + ip, JSON.stringify({ uid, kind, reason, until: kind === 'suspend' ? until : 0, at: now(), by }));
    return ips;
  }
  function liftIps(uid) {
    uid = String(uid); let n = 0; for (const r of q("SELECT k, v FROM kv WHERE k LIKE 'ipb:%' AND v<>''").all()) { let x = null; try { x = JSON.parse(r.v); } catch (e) { continue; } if (x && String(x.uid) === uid) { db.kv.set(r.k, ''); n++; } }
    for (const ip of ipsOf(uid)) { if (ipState(ip)) { db.kv.set('ipb:' + ip, ''); n++; } } return n;
  }
  function liftIp(ip) { const had = !!ipState(ip); db.kv.set('ipb:' + ip, ''); return had; }
  /** The block that applies to this student right now (their current IP, or any IP they used before), or null. Staff are never blocked. */
  function blockedByIp(uid, ip) {
    uid = String(uid); if (isStaff(uid)) return null; const cands = new Set([String(ip || '').slice(0, 60), ...ipsOf(uid)]); cands.delete('');
    for (const i of cands) { const s = ipState(i); if (s) return { ...s, ip: i }; } return null;
  }
  function ipList() {
    return q("SELECT k, v FROM kv WHERE k LIKE 'ipb:%' AND v<>''").all().map((r) => { let x = null; try { x = JSON.parse(r.v); } catch (e) { return null; } if (!x || (x.until && x.until <= now())) return null; return { ip: r.k.slice(4), ...x, name: name(x.uid) }; }).filter(Boolean).sort((a, b) => b.at - a.at);
  }

  const kbFor = (tok) => ({ inline_keyboard: [[{ text: '🚫 Ban (all)', callback_data: 'mgb:' + tok }, { text: '🚫 Ban (new one)', callback_data: 'mgn:' + tok }], [{ text: '⏳ Suspend 1d', callback_data: 'mgs:1:' + tok }, { text: '⏳ 3d', callback_data: 'mgs:3:' + tok }, { text: '⏳ 7d', callback_data: 'mgs:7:' + tok }, { text: '⏳ 30d', callback_data: 'mgs:30:' + tok }], [{ text: '✖ Ignore', callback_data: 'mgx:' + tok }]] });
  /** Accounts behind an alert token (the first id is the student who triggered it). */
  const alertIds = (tok) => { try { return JSON.parse(db.kv.get('mg:' + tok) || '[]'); } catch (e) { return []; } };

  async function alertOwner(uid, sameDevice, sameIp) {
    if (!tg || !ownerId) return;
    const parts = [`👥 <b>Possible Multi-Account Detected</b>\n\n👤 ${esc(name(uid))} · <code>${uid}</code>`];
    if (sameDevice.length) parts.push(`🔴 <b>Same Device</b>\n${sameDevice.map(line).join('\n')}`);
    if (sameIp.length) parts.push(`🟡 <b>Same IP</b>\n${sameIp.map(line).join('\n')}`);
    parts.push(`Choose what to do with these accounts. A ban or suspension also blocks the IP addresses they used. Undo with /unban or /unsuspend.`);
    const tok = Math.random().toString(36).slice(2, 10); db.kv.set('mg:' + tok, JSON.stringify([String(uid), ...sameDevice, ...sameIp]));
    try { await tg.sendMessage(ownerId, parts.join('\n\n'), { reply_markup: kbFor(tok) }); } catch (e) { /* owner never opened the bot */ }
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
  return { report, flags, seen, ipsOf, ipState, banIps, liftIps, liftIp, blockedByIp, ipList, alertIds };
}
module.exports = { createDevices };
