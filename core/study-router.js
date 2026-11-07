'use strict';
/** Student-facing study API (/api/study/*). The user is ALWAYS taken from the signed Telegram initData. */
const { verifyInitData } = require('./rbac');
const { HttpError } = require('./service');

function createStudyHandler({ study: S, botToken, banDb, sendMessage, verify = verifyInitData, prefix = '/api/study' }) {
  const routes = []; const add = (m, p, fn) => routes.push({ m, fn, names: [...p.matchAll(/:([a-zA-Z]+)/g)].map((x) => x[1]), re: new RegExp('^' + p.replace(/:([a-zA-Z]+)/g, '([^/]+)') + '/?$') });
  const G = (p, fn) => add('GET', p, fn), P = (p, fn) => add('POST', p, fn), U = (p, fn) => add('PATCH', p, fn);
  const lv = (c) => (c.q.level === 'foundation' ? 'foundation' : 'intermediate');
  G('/state', (c) => S.state(c.uid, lv(c))); P('/start', (c) => S.start(c.uid, c.b.subject, lv(c))); P('/beat', (c) => S.beat(c.uid, lv(c))); P('/stop', (c) => S.stop(c.uid, lv(c)));
  G('/leaderboard', (c) => S.leaderboard(c.uid, c.q.period || 'today')); G('/live', (c) => S.liveNow(c.uid));
  G('/recap', (c) => S.recap(c.uid, c.q.period || 'week', c.q.ref)); G('/history', (c) => S.history(c.uid, c.q.month)); G('/day', (c) => S.dayDetail(c.uid, c.q.day)); G('/badges', (c) => S.badges(c.uid));
  G('/profile', (c) => S.profile.get(c.uid, lv(c))); U('/profile', (c) => S.profile.update(c.uid, c.b));
  P('/recap/send', async (c) => { if (!sendMessage) throw new HttpError(503, 'Bot messaging is not available'); const r = S.recap(c.uid, ['day', 'week', 'month', 'all'].includes(c.b.period) ? c.b.period : 'week'); const hm = (x) => (x >= 3600 ? Math.floor(x / 3600) + 'h ' + Math.floor(x % 3600 / 60) + 'm' : Math.floor(x / 60) + 'm');
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const text = `📊 <b>Your ${esc(r.period)} recap</b> · ${esc(r.label)}\n\n⏱ Total: <b>${hm(r.totalSeconds)}</b>\n📅 Days active: <b>${r.daysActive}/${r.daysInRange}</b>\n📈 Avg/day: <b>${hm(r.avgSeconds)}</b>\n🎯 Goals hit: <b>${r.goalsHit}</b>` + (r.subjects.length ? '\n\n' + r.subjects.slice(0, 6).map((x) => `• ${esc(x.name)} — ${hm(x.seconds)}`).join('\n') : '');
    await sendMessage(c.uid, text); return { sent: true }; });
  P('/clear-today', (c) => S.profile.clearToday(c.uid)); P('/delete-all', (c) => { if (c.b.confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm'); return S.profile.deleteAll(c.uid); });
  G('/groups', (c) => S.groups.list(c.uid, lv(c))); G('/groups/unread', (c) => ({ unread: S.groups.unread(c.uid) })); P('/groups', (c) => S.groups.create(c.uid, c.b));
  P('/groups/join', (c) => S.groups.joinByCode(c.uid, c.b.code)); P('/groups/:id/join', (c) => S.groups.joinPublic(c.uid, c.p.id));
  G('/groups/:id', (c) => S.groups.info(c.uid, c.p.id, c.q.period || 'today')); P('/groups/:id/leave', (c) => S.groups.leave(c.uid, c.p.id));
  G('/groups/:id/messages', (c) => S.groups.messages(c.uid, c.p.id, c.q.after)); P('/groups/:id/messages', (c) => S.groups.post(c.uid, c.p.id, c.b));
  const hits = new Map();
  const limited = (id) => { const t = Date.now(), w = (hits.get(id) || []).filter((x) => t - x < 60000); w.push(t); hits.set(id, w); if (hits.size > 8000) hits.clear(); return w.length > 150; };
  const send = (res, st, body) => { res.statusCode = st; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
  const body = (req) => new Promise((resolve, reject) => { if (req.body && typeof req.body === 'object') return resolve(req.body); let n = 0; const ch = []; req.on('data', (d) => { n += d.length; if (n > 20000) { reject(new HttpError(413, 'Too large')); req.destroy(); } else ch.push(d); }); req.on('end', () => { try { resolve(ch.length ? JSON.parse(Buffer.concat(ch).toString()) : {}); } catch (e) { reject(new HttpError(400, 'Invalid JSON')); } }); req.on('error', reject); });
  return async (req, res) => {
    const u = new URL(req.url, 'http://x'); let path = u.pathname; if (path.startsWith(prefix)) path = path.slice(prefix.length) || '/';
    let hit = null; for (const r of routes) { const m = r.m === req.method && path.match(r.re); if (m) { hit = { r, m }; break; } }
    if (!hit) return send(res, 404, { success: false, error: 'Not found' });
    try {
      const user = verify(req.headers['x-tg-init-data'], botToken, { maxAgeSec: 7 * 86400 }); if (!user) return send(res, 401, { success: false, error: 'Unauthorized' });
      const uid = String(user.id); if (banDb && banDb.isBanned(uid)) return send(res, 403, { success: false, error: 'Your account is blocked' }); if (limited(uid)) return send(res, 429, { success: false, error: 'Too many requests' });
      const p = {}; hit.r.names.forEach((n, i) => { p[n] = decodeURIComponent(hit.m[i + 1]); });
      const b = req.method === 'GET' ? {} : await body(req); const data = await hit.r.fn({ uid, p, q: Object.fromEntries(u.searchParams), b }); return send(res, 200, { success: true, data });
    } catch (e) { if (e instanceof HttpError) return send(res, e.status, { success: false, error: e.message }); console.error('[study-api]', e); return send(res, 500, { success: false, error: 'Internal error' }); }
  };
}
module.exports = { createStudyHandler };
