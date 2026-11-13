'use strict';
const crypto = require('crypto');
const { EntityStore } = require('./entity-store');
const { ROLES, PERMS } = require('./rbac');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const nf = (m) => new HttpError(404, m);
const forbidden = (m = 'Forbidden') => new HttpError(403, m);

const LEVELS = ['foundation', 'intermediate'];
const BATCH_STATUS = ['upcoming', 'active', 'completed', 'archived'];
const BATCH_TYPES = ['regular', 'fastrack'];
const RES_TYPES = ['pdf', 'document', 'image', 'notes', 'link', 'other'];
const CONFIG_KEYS = {
  botName: 120, supportLink: 300, whatsappLink: 300, channelLink: 300, backupChannelLink: 300,
  proTipEnabled: 'bool', themeSkin: 8, uiScale: 'int', newFacultyDays: 'int', cleanChat: 'bool', pinHowTo: 'bool', adsgramBlockId: 40, adsgramVerify: 'bool', monetagEnabled: 'bool', monetagInApp: 'bool', monetagZoneId: 16, monetagLectureEvery: 'int', protectContent: 'bool', lectureDeleteHours: 'int', supportHandle: 40, defaultLevel: 'level',
  dailyLectureLimit: 'int', dailyAdLimit: 'int', minAdSeconds: 'int', maxAccessHours: 'int', referralHours: 'int', referralPoints: 'int', pointsPerHour: 'int',
  welcomeText: 1000, premiumInfo: 1500, howToUrl: 300, testSeriesUrl: 300, testSeriesEnabled: 'bool', testSeriesItems: 'tests', fullscreen: 'bool', joinChannels: 'json', joinChannelsFoundation: 'json', joinChannelsIntermediate: 'json', grantText: 800, howToCaption: 300, savePassEnabled: 'bool', savePassDayPrice: 'int', savePassWeekPrice: 'int', savePassDailyLimit: 'int',
};

const str = (v, max = 200, { req = false, name = 'field' } = {}) => {
  if (v === undefined || v === null) { if (req) throw bad(`${name} is required`); return ''; }
  const s = String(v).trim();
  if (req && !s) throw bad(`${name} is required`);
  if (s.length > max) throw bad(`${name} is too long (max ${max})`);
  return s;
};
const oneOf = (v, list, name, def) => { if (v === undefined || v === '') return def; if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}`); return v; };
const initialsOf = (n) => n.replace(/^(CA|Prof|Dr|Mr|Ms)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'NA';
const norm = (s) => String(s || '').trim().toLowerCase();
const dateOrNull = (v, name) => { if (!v) return null; const t = Date.parse(v); if (isNaN(t)) throw bad(`${name} is not a valid date`); return new Date(t).toISOString().slice(0, 10); };
const COLORS = ['#7c6fe0', '#2f7cc4', '#e09b2d', '#3f9b5a', '#c4466e', '#2f9e8f'];

function paginate(arr, page = 1, size = 20) {
  size = Math.min(Math.max(parseInt(size) || 20, 1), 100); page = Math.max(parseInt(page) || 1, 1);
  return { items: arr.slice((page - 1) * size, page * size), total: arr.length, page, pages: Math.max(Math.ceil(arr.length / size), 1), size };
}

function createService(deps) {
  const { store, batchDb, userDb, banDb, accessDb, announcementDb } = deps;
  const now = deps.now || (() => Date.now());
  const uid = () => EntityStore.newId();

  // ── scope helpers (faculty accounts only see their own batches) ──────────────
  const metaOf = (bid) => store.get('batchmeta', bid) || {};
  const assignments = () => store.list('assignment');
  function facultyBatchIds(facultyId) {
    const ids = new Set();
    store.list('batchmeta').forEach(m => { if (m.facultyId === facultyId) ids.add(m.id); });
    assignments().forEach(a => { if (a.facultyId === facultyId) ids.add(a.batchId); });
    return ids;
  }
  const isScoped = (actor) => actor.role === 'faculty';
  function assertBatch(actor, bid) {
    const b = batchDb.getOne(bid);
    if (!b) throw nf('Batch not found');
    if (isScoped(actor) && !(actor.facultyId && facultyBatchIds(actor.facultyId).has(bid))) throw forbidden('This batch is not assigned to you');
    return b;
  }
  const enrollments = () => store.list('enrollment');
  const enrolledCount = (bid, all = enrollments()) => all.filter(e => e.batchId === bid).length;

  function log(actor, action, target = '', detail = '') {
    store.put('log', uid(), { at: now(), actorId: actor ? actor.id : 'system', actorName: actor ? actor.name : 'system', role: actor ? actor.role : 'system', action, target: String(target).slice(0, 120), detail: String(detail).slice(0, 400) });
  }

  // ── Faculty ──────────────────────────────────────────────────────────────────
  function facultyRow(f, metas, asg) {
    const bids = new Set(metas.filter(m => m.facultyId === f.id).map(m => m.id));
    asg.filter(a => a.facultyId === f.id).forEach(a => bids.add(a.batchId));
    const subs = new Set(asg.filter(a => a.facultyId === f.id).map(a => a.subjectName));
    bids.forEach(bid => (batchDb.getOne(bid)?.subjects || []).forEach(s => subs.add(s.name)));
    return { ...f, batchCount: bids.size, subjects: [...subs] };
  }
  const faculty = {
    list(actor, q = {}) {
      const metas = store.list('batchmeta'), asg = assignments();
      let rows = store.list('faculty');
      if (isScoped(actor)) rows = rows.filter(f => f.id === actor.facultyId);
      if (q.status) rows = rows.filter(f => f.status === q.status);
      if (q.q) rows = rows.filter(f => norm(f.name).includes(norm(q.q)));
      return paginate(rows.map(f => facultyRow(f, metas, asg)), q.page, q.size || 50);
    },
    get(actor, id) {
      const f = store.get('faculty', id); if (!f) throw nf('Faculty not found');
      if (isScoped(actor) && f.id !== actor.facultyId) throw forbidden();
      const metas = store.list('batchmeta'), asg = assignments();
      const batchIds = new Set(metas.filter(m => m.facultyId === id).map(m => m.id)); asg.filter(a => a.facultyId === id).forEach(a => batchIds.add(a.batchId));
      const batches = [...batchIds].map(bid => { const b = batchDb.getOne(bid); return b && { id: bid, name: b.name, status: metaOf(bid).status || 'active', students: enrolledCount(bid) }; }).filter(Boolean);
      return { ...facultyRow(f, metas, asg), batches };
    },
    create(actor, b) {
      const name = str(b.name, 80, { req: true, name: 'name' });
      if (store.list('faculty').some(f => norm(f.name) === norm(name))) throw bad('A faculty with this name already exists');
      const pic = str(b.pic, 300000);
      if (pic && !/^data:image\/(png|jpe?g|webp);base64,/.test(pic) && !/^https:\/\//.test(pic)) throw bad('pic must be an https URL or an image data URI');
      const id = uid();
      const f = store.put('faculty', id, { name, initials: str(b.initials, 3) || initialsOf(name), color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : COLORS[store.count('faculty') % COLORS.length], bio: str(b.bio, 1000), institute: str(b.institute, 40), pic, order: Math.max(0, Math.min(9999, parseInt(b.order) || 0)), status: oneOf(b.status, ['active', 'inactive'], 'status', 'active'), createdAt: now() });
      log(actor, 'faculty.create', name, id); return f;
    },
    update(actor, id, b) {
      const f = store.get('faculty', id); if (!f) throw nf('Faculty not found');
      const n = { ...f };
      if (b.name !== undefined) { n.name = str(b.name, 80, { req: true, name: 'name' }); if (store.list('faculty').some(x => x.id !== id && norm(x.name) === norm(n.name))) throw bad('A faculty with this name already exists'); }
      if (b.initials !== undefined) n.initials = str(b.initials, 3) || initialsOf(n.name);
      if (b.bio !== undefined) n.bio = str(b.bio, 1000);
      if (b.institute !== undefined) n.institute = str(b.institute, 40);
      if (b.order !== undefined) n.order = Math.max(0, Math.min(9999, parseInt(b.order) || 0));
      if (b.color !== undefined && /^#[0-9a-f]{6}$/i.test(b.color)) n.color = b.color;
      if (b.pic !== undefined) { const p = str(b.pic, 300000); if (p && !/^data:image\/(png|jpe?g|webp);base64,/.test(p) && !/^https:\/\//.test(p)) throw bad('Invalid pic'); n.pic = p; }
      if (b.status !== undefined) n.status = oneOf(b.status, ['active', 'inactive'], 'status');
      store.put('faculty', id, n); log(actor, 'faculty.update', n.name, id); return n;
    },
    remove(actor, id, force) {
      const f = store.get('faculty', id); if (!f) throw nf('Faculty not found');
      const metas = store.list('batchmeta').filter(m => m.facultyId === id), asg = assignments().filter(a => a.facultyId === id);
      if ((metas.length || asg.length) && !force) throw new HttpError(409, `Faculty is assigned to ${new Set([...metas.map(m => m.id), ...asg.map(a => a.batchId)]).size} batch(es). Reassign first or delete with force.`);
      metas.forEach(m => store.put('batchmeta', m.id, { ...m, facultyId: null }));
      asg.forEach(a => store.del('assignment', a.id));
      store.list('admin_user').filter(a => a.facultyId === id).forEach(a => store.put('admin_user', a.id, { ...a, facultyId: null }));
      store.del('faculty', id); log(actor, 'faculty.delete', f.name, id); return { deleted: true };
    },
  };

  // ── Subjects (catalogue used by the student subject grid) ────────────────────
  const subject = {
    list(actor, q = {}) {
      let rows = store.list('subject');
      if (q.level) rows = rows.filter(s => s.level === q.level);
      if (q.status) rows = rows.filter(s => s.status === q.status);
      if (q.q) rows = rows.filter(s => norm(s.name).includes(norm(q.q)));
      const bs = batchDb.getAll();
      rows = rows.map(s => {
        const hit = bs.filter(b => (b.subjects || []).some(x => norm(x.name) === norm(s.name)));
        const asg = assignments().filter(a => norm(a.subjectName) === norm(s.name));
        const facs = new Set(hit.map(b => metaOf(b._id).facultyId).filter(Boolean)); asg.forEach(a => facs.add(a.facultyId));
        return { ...s, batchCount: hit.length, facultyCount: facs.size };
      }).sort((a, b) => (a.order || 0) - (b.order || 0));
      return paginate(rows, q.page, q.size || 100);
    },
    create(actor, b) {
      const name = str(b.name, 60, { req: true, name: 'name' }); const level = oneOf(b.level, LEVELS, 'level', 'intermediate');
      if (store.list('subject').some(s => norm(s.name) === norm(name) && s.level === level)) throw bad('Subject already exists for this level');
      const s = store.put('subject', uid(), { name, level, icon: str(b.icon, 4) || '📘', color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : COLORS[store.count('subject') % COLORS.length], description: str(b.description, 500), status: 'active', order: b.order !== undefined && b.order !== '' ? (parseInt(b.order) || 0) : store.count('subject'), createdAt: now() });
      log(actor, 'subject.create', name, s.id); return s;
    },
    update(actor, id, b) {
      const s = store.get('subject', id); if (!s) throw nf('Subject not found'); const n = { ...s };
      if (b.name !== undefined) n.name = str(b.name, 60, { req: true, name: 'name' });
      if (b.level !== undefined) n.level = oneOf(b.level, LEVELS, 'level');
      if (b.icon !== undefined) n.icon = str(b.icon, 4) || n.icon;
      if (b.description !== undefined) n.description = str(b.description, 500);
      if (b.color !== undefined && /^#[0-9a-f]{6}$/i.test(b.color)) n.color = b.color;
      if (b.status !== undefined) n.status = oneOf(b.status, ['active', 'archived'], 'status');
      if (b.order !== undefined) n.order = parseInt(b.order) || 0;
      if (store.list('subject').some(x => x.id !== id && norm(x.name) === norm(n.name) && x.level === n.level)) throw bad('Subject already exists for this level');
      store.put('subject', id, n); log(actor, 'subject.update', n.name, id); return n;
    },
    remove(actor, id) {
      const s = store.get('subject', id); if (!s) throw nf('Subject not found');
      const used = batchDb.getAll().some(b => (b.subjects || []).some(x => norm(x.name) === norm(s.name)));
      if (used) throw new HttpError(409, 'Subject is used by batches. Archive it instead.');
      store.del('subject', id); log(actor, 'subject.delete', s.name, id); return { deleted: true };
    },
  };

  // ── Batches ──────────────────────────────────────────────────────────────────
  function batchRow(b, all) {
    const m = metaOf(b._id); const chapters = (b.subjects || []).reduce((a, s) => a + (s.chapters || []).length, 0);
    const lectures = (b.subjects || []).reduce((a, s) => a + (s.chapters || []).reduce((x, c) => x + (c.lectures || []).length + (c.units || []).reduce((y, u) => y + (u.lectures || []).length, 0), 0), 0);
    const fac = m.facultyId ? store.get('faculty', m.facultyId) : null;
    return { id: String(b._id), name: b.name, description: b.description || '', isPublic: !!b.isPublic, isPremium: !!b.isPremium, price: b.price || 0, level: m.level || 'intermediate', order: m.order || 0, color: m.color || '', type: m.type || 'regular', institute: m.institute || '', label: m.label || '', startDate: m.startDate || null, endDate: m.endDate || null, status: m.status || 'active', visibility: m.visibility || 'public', facultyId: m.facultyId || null, facultyName: fac ? fac.name : null, subjects: (b.subjects || []).length, chapters, lectures, students: enrolledCount(String(b._id), all) };
  }
  const batch = {
    list(actor, q = {}) {
      const all = enrollments(); let ids = isScoped(actor) ? facultyBatchIds(actor.facultyId) : null;
      let rows = batchDb.getAll().filter(b => !ids || ids.has(String(b._id))).map(b => batchRow(b, all));
      if (q.status) rows = rows.filter(r => r.status === q.status); else if (!q.includeArchived) rows = rows.filter(r => r.status !== 'archived');
      if (q.level) rows = rows.filter(r => r.level === q.level);
      if (q.facultyId) rows = rows.filter(r => r.facultyId === q.facultyId);
      if (q.type) rows = rows.filter(r => r.type === q.type);
      if (q.q) rows = rows.filter(r => norm(r.name + ' ' + r.label + ' ' + (r.facultyName || '')).includes(norm(q.q)));
      return paginate(rows, q.page, q.size || 20);
    },
    get(actor, id) {
      const b = assertBatch(actor, id); const row = batchRow(b, enrollments());
      const asg = assignments().filter(a => a.batchId === id).map(a => ({ ...a, facultyName: (store.get('faculty', a.facultyId) || {}).name }));
      const faculties = [...new Map([row.facultyId && [row.facultyId, row.facultyName], ...asg.map(a => [a.facultyId, a.facultyName])].filter(Boolean)).entries()].map(([fid, name]) => ({ id: fid, name }));
      const resources = store.list('resource').filter(r => (r.batchIds || []).includes(id)).length;
      return { ...row, faculties, assignments: asg, subjectList: (b.subjects || []).map(s => ({ id: String(s._id), name: s.name, chapters: (s.chapters || []).length })), resources };
    },
    _applyMeta(id, b, base = {}) {
      const m = { ...base };
      if (b.level !== undefined) m.level = oneOf(b.level, LEVELS, 'level');
      if (b.type !== undefined) m.type = oneOf(b.type, BATCH_TYPES, 'type');
      if (b.institute !== undefined) m.institute = str(b.institute, 40);
      if (b.label !== undefined) m.label = str(b.label, 40);
      if (b.order !== undefined) m.order = Math.max(0, Math.min(9999, parseInt(b.order) || 0));
      if (b.color !== undefined) m.color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '';
      if (b.startDate !== undefined) m.startDate = dateOrNull(b.startDate, 'startDate');
      if (b.endDate !== undefined) m.endDate = dateOrNull(b.endDate, 'endDate');
      if (m.startDate && m.endDate && m.endDate < m.startDate) throw bad('endDate must be after startDate');
      if (b.status !== undefined) m.status = oneOf(b.status, BATCH_STATUS, 'status');
      if (b.visibility !== undefined) m.visibility = oneOf(b.visibility, ['public', 'enrolled'], 'visibility');
      if (b.facultyId !== undefined) { if (b.facultyId && !store.get('faculty', b.facultyId)) throw bad('Unknown faculty'); m.facultyId = b.facultyId || null; }
      return m;
    },
    create(actor, b) {
      const name = str(b.name, 120, { req: true, name: 'name' });
      if (batchDb.getAll().some(x => norm(x.name) === norm(name))) throw bad('A batch with this name already exists');
      const id = crypto.randomBytes(12).toString('hex'); // valid MongoDB ObjectId string
      const price = Number(b.price || 0); if (!(price >= 0) || price > 1e6) throw bad('Invalid price');
      const doc = { _id: id, name, pic: '', description: str(b.description, 1000), order: batchDb.getAll().length, isPublic: !!b.isPublic, isPremium: !!b.isPremium, referralsRequired: 5, unlockDurationHours: 168, premiumUsers: [], price, rewardEligible: true, redeemCost24h: null, redeemCost7d: null, subjects: [] };
      const meta = batch._applyMeta(id, { status: 'upcoming', ...b }, { level: 'intermediate', type: 'regular', visibility: 'public' });
      meta.createdAt = meta.createdAt || now(); batchDb.upsert(doc); store.put('batchmeta', id, meta); deps.mirrorBatch && deps.mirrorBatch(id);
      log(actor, 'batch.create', name, id); return batch.get(actor, id);
    },
    update(actor, id, b) {
      const doc = assertBatch(actor, id); if (isScoped(actor)) throw forbidden('Faculty accounts cannot edit batches');
      if (b.name !== undefined) { const n = str(b.name, 120, { req: true, name: 'name' }); if (batchDb.getAll().some(x => String(x._id) !== id && norm(x.name) === norm(n))) throw bad('A batch with this name already exists'); doc.name = n; }
      if (b.description !== undefined) doc.description = str(b.description, 1000);
      if (b.isPublic !== undefined) doc.isPublic = !!b.isPublic;
      if (b.isPremium !== undefined) doc.isPremium = !!b.isPremium;
      if (b.price !== undefined) { const p = Number(b.price); if (!(p >= 0) || p > 1e6) throw bad('Invalid price'); doc.price = p; }
      const meta = batch._applyMeta(id, b, metaOf(id));
      batchDb.upsert(doc); store.put('batchmeta', id, meta); deps.mirrorBatch && deps.mirrorBatch(id);
      log(actor, 'batch.update', doc.name, id); return batch.get(actor, id);
    },
    setStatus(actor, id, action) {
      const doc = assertBatch(actor, id); if (isScoped(actor)) throw forbidden();
      const m = { ...metaOf(id) };
      if (action === 'activate') { m.status = 'active'; doc.isPublic = true; }
      else if (action === 'deactivate') { doc.isPublic = false; }
      else if (action === 'complete') m.status = 'completed';
      else if (action === 'archive') { m.status = 'archived'; doc.isPublic = false; m.archivedFrom = metaOf(id).status || 'active'; }
      else if (action === 'restore') { m.status = m.archivedFrom || 'active'; delete m.archivedFrom; }
      else throw bad('Unknown action');
      batchDb.upsert(doc); store.put('batchmeta', id, m); deps.mirrorBatch && deps.mirrorBatch(id);
      log(actor, 'batch.' + action, doc.name, id); return batch.get(actor, id);
    },
    remove(actor, id, force) {
      const doc = assertBatch(actor, id); if (isScoped(actor)) throw forbidden();
      const n = enrolledCount(id);
      if (n && !force) throw new HttpError(409, `Batch has ${n} enrolled student(s). Archive it, or delete with force.`);
      batchDb.delete(id); deps.mirrorBatchDelete && deps.mirrorBatchDelete(id);
      store.del('batchmeta', id); assignments().filter(a => a.batchId === id).forEach(a => store.del('assignment', a.id));
      enrollments().filter(e => e.batchId === id).forEach(e => store.del('enrollment', e.id));
      store.list('resource').forEach(r => { if ((r.batchIds || []).includes(id)) store.put('resource', r.id, { ...r, batchIds: r.batchIds.filter(x => x !== id) }); });
      log(actor, 'batch.delete', doc.name, id); return { deleted: true };
    },
    duplicate(actor, id) {
      const src = assertBatch(actor, id); if (isScoped(actor)) throw forbidden();
      const nid = crypto.randomBytes(12).toString('hex'); const nid2 = () => crypto.randomBytes(12).toString('hex');
      const copy = JSON.parse(JSON.stringify(src)); copy._id = nid; copy.name = src.name + ' (Copy)'; copy.isPublic = false; copy.premiumUsers = [];
      (copy.subjects || []).forEach(s => { s._id = nid2(); (s.chapters || []).forEach(c => { c._id = nid2(); (c.lectures || []).forEach(l => l._id = nid2()); (c.units || []).forEach(u => { u._id = nid2(); (u.lectures || []).forEach(l => l._id = nid2()); }); }); });
      batchDb.upsert(copy); store.put('batchmeta', nid, { ...metaOf(id), status: 'upcoming' }); deps.mirrorBatch && deps.mirrorBatch(nid);
      log(actor, 'batch.duplicate', src.name, nid); return batch.get(actor, nid);
    },
    students(actor, id, q = {}) {
      assertBatch(actor, id);
      let rows = enrollments().filter(e => e.batchId === id).map(e => studentBrief(e.userId, { addedAt: e.addedAt }));
      if (q.q) rows = rows.filter(r => norm(r.name + ' ' + r.username + ' ' + r.userId).includes(norm(q.q)));
      return paginate(rows, q.page, q.size || 30);
    },
    setAssignment(actor, id, b) {
      assertBatch(actor, id); if (isScoped(actor)) throw forbidden();
      const subjectName = str(b.subjectName, 60, { req: true, name: 'subjectName' });
      const doc = batchDb.getOne(id); if (!(doc.subjects || []).some(s => norm(s.name) === norm(subjectName))) throw bad('Batch has no such subject');
      if (!store.get('faculty', b.facultyId)) throw bad('Unknown faculty');
      const aid = crypto.createHash('md5').update(`${id}|${norm(subjectName)}|${b.facultyId}`).digest('hex').slice(0, 16);
      const a = store.put('assignment', aid, { batchId: id, subjectName, facultyId: b.facultyId, createdAt: now() });
      log(actor, 'assignment.set', `${doc.name} / ${subjectName}`, b.facultyId); return a;
    },
    removeAssignment(actor, id, aid) {
      assertBatch(actor, id); if (isScoped(actor)) throw forbidden();
      const a = store.get('assignment', aid); if (!a || a.batchId !== id) throw nf('Assignment not found');
      store.del('assignment', aid); log(actor, 'assignment.remove', id, aid); return { deleted: true };
    },
    reassignFaculty(actor, id, facultyId) { return batch.update(actor, id, { facultyId }); },
  };

  // ── Students ─────────────────────────────────────────────────────────────────
  function studentBrief(userId, extra = {}) {
    userId = String(userId); const u = userDb.findOne(userId) || {}; const banned = banDb.isBanned(userId);
    const enr = enrollments().filter(e => e.userId === userId);
    return { userId, name: [u.firstName, u.lastName].filter(Boolean).join(' ') || `User ${userId}`, username: u.username || '', firstSeen: u.firstSeen || null, lastSeen: u.lastSeen || null, status: banned ? 'blocked' : (u.lastSeen && now() - new Date(u.lastSeen).getTime() < 7 * 864e5 ? 'active' : 'inactive'), batches: enr.map(e => e.batchId), ...extra };
  }
  function studentVisible(actor, userId) {
    if (!isScoped(actor)) return true; const mine = facultyBatchIds(actor.facultyId);
    return enrollments().some(e => e.userId === String(userId) && mine.has(e.batchId));
  }
  const student = {
    list(actor, q = {}) {
      let rows = (userDb.listAll ? userDb.listAll() : userDb.getAll()).map(u => String(u.userId));
      const enr = enrollments(); let rowsB = rows.map(id => studentBrief(id));
      if (isScoped(actor)) { const mine = facultyBatchIds(actor.facultyId); rowsB = rowsB.filter(r => enr.some(e => e.userId === r.userId && mine.has(e.batchId))); }
      if (q.status) rowsB = rowsB.filter(r => r.status === q.status);
      if (q.batchId) rowsB = rowsB.filter(r => r.batches.includes(q.batchId));
      if (q.unassigned === '1') rowsB = rowsB.filter(r => !r.batches.length);
      if (q.q) rowsB = rowsB.filter(r => norm(`${r.name} ${r.username} ${r.userId}`).includes(norm(q.q)));
      rowsB.sort((a, b) => new Date(b.firstSeen || 0) - new Date(a.firstSeen || 0));
      return paginate(rowsB, q.page, q.size || 25);
    },
    get(actor, userId) {
      if (!studentVisible(actor, userId)) throw forbidden(); if (!userDb.findOne(String(userId))) throw nf('Student not found');
      const s = studentBrief(userId); const acc = accessDb.findOne(String(userId));
      return { ...s, batchDetails: s.batches.map(b => { const d = batchDb.getOne(b); return { id: b, name: d ? d.name : '(deleted)' }; }), accessExpiresAt: acc ? acc.expiresAt : null, ban: banDb.isBanned(String(userId)) ? banDb.findOne(String(userId)) : null };
    },
    block(actor, userId, reason) {
      if (!userDb.findOne(String(userId))) throw nf('Student not found');
      if (String(userId) === String(deps.ownerId)) throw bad('The owner cannot be blocked');
      banDb.ban({ userId: String(userId), reason: str(reason, 200) || 'Blocked by admin', bannedBy: actor.id }); log(actor, 'student.block', userId, reason || ''); return { blocked: true };
    },
    unblock(actor, userId) { banDb.unban(String(userId)); log(actor, 'student.unblock', userId); return { blocked: false }; },
    enroll(actor, userId, batchId) {
      userId = String(userId); if (!userDb.findOne(userId)) throw nf(`Student ${userId} not found (they must have started the bot)`);
      const doc = assertBatch(actor, batchId); if (isScoped(actor)) throw forbidden();
      const eid = `${userId}:${batchId}`; if (store.get('enrollment', eid)) return store.get('enrollment', eid);
      const e = store.put('enrollment', eid, { userId, batchId, addedAt: now(), addedBy: actor.id });
      if (!(doc.premiumUsers || []).includes(userId)) { doc.premiumUsers = [...(doc.premiumUsers || []), userId]; batchDb.upsert(doc); deps.mirrorBatch && deps.mirrorBatch(batchId); }
      log(actor, 'student.enroll', userId, doc.name); return e;
    },
    unenroll(actor, userId, batchId) {
      userId = String(userId); const doc = assertBatch(actor, batchId); if (isScoped(actor)) throw forbidden();
      if (!store.get('enrollment', `${userId}:${batchId}`)) throw nf('Student is not in this batch');
      store.del('enrollment', `${userId}:${batchId}`);
      if ((doc.premiumUsers || []).includes(userId)) { doc.premiumUsers = doc.premiumUsers.filter(x => x !== userId); batchDb.upsert(doc); deps.mirrorBatch && deps.mirrorBatch(batchId); }
      log(actor, 'student.unenroll', userId, doc.name); return { removed: true };
    },
    transfer(actor, userId, fromId, toId) {
      if (fromId === toId) throw bad('Source and target batch are the same');
      if (!store.get('enrollment', `${userId}:${fromId}`)) throw nf('Student is not in the source batch');
      student.enroll(actor, userId, toId); student.unenroll(actor, userId, fromId); log(actor, 'student.transfer', userId, `${fromId} -> ${toId}`); return { transferred: true };
    },
    bulkEnroll(actor, userIds, batchId) {
      if (!Array.isArray(userIds) || !userIds.length) throw bad('userIds must be a non-empty array'); if (userIds.length > 500) throw bad('Max 500 per request');
      const res = { added: 0, failed: [] };
      for (const u of userIds) { try { student.enroll(actor, String(u).trim(), batchId); res.added++; } catch (e) { res.failed.push({ userId: String(u), error: e.message }); } }
      return res;
    },
  };

  // ── Categories & Resources ───────────────────────────────────────────────────
  const category = {
    list() { return store.list('category'); },
    create(actor, b) { const name = str(b.name, 60, { req: true, name: 'name' }); if (store.list('category').some(c => norm(c.name) === norm(name))) throw bad('Category exists'); const c = store.put('category', uid(), { name, description: str(b.description, 300), createdAt: now() }); log(actor, 'category.create', name); return c; },
    update(actor, id, b) { const c = store.get('category', id); if (!c) throw nf('Category not found'); const n = { ...c, name: b.name !== undefined ? str(b.name, 60, { req: true, name: 'name' }) : c.name, description: b.description !== undefined ? str(b.description, 300) : c.description }; store.put('category', id, n); log(actor, 'category.update', n.name); return n; },
    remove(actor, id) { const c = store.get('category', id); if (!c) throw nf('Category not found'); if (store.list('resource').some(r => r.categoryId === id)) throw new HttpError(409, 'Category has resources'); store.del('category', id); log(actor, 'category.delete', c.name); return { deleted: true }; },
  };
  function resourceScopeCheck(actor, batchIds) {
    if (!isScoped(actor)) return; const mine = facultyBatchIds(actor.facultyId);
    if (!batchIds.length) throw forbidden('Faculty resources must be attached to one of your batches');
    if (batchIds.some(b => !mine.has(b))) throw forbidden('Resource attached to a batch that is not yours');
  }
  function cleanResource(b, base = {}) {
    const r = { ...base };
    if (b.title !== undefined || !base.title) r.title = str(b.title, 150, { req: true, name: 'title' });
    if (b.type !== undefined || !base.type) r.type = oneOf(b.type, RES_TYPES, 'type', 'other');
    if (b.description !== undefined) r.description = str(b.description, 600);
    if (b.url !== undefined) { const u = str(b.url, 600); if (u && !/^https?:\/\//i.test(u)) throw bad('url must start with http(s)://'); r.url = u; }
    if (b.fileCode !== undefined) r.fileCode = str(b.fileCode, 60);
    if (!r.url && !r.fileCode) throw bad('Provide a url or an existing bot file code');
    if (b.categoryId !== undefined) { if (b.categoryId && !store.get('category', b.categoryId)) throw bad('Unknown category'); r.categoryId = b.categoryId || null; }
    if (b.subjectId !== undefined) { if (b.subjectId && !store.get('subject', b.subjectId)) throw bad('Unknown subject'); r.subjectId = b.subjectId || null; }
    if (b.facultyId !== undefined) { if (b.facultyId && !store.get('faculty', b.facultyId)) throw bad('Unknown faculty'); r.facultyId = b.facultyId || null; }
    if (b.batchIds !== undefined) { if (!Array.isArray(b.batchIds)) throw bad('batchIds must be an array'); b.batchIds.forEach(x => { if (!batchDb.getOne(String(x))) throw bad('Unknown batch ' + x); }); r.batchIds = b.batchIds.map(String); }
    if (b.visibility !== undefined) r.visibility = oneOf(b.visibility, ['public', 'batch', 'hidden'], 'visibility');
    r.batchIds = r.batchIds || []; r.visibility = r.visibility || 'batch';
    return r;
  }
  const resource = {
    list(actor, q = {}) {
      let rows = store.list('resource');
      if (isScoped(actor)) { const mine = facultyBatchIds(actor.facultyId); rows = rows.filter(r => (r.batchIds || []).some(b => mine.has(b))); }
      if (q.type) rows = rows.filter(r => r.type === q.type); if (q.categoryId) rows = rows.filter(r => r.categoryId === q.categoryId);
      if (q.batchId) rows = rows.filter(r => (r.batchIds || []).includes(q.batchId)); if (q.subjectId) rows = rows.filter(r => r.subjectId === q.subjectId);
      if (q.facultyId) rows = rows.filter(r => r.facultyId === q.facultyId); if (q.visibility) rows = rows.filter(r => r.visibility === q.visibility);
      if (q.q) rows = rows.filter(r => norm(r.title + ' ' + (r.description || '')).includes(norm(q.q)));
      return paginate(rows.reverse(), q.page, q.size || 25);
    },
    get(actor, id) { const r = store.get('resource', id); if (!r) throw nf('Resource not found'); if (isScoped(actor)) resourceScopeCheck(actor, r.batchIds || []); return r; },
    create(actor, b) { const r = cleanResource(b); resourceScopeCheck(actor, r.batchIds); if (isScoped(actor)) r.facultyId = actor.facultyId; const out = store.put('resource', uid(), { ...r, createdAt: now(), createdBy: actor.id }); log(actor, 'resource.create', r.title, out.id); return out; },
    update(actor, id, b) { const cur = resource.get(actor, id); const r = cleanResource(b, cur); resourceScopeCheck(actor, r.batchIds); store.put('resource', id, r); log(actor, 'resource.update', r.title, id); return r; },
    remove(actor, id) { const r = resource.get(actor, id); store.del('resource', id); log(actor, 'resource.delete', r.title, id); return { deleted: true }; },
    bulkAssign(actor, ids, batchId) { if (!Array.isArray(ids) || !ids.length) throw bad('ids required'); assertBatch(actor, batchId); let n = 0; for (const id of ids) { const r = resource.get(actor, id); if (!(r.batchIds || []).includes(batchId)) { store.put('resource', id, { ...r, batchIds: [...(r.batchIds || []), batchId] }); n++; } } log(actor, 'resource.bulkAssign', batchId, `${n} resources`); return { updated: n }; },
  };

  // ── Notifications ────────────────────────────────────────────────────────────
  function audienceUsers(n) {
    const all = (userDb.listAll ? userDb.listAll() : userDb.getAll()).map(u => String(u.userId));
    let ids;
    if (n.audience === 'batch') { const set = new Set(n.batchIds || []); ids = [...new Set(enrollments().filter(e => set.has(e.batchId)).map(e => e.userId))]; }
    else if (n.audience === 'users') ids = (n.userIds || []).map(String);
    else ids = all;
    return ids.filter(id => !banDb.isBanned(id));
  }
  function cleanNotification(b, base = {}) {
    const n = { ...base };
    if (b.title !== undefined || !base.title) n.title = str(b.title, 100, { req: true, name: 'title' });
    if (b.body !== undefined || !base.body) n.body = str(b.body, 3500, { req: true, name: 'body' });
    if (b.audience !== undefined || !base.audience) n.audience = oneOf(b.audience, ['all', 'batch', 'users'], 'audience', 'all');
    if (b.batchIds !== undefined) n.batchIds = (b.batchIds || []).map(String);
    if (b.userIds !== undefined) { n.userIds = (b.userIds || []).map(x => String(x).trim()).filter(Boolean); if (n.userIds.length > 1000) throw bad('Max 1000 users'); }
    if (n.audience === 'batch' && !(n.batchIds || []).length) throw bad('Select at least one batch');
    if (n.audience === 'users' && !(n.userIds || []).length) throw bad('Select at least one user');
    if (b.scheduledAt !== undefined) { if (b.scheduledAt) { const t = Date.parse(b.scheduledAt); if (isNaN(t)) throw bad('Invalid scheduledAt'); n.scheduledAt = t; } else n.scheduledAt = null; }
    if (b.btnKind !== undefined) n.btnKind = oneOf(b.btnKind, ['none', 'support', 'link'], 'btnKind', 'none');
    if (b.btnText !== undefined) n.btnText = str(b.btnText, 28);
    if (b.btnUrl !== undefined) { n.btnUrl = str(b.btnUrl, 300); if (n.btnUrl && !/^https?:\/\//i.test(n.btnUrl)) throw bad('Button link must start with https://'); }
    if (n.btnKind === 'link' && !n.btnUrl) throw bad('Add the button link');
    if (b.inApp !== undefined) n.inApp = !!b.inApp;
    if (b.visible !== undefined) n.visible = !!b.visible;
    n.status = n.status || (n.scheduledAt ? 'scheduled' : 'draft'); if (n.status === 'draft' && n.scheduledAt) n.status = 'scheduled';
    return n;
  }
  const notification = {
    list(actor, q = {}) {
      let rows = store.list('notification').reverse();
      if (isScoped(actor)) { const mine = facultyBatchIds(actor.facultyId); rows = rows.filter(n => n.audience === 'batch' && (n.batchIds || []).every(b => mine.has(b))); }
      if (q.status) rows = rows.filter(n => n.status === q.status); return paginate(rows, q.page, q.size || 25);
    },
    create(actor, b) { const n = cleanNotification({ visible: true, inApp: false, ...b }); const out = store.put('notification', uid(), { ...n, createdAt: now(), createdBy: actor.id, sentCount: 0 }); log(actor, 'notification.create', n.title, out.id); return out; },
    update(actor, id, b) { const cur = store.get('notification', id); if (!cur) throw nf('Notification not found'); if (cur.status === 'sent' && (b.body !== undefined || b.audience !== undefined)) throw bad('A sent notification can only change visibility'); const n = cleanNotification(b, cur); store.put('notification', id, n); log(actor, 'notification.update', n.title, id); return n; },
    remove(actor, id) { const cur = store.get('notification', id); if (!cur) throw nf('Notification not found'); if (cur.inAppId && announcementDb.delete) { try { announcementDb.delete(cur.inAppId); } catch (e) {} } store.del('notification', id); log(actor, 'notification.delete', cur.title, id); return { deleted: true }; },
    preview(actor, id) { const n = store.get('notification', id); if (!n) throw nf('Notification not found'); return { recipients: audienceUsers(n).length }; },
    async send(actor, id) {
      const n = store.get('notification', id); if (!n) throw nf('Notification not found');
      if (n.status === 'sending' || n.status === 'sent') throw new HttpError(409, 'Already sent or sending');
      if (isScoped(actor) && n.audience !== 'batch') throw forbidden();
      if (!deps.sendMessage) throw new HttpError(503, 'Bot messaging is not available');
      const users = audienceUsers(n); store.put('notification', id, { ...n, status: 'sending' });
      const btn = (() => { if (n.btnKind === 'support') { const u = config.get().supportLink; return u ? { text: n.btnText || 'Support', url: u } : null; } if (n.btnKind === 'link' && n.btnUrl) return { text: n.btnText || 'Open', url: n.btnUrl }; return null; })();
      if (n.inApp && announcementDb.insert) { const aid = uid(); announcementDb.insert({ id: aid, emoji: '📢', heading: n.title, body: n.body, createdAt: new Date(now()).toISOString(), btnText: btn ? btn.text : '', btnUrl: btn ? (n.btnKind === 'support' ? '@support' : btn.url) : '' }); n.inAppId = aid; }
      log(actor, 'notification.send', n.title, `${users.length} recipients`);
      const text = `📢 <b>${esc(n.title)}</b>\n\n${esc(n.body)}`;
      const run = (async () => { let ok = 0, fail = 0; for (const u of users) { try { await deps.sendMessage(u, text, btn ? { reply_markup: { inline_keyboard: [[{ text: btn.text, url: btn.url }]] } } : undefined); ok++; } catch (e) { fail++; } if (deps.sendDelayMs !== 0) await new Promise(r => setTimeout(r, deps.sendDelayMs ?? 45)); } store.put('notification', id, { ...store.get('notification', id), inAppId: n.inAppId, status: 'sent', sentAt: now(), sentCount: ok, failedCount: fail }); })();
      if (deps.awaitSend) await run; else run.catch(() => {});
      return { queued: users.length };
    },
    async runScheduled() { const due = store.list('notification').filter(n => n.status === 'scheduled' && n.scheduledAt && n.scheduledAt <= now()); for (const n of due) { try { await notification.send({ id: 'system', name: 'scheduler', role: 'super_admin', perms: new Set(['*']) }, n.id); } catch (e) {} } return due.length; },
  };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ── Access / payments / subscriptions ────────────────────────────────────────
  const access = {
    grantHours(actor, userId, hours) { userId = String(userId); if (!userDb.findOne(userId)) throw nf('Student not found'); const h = Number(hours); if (!(h > 0) || h > 24 * 365) throw bad('hours must be between 1 and 8760'); const cur = accessDb.findOne(userId); const base = cur && new Date(cur.expiresAt).getTime() > now() ? new Date(cur.expiresAt).getTime() : now(); const exp = new Date(base + h * 3600e3).toISOString(); accessDb.upsert({ userId, expiresAt: exp, claimsToday: cur ? cur.claimsToday : 0, claimDay: cur ? cur.claimDay : '' }); log(actor, 'access.grant', userId, `${h}h`); return { expiresAt: exp }; },
    revoke(actor, userId) { userId = String(userId); const cur = accessDb.findOne(userId); if (!cur) throw nf('No access record'); accessDb.upsert({ userId, expiresAt: new Date(0).toISOString(), claimsToday: cur.claimsToday, claimDay: cur.claimDay }); log(actor, 'access.revoke', userId); return { revoked: true }; },
    premiumHolders(actor, batchId) { const b = assertBatch(actor, batchId); return (b.premiumUsers || []).map(id => studentBrief(id)); },
    grantBatch(actor, userId, batchId) { return student.enroll(actor, userId, batchId); },
    revokeBatch(actor, userId, batchId) { const b = assertBatch(actor, batchId); const id = String(userId); if (store.get('enrollment', `${id}:${batchId}`)) return student.unenroll(actor, id, batchId); if (!(b.premiumUsers || []).includes(id)) throw nf('User has no access to this batch'); b.premiumUsers = b.premiumUsers.filter(x => x !== id); batchDb.upsert(b); deps.mirrorBatch && deps.mirrorBatch(batchId); log(actor, 'access.revokeBatch', id, b.name); return { removed: true }; },
  };
  const payments = { async list(actor, q = {}) { const rows = deps.getPayments ? await deps.getPayments() : []; return paginate(rows, q.page, q.size || 25); }, subscriptions() { return { batches: batchDb.getAll().filter(b => b.isPremium).map(b => ({ id: String(b._id), name: b.name, price: b.price || 0, holders: (b.premiumUsers || []).length })), adsFree: deps.listAdsFree ? deps.listAdsFree() : [] }; } };

  // ── Dashboard & analytics ────────────────────────────────────────────────────
  function dashboard(actor) {
    const metas = store.list('batchmeta'); const bs = batchDb.getAll(); const st = (b) => (metaOf(String(b._id)).status || 'active');
    const users = (userDb.listAll ? userDb.listAll() : userDb.getAll());
    const banned = banDb.listAll ? banDb.listAll().length : 0; const nowMs = now();
    const activeStudents = users.filter(u => u.lastSeen && nowMs - new Date(u.lastSeen).getTime() < 7 * 864e5).length;
    const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(nowMs - i * 864e5).toISOString().slice(0, 10); days.push({ day: d, count: users.filter(u => u.firstSeen && new Date(u.firstSeen).toISOString().slice(0, 10) === d).length }); }
    const enr = enrollments(); const top = bs.map(b => ({ id: String(b._id), name: b.name, students: enrolledCount(String(b._id), enr) })).sort((a, b) => b.students - a.students).slice(0, 5);
    const lec = bs.reduce((a, b) => a + (b.subjects || []).reduce((x, s) => x + (s.chapters || []).reduce((y, c) => y + (c.lectures || []).length + (c.units || []).reduce((z, u) => z + (u.lectures || []).length, 0), 0), 0), 0);
    const fac = store.list('faculty');
    return { students: { total: users.length, active: activeStudents, blocked: banned, newToday: days[13].count, enrolled: new Set(enr.map(e => e.userId)).size }, batches: { total: bs.length, active: bs.filter(b => st(b) === 'active').length, completed: bs.filter(b => st(b) === 'completed').length, upcoming: bs.filter(b => st(b) === 'upcoming').length, archived: bs.filter(b => st(b) === 'archived').length }, faculties: { total: fac.length, active: fac.filter(f => f.status === 'active').length }, subjects: store.count('subject'), resources: store.count('resource'), lectures: lec, notifications: store.count('notification'), registrations: days, topBatches: top, recentStudents: users.slice().sort((a, b) => new Date(b.firstSeen || 0) - new Date(a.firstSeen || 0)).slice(0, 6).map(u => studentBrief(u.userId)), recentActivity: store.list('log').slice(-8).reverse() };
  }
  const analytics = {
    summary(actor) { const d = dashboard(actor); const asg = assignments(); return { ...d, facultyReport: store.list('faculty').map(f => ({ id: f.id, name: f.name, batches: facultyBatchIds(f.id).size, students: new Set(enrollments().filter(e => facultyBatchIds(f.id).has(e.batchId)).map(e => e.userId)).size, assignments: asg.filter(a => a.facultyId === f.id).length })), resourceStats: RES_TYPES.map(t => ({ type: t, count: store.list('resource').filter(r => r.type === t).length })) }; },
    csv(actor, what) {
      const q = (v) => '"' + String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"'; // neutralise CSV/Excel formula injection
      let head, rows;
      if (what === 'students') { head = ['userId', 'name', 'username', 'status', 'firstSeen', 'batches']; rows = student.list(actor, { size: 100, page: 1 }); const all = []; for (let p = 1; p <= rows.pages; p++) all.push(...student.list(actor, { size: 100, page: p }).items); rows = all.map(r => [r.userId, r.name, r.username, r.status, r.firstSeen, r.batches.join('|')]); }
      else if (what === 'batches') { head = ['id', 'name', 'level', 'status', 'faculty', 'students', 'chapters', 'lectures']; const all = []; const first = batch.list(actor, { size: 100, includeArchived: 1 }); for (let p = 1; p <= first.pages; p++) all.push(...batch.list(actor, { size: 100, page: p, includeArchived: 1 }).items); rows = all.map(r => [r.id, r.name, r.level, r.status, r.facultyName, r.students, r.chapters, r.lectures]); }
      else if (what === 'logs') { head = ['at', 'actor', 'role', 'action', 'target', 'detail']; rows = store.list('log').map(l => [new Date(l.at).toISOString(), l.actorName, l.role, l.action, l.target, l.detail]); }
      else throw bad('Unknown report');
      return [head, ...rows].map(r => r.map(q).join(',')).join('\n');
    },
  };

  // ── Admin accounts ───────────────────────────────────────────────────────────
  const admins = {
    list() { return store.list('admin_user'); },
    upsert(actor, b) {
      const userId = str(b.userId, 20, { req: true, name: 'userId' }); if (!/^\d{5,15}$/.test(userId)) throw bad('userId must be a numeric Telegram ID');
      if (userId === String(deps.ownerId)) throw bad('The owner is always Super Admin');
      const role = oneOf(b.role, ROLES.filter(r => r !== 'super_admin' || actor.role === 'super_admin'), 'role');
      if (role === 'super_admin' && actor.role !== 'super_admin') throw forbidden();
      if (role === 'faculty') { if (!b.facultyId || !store.get('faculty', b.facultyId)) throw bad('Faculty role requires a valid facultyId'); }
      const cur = store.get('admin_user', userId) || {};
      const clean = (a) => (Array.isArray(a) ? a.filter(p => PERMS.includes(p)) : undefined);
      const rec = { ...cur, userId, name: b.name !== undefined ? str(b.name, 80) : (cur.name || ''), role, facultyId: role === 'faculty' ? b.facultyId : null, active: b.active !== undefined ? !!b.active : (cur.active !== false), extraPerms: clean(b.extraPerms) ?? cur.extraPerms ?? [], deniedPerms: clean(b.deniedPerms) ?? cur.deniedPerms ?? [], createdAt: cur.createdAt || now() };
      store.put('admin_user', userId, rec); log(actor, cur.userId ? 'admin.update' : 'admin.create', userId, role); return rec;
    },
    setActive(actor, userId, active) { const a = store.get('admin_user', userId); if (!a) throw nf('Admin not found'); store.put('admin_user', userId, { ...a, active: !!active }); log(actor, active ? 'admin.activate' : 'admin.deactivate', userId); return { active: !!active }; },
    remove(actor, userId) { if (!store.get('admin_user', userId)) throw nf('Admin not found'); store.del('admin_user', userId); log(actor, 'admin.revoke', userId); return { deleted: true }; },
    roles() { return { roles: ROLES, perms: PERMS }; },
  };

  // ── Config / logs / backup ───────────────────────────────────────────────────
  /** JOIN_CHANNELS* env: JSON list, or lines/semicolons of  Title|https://t.me/x|-100123(chat id, optional)|picture-url(optional). */
  /** Same variables as the older bot: FORCE_JOIN_CHANNELS=-100..,-100..  FORCE_JOIN_CHANNEL_LINKS=https://t.me/a,https://t.me/b  FORCE_JOIN_CHANNEL_NAMES=Name A,Name B  (+ _FOUNDATION / _INTERMEDIATE suffix). */
  /** Channels given only by chat id get their title + link from Telegram (getChat / invite link) — filled in by config.resolveJoin() and cached here. */
  const joinMeta = {}; const fillJoin = (x) => { const m = x.chatId && joinMeta[x.chatId]; return { ...x, title: x.title || (m && m.title) || 'Join channel', url: x.url || (m && m.url) || '' }; };
  function envJoinRef(suffix) {
    const sp = (n) => (process.env[n + suffix] || '').split(/[,\n]+/).map((x) => x.trim()); const ids = sp('FORCE_JOIN_CHANNELS').filter(Boolean); const links = sp('FORCE_JOIN_CHANNEL_LINKS'); const names = sp('FORCE_JOIN_CHANNEL_NAMES');
    return ids.map((id, i) => fillJoin({ title: String(names[i] || '').slice(0, 40), url: /^https:\/\//i.test(links[i] || '') ? links[i] : '', chatId: id.slice(0, 40), pic: '' })).filter((x) => x.url).slice(0, 12);
  }
  function envJoin(name) {
    const raw = (process.env[name] || '').trim(); if (!raw) return []; let list = [];
    if (/^-?\d+(\s*[,;\n]\s*-?\d+)*$/.test(raw)) list = raw.split(/[,;\n]+/).map((x) => ({ chatId: x.trim() })); else
    if (raw[0] === '[') { try { list = JSON.parse(raw); } catch (e) { return []; } } else list = raw.split(/[;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => { const [title, url, chatId, pic] = x.split('|').map((y) => (y || '').trim()); return { title, url, chatId, pic }; });
    return list.filter((x) => x && (/^https:\/\//i.test(x.url || '') || x.chatId)).slice(0, 12).map((x) => fillJoin({ title: String(x.title || '').slice(0, 40), url: /^https:\/\//i.test(x.url || '') ? String(x.url) : '', chatId: String(x.chatId || '').slice(0, 40), pic: /^https:\/\//i.test(x.pic || '') ? String(x.pic) : '' })).filter((x) => x.url);
  }
  const config = {
    get() { return { botName: 'StudyMate', supportLink: '', whatsappLink: '', channelLink: '', backupChannelLink: '', proTipEnabled: true, themeSkin: 'level', uiScale: 88, newFacultyDays: 7, cleanChat: true, pinHowTo: true, adsgramBlockId: '', adsgramVerify: false, monetagEnabled: true, monetagInApp: true, monetagZoneId: '12243244', monetagLectureEvery: 3, lectureDeleteHours: 24, supportHandle: '', joinChannelsFoundation: [], joinChannelsIntermediate: [], grantText: '', howToCaption: '', savePassEnabled: false, savePassDayPrice: 19, savePassWeekPrice: 99, savePassDailyLimit: 10, protectContent: true, defaultLevel: 'foundation', dailyLectureLimit: 15, dailyAdLimit: 4, minAdSeconds: 15, maxAccessHours: 72, referralHours: 24, referralPoints: 10, pointsPerHour: 5, welcomeText: '', premiumInfo: '', howToUrl: '', testSeriesUrl: '', testSeriesItems: [], fullscreen: false, testSeriesEnabled: true, joinChannels: [], ...(store.get('config', 'main') || {}) }; },
    /** Looks up title + join link for env channels that were given by id only (bot must be a member/admin). Call once after the bot starts. */
    async resolveJoin(tg) {
      const ids = new Set(); for (const n of ['JOIN_CHANNELS', 'JOIN_CHANNELS_FOUNDATION', 'JOIN_CHANNELS_INTERMEDIATE']) { const raw = process.env[n] || ''; if (/^-?\d+(\s*[,;\n]\s*-?\d+)*$/.test(raw.trim())) raw.split(/[,;\n]+/).forEach((x) => ids.add(x.trim())); else if (raw.trim()[0] === '[') { try { JSON.parse(raw).forEach((x) => { if (x.chatId && !x.url) ids.add(String(x.chatId)); }); } catch (e) {} } }
      for (const sfx of ['', '_FOUNDATION', '_INTERMEDIATE']) { const ln = (process.env['FORCE_JOIN_CHANNEL_LINKS' + sfx] || '').split(/[,\n]+/).map((x) => x.trim()); (process.env['FORCE_JOIN_CHANNELS' + sfx] || '').split(/[,\n]+/).map((x) => x.trim()).filter(Boolean).forEach((id, i) => { if (!/^https:\/\//i.test(ln[i] || '')) ids.add(id); }); }
      for (const id of ids) { try { const c = await tg.call('getChat', { chat_id: id }); let url = c.username ? 'https://t.me/' + c.username : c.invite_link || ''; if (!url) { try { url = await tg.call('exportChatInviteLink', { chat_id: id }); } catch (e) { /* bot lacks invite right */ } } if (url) joinMeta[id] = { url, title: String(c.title || '').slice(0, 40) }; } catch (e) { console.warn('[join] cannot read channel ' + id + ': ' + e.message); } }
      return Object.keys(joinMeta).length;
    },
    /** Force-join channels for a level: env lists (JOIN_CHANNELS, JOIN_CHANNELS_FOUNDATION, JOIN_CHANNELS_INTERMEDIATE) + the ones saved in the admin panel. */
    joinFor(level) {
      const c = config.get(); const L = level === 'foundation' || level === 'intermediate' ? level : ''; const cap = L ? L[0].toUpperCase() + L.slice(1) : ''; const seen = new Set(); const out = [];
      for (const ch of [...envJoin('JOIN_CHANNELS'), ...envJoinRef(''), ...(L ? [...envJoin('JOIN_CHANNELS_' + L.toUpperCase()), ...envJoinRef('_' + L.toUpperCase())] : []), ...(c.joinChannels || []), ...(L ? c['joinChannels' + cap] || [] : [])]) { const key = (ch.chatId || ch.url || '').toLowerCase(); if (!ch.url || seen.has(key)) continue; seen.add(key); out.push(ch); }
      return out;
    },
    set(actor, b) {
      const cur = config.get(); const n = { ...cur };
      for (const [k, rule] of Object.entries(CONFIG_KEYS)) { if (b[k] === undefined) continue; if (rule === 'tests') { const a = typeof b[k] === 'string' ? JSON.parse(b[k] || '[]') : b[k]; if (!Array.isArray(a) || a.length > 60) throw bad('Test Series list can hold up to 60 items'); n[k] = a.map((x) => ({ level: ['foundation', 'intermediate'].includes(x.level) ? x.level : 'both', subject: str(x.subject, 60, { req: true, name: 'subject' }), title: str(x.title, 80), url: (() => { const u = str(x.url, 300, { req: true, name: 'url' }); if (!/^https:\/\//i.test(u)) throw bad('Test Series link must start with https://'); return u; })() })); } else if (rule === 'json') { const a = typeof b[k] === 'string' ? JSON.parse(b[k] || '[]') : b[k]; if (!Array.isArray(a) || a.length > 6) throw bad(`${k} must be a list of up to 6 items`); n[k] = a.map((x) => ({ title: str(x.title, 40, { req: true, name: 'title' }), url: (() => { const u = str(x.url, 300, { req: true, name: 'url' }); if (!/^https:\/\//i.test(u)) throw bad('Channel link must start with https://'); return u; })(), chatId: str(x.chatId, 40), pic: (() => { const u = str(x.pic, 300); if (u && !/^https:\/\//i.test(u)) throw bad('Picture link must start with https://'); return u; })() })); } else if (rule === 'bool') n[k] = !!b[k]; else if (rule === 'int') { const v = parseInt(b[k]); if (!(v >= 0 && v <= 1000)) throw bad(`${k} out of range`); n[k] = v; } else if (rule === 'level') n[k] = oneOf(b[k], LEVELS, k); else { n[k] = str(b[k], rule, { name: k }); if (k === 'themeSkin' && !['level', 'blue', 'green'].includes(n[k])) throw bad('Theme must be level, blue or green'); if (/Link$/.test(k) && n[k] && !/^https:\/\//i.test(n[k])) throw bad(`${k} must be an https:// link`); } }
      if (!(n.uiScale >= 60 && n.uiScale <= 110)) throw bad('UI size must be between 60 and 110 (default 88)');
      if (n.monetagZoneId && !/^\d{4,16}$/.test(n.monetagZoneId)) throw bad('Monetag zone ID must be numbers only (e.g. 12243244)');
      store.put('config', 'main', n); if (deps.onConfig) deps.onConfig(n); log(actor, 'config.update', Object.keys(b).filter(k => k in CONFIG_KEYS).join(',')); return n;
    },
  };
  const logs = { list(actor, q = {}) { let rows = store.list('log').reverse(); if (q.action) rows = rows.filter(l => l.action.startsWith(q.action)); if (q.actorId) rows = rows.filter(l => l.actorId === q.actorId); if (q.q) rows = rows.filter(l => norm(l.action + l.target + l.detail + l.actorName).includes(norm(q.q))); return paginate(rows, q.page, q.size || 30); } };
  const maintenance = {
    export(actor) { log(actor, 'backup.export'); return { version: 1, exportedAt: new Date(now()).toISOString(), entities: store.exportAll(), batches: batchDb.getAll() }; },
    restore(actor, dump) { if (!dump || dump.version !== 1 || !Array.isArray(dump.entities)) throw bad('Invalid backup file'); let n = 0, nb = 0; for (const r of dump.entities) { if (!r.kind || !r.id || typeof r.data !== 'object') continue; if (!store.get(r.kind, r.id)) { store.put(r.kind, r.id, r.data); n++; } } for (const b of dump.batches || []) { if (b && b._id && !batchDb.getOne(String(b._id))) { batchDb.upsert(b); deps.mirrorBatch && deps.mirrorBatch(String(b._id)); nb++; } } log(actor, 'backup.restore', '', `${n} entities, ${nb} batches (missing only)`); return { entitiesRestored: n, batchesRestored: nb }; },
    pruneLogs(actor, days) { const d = parseInt(days); if (!(d >= 7 && d <= 3650)) throw bad('days must be 7-3650'); const cut = now() - d * 864e5; let n = 0; store.list('log').forEach(l => { if (l.at < cut) { store.del('log', l.id); n++; } }); log(actor, 'maintenance.pruneLogs', '', `${n} removed`); return { removed: n }; },
    health() { return { uptimeSec: Math.round(process.uptime()), memoryMB: Math.round(process.memoryUsage().rss / 1048576), entities: Object.fromEntries(['faculty', 'subject', 'batchmeta', 'assignment', 'enrollment', 'resource', 'category', 'notification', 'admin_user', 'log'].map(k => [k, store.count(k)])), batches: batchDb.getAll().length, students: (userDb.count ? userDb.count() : 0), time: new Date(now()).toISOString() }; },
  };

  // ── Student-facing catalog (Level → Subject → Faculty → Batch) ───────────────
  function catalog(userId, level) {
    const uidS = userId ? String(userId) : null; const enr = enrollments(); const subs = store.list('subject').filter(s => s.status !== 'archived');
    const facs = new Map(store.list('faculty').filter(f => f.status === 'active').map(f => [f.id, f])); const asg = assignments(); const out = new Map();
    const lvlSubs = (lv) => subs.filter(s => s.level === lv);
    for (const b of batchDb.getAll()) {
      const bid = String(b._id), m = metaOf(bid); const st = m.status || 'active'; if (st === 'archived' || !b.isPublic) continue;
      if (m.visibility === 'enrolled' && !(uidS && enr.some(e => e.userId === uidS && e.batchId === bid))) continue;
      const lv = m.level || 'intermediate'; if (level && lv !== level) continue;
      for (const s of b.subjects || []) {
        const key = lv + '|' + norm(s.name); const a = asg.find(x => x.batchId === bid && norm(x.subjectName) === norm(s.name));
        const fid = (a && a.facultyId) || m.facultyId; const f = fid && facs.get(fid); if (!f) continue;
        const meta = lvlSubs(lv).find(x => norm(x.name) === norm(s.name)) || { name: s.name, icon: s.icon, color: s.color, level: lv };
        if (!out.has(key)) out.set(key, { name: meta.name, icon: meta.icon, color: meta.color, level: lv, order: meta.order || 0, faculties: new Map() });
        const e = out.get(key); if (!e.faculties.has(f.id)) e.faculties.set(f.id, { id: f.id, createdAt: f.createdAt || 0, name: f.name, initials: f.initials, color: f.color, pic: f.pic || '', institute: f.institute, order: f.order == null ? 5000 : f.order, batches: [] });
        e.faculties.get(f.id).batches.push({ batchId: bid, subjectId: String(s._id), order: m.order == null ? 5000 : m.order, color: m.color || '', label: m.label || '', institute: m.institute || f.institute || '', type: m.type || 'regular', status: st, premium: !!b.isPremium, chapters: (s.chapters || []).length, lectures: (s.chapters || []).reduce((x, c) => x + (c.lectures || []).length + (c.units || []).reduce((y, u) => y + (u.lectures || []).length, 0), 0), seconds: (s.chapters || []).reduce((x, c) => x + (c.lectures || []).reduce((y, l) => y + (l.duration || 0), 0), 0), startDate: m.startDate || null, addedAt: Math.max(m.createdAt || 0, (a && a.createdAt) || 0) });
      }
    }
    // keep catalogue subjects even when empty so the grid is stable
    const result = [...out.values()].map(e => ({ ...e, faculties: [...e.faculties.values()].sort((x, y) => (x.order - y.order) || x.name.localeCompare(y.name)).map(f => ({ ...f, batches: f.batches.sort((x, y) => (x.order - y.order)) })) }));
    for (const lv of level ? [level] : LEVELS) lvlSubs(lv).forEach(s => { if (!out.has(lv + '|' + norm(s.name))) result.push({ name: s.name, icon: s.icon, color: s.color, level: lv, order: s.order || 0, faculties: [] }); });
    return { levels: LEVELS, subjects: result.sort((a, b) => (a.order || 0) - (b.order || 0)), config: (({ botName, supportLink, whatsappLink, channelLink, backupChannelLink, proTipEnabled, themeSkin, monetagEnabled, monetagInApp, monetagZoneId, monetagLectureEvery, defaultLevel, premiumInfo, howToUrl, testSeriesUrl, testSeriesEnabled, testSeriesItems }) => ({ botName, supportLink, whatsappLink, channelLink, backupChannelLink, proTipEnabled, themeSkin, defaultLevel, premiumInfo, howToUrl, testSeriesUrl, testSeriesEnabled, testSeriesItems }))(config.get()) };
  }

  /** Student-facing gate used by the existing /api/batches routes: archived and enrolled-only batches are hidden. */
  function isBatchVisible(bid, userId) {
    const m = metaOf(bid); if ((m.status || 'active') === 'archived') return false;
    if (m.visibility !== 'enrolled') return true; if (!userId) return false; userId = String(userId);
    if (store.get('enrollment', `${userId}:${bid}`)) return true;
    const b = batchDb.getOne(bid); return !!(b && (b.premiumUsers || []).includes(userId));
  }

  return { isBatchVisible, HttpError, faculty, subject, batch, student, category, resource, notification, access, payments, dashboard, analytics, admins, config, logs, maintenance, catalog, log, constants: { LEVELS, BATCH_STATUS, BATCH_TYPES, RES_TYPES } };
}
module.exports = { createService, HttpError };
