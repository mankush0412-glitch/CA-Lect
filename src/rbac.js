'use strict';
const crypto = require('crypto');

const PERMS = [
  'dashboard.read', 'student.read', 'student.write', 'student.block',
  'batch.read', 'batch.write', 'faculty.read', 'faculty.write',
  'subject.read', 'subject.write', 'resource.read', 'resource.write', 'category.write',
  'announcement.read', 'announcement.write', 'payment.read', 'access.write',
  'analytics.read', 'study.read', 'study.moderate', 'admins.manage', 'config.read', 'config.write', 'logs.read', 'backup.run',
];
const ROLE_PERMS = {
  super_admin: ['*'],
  admin: PERMS.filter(p => !['admins.manage'].includes(p)),
  // Faculty: scoped to their own batches/resources on the server (see service scope checks)
  faculty: ['dashboard.read', 'batch.read', 'resource.read', 'resource.write', 'student.read', 'announcement.read'],
  moderator: ['dashboard.read', 'study.read', 'study.moderate', 'student.read', 'student.block', 'announcement.read', 'announcement.write', 'resource.read', 'batch.read'],
  support: ['dashboard.read', 'study.read', 'student.read', 'announcement.read', 'batch.read'],
};
const ROLES = Object.keys(ROLE_PERMS);

function verifyInitData(initData, botToken, { maxAgeSec = 86400 } = {}) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dcs = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expected = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (maxAgeSec && authDate && Date.now() / 1000 - authDate > maxAgeSec) return null;
    const user = JSON.parse(params.get('user') || '{}');
    return user && user.id ? user : null;
  } catch (e) { return null; }
}

/** Resolve the acting admin. OWNER_ID is always super_admin and can never be locked out. */
function resolveActor(user, ownerId, store) {
  if (!user) return null;
  const id = String(user.id);
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || id;
  if (id === String(ownerId)) return { id, name, role: 'super_admin', perms: new Set(['*']), facultyId: null };
  const rec = store.get('admin_user', id);
  if (!rec || rec.active === false) return null;
  const base = new Set(ROLE_PERMS[rec.role] || []);
  (rec.extraPerms || []).forEach(p => PERMS.includes(p) && base.add(p));
  (rec.deniedPerms || []).forEach(p => base.delete(p));
  return { id, name, role: rec.role, perms: base, facultyId: rec.facultyId || null };
}
const can = (actor, perm) => !!actor && (actor.perms.has('*') || actor.perms.has(perm));

module.exports = { PERMS, ROLES, ROLE_PERMS, verifyInitData, resolveActor, can };
