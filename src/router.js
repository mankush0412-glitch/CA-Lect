'use strict';
/**
 * HTTP layer for the management API. Works as Express middleware (app.use('/api/admin', h))
 * and as a plain `http` request listener, so it can be tested without Express.
 * Every route declares the permission it needs; enforcement happens here on the server.
 */
const { verifyInitData, resolveActor, can } = require('./rbac');
const { HttpError } = require('./service');

function createAdminHandler({ service: S, study: ST, ext, store, botToken, ownerId, verify = verifyInitData, prefix = '/api/admin', fallthrough = false }) {
  const routes = [];
  const add = (method, path, perm, fn) => routes.push({ method, perm, fn, keys: [], re: new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, k) => '([^/]+)') + '/?$'), names: [...path.matchAll(/:([a-zA-Z]+)/g)].map(m => m[1]) });
  const G = (p, perm, fn) => add('GET', p, perm, fn), P = (p, perm, fn) => add('POST', p, perm, fn), U = (p, perm, fn) => add('PATCH', p, perm, fn), D = (p, perm, fn) => add('DELETE', p, perm, fn);

  G('/me', null, (c) => ({ id: c.actor.id, name: c.actor.name, role: c.actor.role, perms: [...c.actor.perms], facultyId: c.actor.facultyId }));
  G('/dashboard', 'dashboard.read', (c) => S.dashboard(c.actor));
  G('/analytics', 'analytics.read', (c) => S.analytics.summary(c.actor));
  G('/reports/:what', 'analytics.read', (c) => ({ csv: S.analytics.csv(c.actor, c.p.what), filename: `${c.p.what}-${new Date().toISOString().slice(0, 10)}.csv` }));

  G('/faculties', 'faculty.read', (c) => S.faculty.list(c.actor, c.q));
  G('/faculties/:id', 'faculty.read', (c) => S.faculty.get(c.actor, c.p.id));
  P('/faculties', 'faculty.write', (c) => S.faculty.create(c.actor, c.b));
  U('/faculties/:id', 'faculty.write', (c) => S.faculty.update(c.actor, c.p.id, c.b));
  D('/faculties/:id', 'faculty.write', (c) => S.faculty.remove(c.actor, c.p.id, c.q.force === '1'));

  G('/subjects', 'subject.read', (c) => S.subject.list(c.actor, c.q));
  P('/subjects', 'subject.write', (c) => S.subject.create(c.actor, c.b));
  U('/subjects/:id', 'subject.write', (c) => S.subject.update(c.actor, c.p.id, c.b));
  D('/subjects/:id', 'subject.write', (c) => S.subject.remove(c.actor, c.p.id));

  G('/batches', 'batch.read', (c) => S.batch.list(c.actor, c.q));
  G('/batches/:id', 'batch.read', (c) => S.batch.get(c.actor, c.p.id));
  P('/batches', 'batch.write', (c) => S.batch.create(c.actor, c.b));
  U('/batches/:id', 'batch.write', (c) => S.batch.update(c.actor, c.p.id, c.b));
  P('/batches/:id/status', 'batch.write', (c) => S.batch.setStatus(c.actor, c.p.id, c.b.action));
  P('/batches/:id/duplicate', 'batch.write', (c) => S.batch.duplicate(c.actor, c.p.id));
  D('/batches/:id', 'batch.write', (c) => S.batch.remove(c.actor, c.p.id, c.q.force === '1'));
  G('/batches/:id/students', 'student.read', (c) => S.batch.students(c.actor, c.p.id, c.q));
  P('/batches/:id/assignments', 'batch.write', (c) => S.batch.setAssignment(c.actor, c.p.id, c.b));
  D('/batches/:id/assignments/:aid', 'batch.write', (c) => S.batch.removeAssignment(c.actor, c.p.id, c.p.aid));
  P('/batches/:id/students', 'student.write', (c) => c.b.userIds ? S.student.bulkEnroll(c.actor, c.b.userIds, c.p.id) : S.student.enroll(c.actor, c.b.userId, c.p.id));
  D('/batches/:id/students/:userId', 'student.write', (c) => S.student.unenroll(c.actor, c.p.userId, c.p.id));

  G('/students', 'student.read', (c) => S.student.list(c.actor, c.q));
  G('/students/:userId', 'student.read', (c) => S.student.get(c.actor, c.p.userId));
  P('/students/:userId/block', 'student.block', (c) => S.student.block(c.actor, c.p.userId, c.b.reason));
  P('/students/:userId/unblock', 'student.block', (c) => S.student.unblock(c.actor, c.p.userId));
  P('/students/:userId/transfer', 'student.write', (c) => S.student.transfer(c.actor, c.p.userId, c.b.fromBatchId, c.b.toBatchId));
  P('/students/:userId/access', 'access.write', (c) => c.b.revoke ? S.access.revoke(c.actor, c.p.userId) : S.access.grantHours(c.actor, c.p.userId, c.b.hours));
  G('/access/batch/:id', 'access.write', (c) => S.access.premiumHolders(c.actor, c.p.id));
  P('/access/batch/:id', 'access.write', (c) => S.access.grantBatch(c.actor, c.b.userId, c.p.id));
  D('/access/batch/:id/:userId', 'access.write', (c) => S.access.revokeBatch(c.actor, c.p.userId, c.p.id));

  G('/categories', 'resource.read', () => S.category.list());
  P('/categories', 'category.write', (c) => S.category.create(c.actor, c.b));
  U('/categories/:id', 'category.write', (c) => S.category.update(c.actor, c.p.id, c.b));
  D('/categories/:id', 'category.write', (c) => S.category.remove(c.actor, c.p.id));
  G('/resources', 'resource.read', (c) => S.resource.list(c.actor, c.q));
  G('/resources/:id', 'resource.read', (c) => S.resource.get(c.actor, c.p.id));
  P('/resources', 'resource.write', (c) => S.resource.create(c.actor, c.b));
  P('/resources/bulk-assign', 'resource.write', (c) => S.resource.bulkAssign(c.actor, c.b.ids, c.b.batchId));
  U('/resources/:id', 'resource.write', (c) => S.resource.update(c.actor, c.p.id, c.b));
  D('/resources/:id', 'resource.write', (c) => S.resource.remove(c.actor, c.p.id));

  G('/notifications', 'announcement.read', (c) => S.notification.list(c.actor, c.q));
  P('/notifications', 'announcement.write', (c) => S.notification.create(c.actor, c.b));
  U('/notifications/:id', 'announcement.write', (c) => S.notification.update(c.actor, c.p.id, c.b));
  D('/notifications/:id', 'announcement.write', (c) => S.notification.remove(c.actor, c.p.id));
  G('/notifications/:id/preview', 'announcement.read', (c) => S.notification.preview(c.actor, c.p.id));
  P('/notifications/:id/send', 'announcement.write', (c) => S.notification.send(c.actor, c.p.id));

  G('/payments', 'payment.read', (c) => S.payments.list(c.actor, c.q));
  G('/subscriptions', 'payment.read', () => S.payments.subscriptions());

  G('/admins', 'admins.manage', () => S.admins.list());
  G('/admins/meta', 'admins.manage', () => S.admins.roles());
  P('/admins', 'admins.manage', (c) => S.admins.upsert(c.actor, c.b));
  P('/admins/:userId/active', 'admins.manage', (c) => S.admins.setActive(c.actor, c.p.userId, !!c.b.active));
  D('/admins/:userId', 'admins.manage', (c) => S.admins.remove(c.actor, c.p.userId));

  // Study tracker (live timing, leaderboards, groups moderation)
  G('/study/overview', 'study.read', () => ST.admin.overview());
  G('/study/live', 'study.read', () => ST.admin.live());
  G('/study/groups', 'study.read', () => ST.admin.groups());
  G('/study/groups/:id/messages', 'study.read', (c) => ST.admin.messages(c.p.id));
  G('/study/groups/:id/members', 'study.read', (c) => ST.admin.members(c.p.id));
  D('/study/groups/:id/messages/:mid', 'study.moderate', (c) => { const r = ST.admin.deleteMessage(c.p.id, c.p.mid); S.log(c.actor, 'study.deleteMessage', c.p.id, c.p.mid); return r; });
  D('/study/groups/:id/members/:uid', 'study.moderate', (c) => { const r = ST.admin.removeMember(c.p.id, c.p.uid); S.log(c.actor, 'study.removeMember', c.p.id, c.p.uid); return r; });
  D('/study/groups/:id', 'study.moderate', (c) => { const r = ST.admin.deleteGroup(c.p.id); S.log(c.actor, 'study.deleteGroup', c.p.id); return r; });
  G('/students/:userId/study', 'study.read', (c) => ST.admin.student(c.p.userId));
  P('/students/:userId/study/reset', 'study.moderate', (c) => { const r = ST.admin.resetStudent(c.p.userId); S.log(c.actor, 'study.resetStudent', c.p.userId); return r; });

  G('/config', 'config.read', () => S.config.get());
  U('/config', 'config.write', (c) => S.config.set(c.actor, c.b));
  G('/logs', 'logs.read', (c) => S.logs.list(c.actor, c.q));
  G('/health', 'backup.run', () => S.maintenance.health());
  G('/backup', 'backup.run', (c) => S.maintenance.export(c.actor));
  P('/backup/restore', 'admins.manage', (c) => S.maintenance.restore(c.actor, c.b));
  P('/maintenance/prune-logs', 'backup.run', (c) => S.maintenance.pruneLogs(c.actor, c.b.days));

  if (typeof ext === 'function') ext({ G, P, U, D, S, ST });

  // ── abuse protection ────────────────────────────────────────────────────────
  const hits = new Map(); const idem = new Map();
  function rateLimited(id) { const t = Date.now(), w = (hits.get(id) || []).filter(x => t - x < 60000); w.push(t); hits.set(id, w); if (hits.size > 5000) hits.clear(); return w.length > 240; }
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return resolve(req.body);
      let size = 0; const chunks = [];
      req.on('data', (d) => { size += d.length; if (size > limit) { reject(new HttpError(413, 'Payload too large')); req.destroy(); } else chunks.push(d); });
      req.on('end', () => { if (!chunks.length) return resolve({}); try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(j && typeof j === 'object' ? j : {}); } catch (e) { reject(new HttpError(400, 'Invalid JSON')); } });
      req.on('error', reject);
    });
  }
  function send(res, status, body) { const s = JSON.stringify(body); res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.end(s); }

  return async function handler(req, res, next) {
    const u = new URL(req.url, 'http://x'); let path = u.pathname; if (path.startsWith(prefix)) path = path.slice(prefix.length) || '/';
    const route = routes.map(r => { const m = path.match(r.re); return m && r.method === req.method ? { r, m } : null; }).find(Boolean);
    if (!route) { if (fallthrough && next) return next(); return send(res, 404, { success: false, error: 'Not found' }); }
    try {
      const user = verify(req.headers['x-tg-init-data'], botToken);
      const actor = resolveActor(user, ownerId, store);
      if (!actor) return send(res, user ? 403 : 401, { success: false, error: user ? 'You are not an authorised admin' : 'Unauthorized' });
      if (route.r.perm && !can(actor, route.r.perm)) { service_log_denied(S, actor, req.method, path); return send(res, 403, { success: false, error: 'You do not have permission: ' + route.r.perm }); }
      if (rateLimited(actor.id)) return send(res, 429, { success: false, error: 'Too many requests' });
      const q = Object.fromEntries(u.searchParams.entries()); const p = {}; route.r.names.forEach((n, i) => p[n] = decodeURIComponent(route.m[i + 1]));
      let b = {}; const mutating = req.method !== 'GET';
      if (mutating) b = await readBody(req, path.startsWith('/backup/restore') ? 20e6 : 1.2e6);
      const key = mutating && req.headers['x-request-id'] ? actor.id + ':' + req.headers['x-request-id'] : null;
      if (key && idem.has(key)) { const c = idem.get(key); return send(res, c.status, c.body); }
      const data = await route.r.fn({ actor, p, q, b });
      const body = { success: true, data }; if (key) { idem.set(key, { status: 200, body }); if (idem.size > 2000) idem.delete(idem.keys().next().value); const t = setTimeout(() => idem.delete(key), 15000); if (t.unref) t.unref(); }
      return send(res, 200, body);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { success: false, error: e.message });
      console.error('[admin-api]', e); return send(res, 500, { success: false, error: 'Internal error' });
    }
  };
}
function service_log_denied(S, actor, method, path) { try { S.log(actor, 'security.denied', `${method} ${path}`); } catch (e) {} }

/** Student-facing catalog handler: GET /api/catalog?level=foundation (auth optional; adds enrolled-only batches). */
function createCatalogHandler({ service: S, botToken, verify = verifyInitData }) {
  return (req, res) => {
    try {
      const u = new URL(req.url, 'http://x'); const user = verify(req.headers['x-tg-init-data'], botToken);
      const level = ['foundation', 'intermediate'].includes(u.searchParams.get('level')) ? u.searchParams.get('level') : null;
      const body = JSON.stringify({ success: true, data: S.catalog(user ? user.id : null, level) });
      res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'private, max-age=20'); res.end(body);
    } catch (e) { console.error('[catalog]', e); res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end('{"success":false,"error":"Internal error"}'); }
  };
}
module.exports = { createAdminHandler, createCatalogHandler };
