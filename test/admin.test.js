'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { boot, signInit, OWNER } = require('./harness');
const owner = { id: OWNER, first_name: 'Owner' };
const seedUsers = (dbs, n = 5) => { for (let i = 1; i <= n; i++) dbs.userDb.upsert({ userId: String(5000 + i), firstName: 'Stu' + i, lastName: '', username: 'stu' + i, firstSeen: new Date(Date.now() - i * 864e5).toISOString(), lastSeen: new Date().toISOString() }); };
const seedBatch = (dbs, id, name, subs = ['Accounts']) => dbs.batchDb.upsert({ _id: id, name, isPublic: true, isPremium: false, premiumUsers: [], subjects: subs.map((s, i) => ({ _id: `${id}s${i}`, name: s, icon: '📘', color: '#7c6fe0', chapters: [{ _id: `${id}s${i}c1`, name: 'Ch1', lectures: [{ _id: `${id}l1`, name: 'L1', link: 'abc' }], units: [] }] })) });

test('auth: missing / forged / stale / unknown users are rejected', async () => {
  const t = await boot();
  assert.equal((await t.call(null, 'GET', '/api/admin/dashboard')).status, 401);
  assert.equal((await t.call('user=%7B%22id%22%3A1000%7D&hash=deadbeef', 'GET', '/api/admin/dashboard')).status, 401);
  assert.equal((await t.call(signInit(owner, { age: 999999 }), 'GET', '/api/admin/dashboard')).status, 401);
  assert.equal((await t.call({ id: 777, first_name: 'Rando' }, 'GET', '/api/admin/dashboard')).status, 403);
  assert.equal((await t.call(owner, 'GET', '/api/admin/dashboard')).status, 200);
  t.close();
});

test('faculty CRUD, duplicate prevention, validation, safe delete', async () => {
  const t = await boot(); seedBatch(t.dbs, 'b1', 'Nitin Goel Sep 2026');
  let r = await t.call(owner, 'POST', '/api/admin/faculties', { name: 'CA Nitin Goel', institute: 'PW' });
  assert.equal(r.status, 200); const fid = r.json.data.id; assert.equal(r.json.data.initials, 'NG');
  assert.equal((await t.call(owner, 'POST', '/api/admin/faculties', { name: 'ca nitin goel' })).status, 400);
  assert.equal((await t.call(owner, 'POST', '/api/admin/faculties', { name: '' })).status, 400);
  assert.equal((await t.call(owner, 'POST', '/api/admin/faculties', { name: 'X', pic: 'javascript:alert(1)' })).status, 400);
  r = await t.call(owner, 'PATCH', `/api/admin/faculties/${fid}`, { bio: 'Accounts expert', status: 'inactive' }); assert.equal(r.json.data.status, 'inactive');
  await t.call(owner, 'PATCH', '/api/admin/batches/b1', { facultyId: fid });
  assert.equal((await t.call(owner, 'DELETE', `/api/admin/faculties/${fid}`)).status, 409);
  assert.equal((await t.call(owner, 'DELETE', `/api/admin/faculties/${fid}?force=1`)).status, 200);
  assert.equal((await t.call(owner, 'GET', '/api/admin/batches/b1')).json.data.facultyId, null);
  t.close();
});

test('batch lifecycle: create/edit/activate/archive/restore/duplicate/delete + validation', async () => {
  const t = await boot(); seedUsers(t.dbs);
  let r = await t.call(owner, 'POST', '/api/admin/batches', { name: 'Batch A', level: 'foundation', startDate: '2026-05-01', endDate: '2026-09-01', isPublic: true });
  assert.equal(r.status, 200); const id = r.json.data.id; assert.match(id, /^[0-9a-f]{24}$/); assert.equal(r.json.data.status, 'upcoming');
  assert.equal((await t.call(owner, 'POST', '/api/admin/batches', { name: 'batch a' })).status, 400);
  assert.equal((await t.call(owner, 'POST', '/api/admin/batches', { name: 'B', startDate: '2026-09-01', endDate: '2026-05-01' })).status, 400);
  assert.equal((await t.call(owner, 'POST', '/api/admin/batches', { name: 'B', level: 'nope' })).status, 400);
  assert.equal((await t.call(owner, 'PATCH', `/api/admin/batches/${id}`, { price: -5 })).status, 400);
  r = await t.call(owner, 'POST', `/api/admin/batches/${id}/status`, { action: 'activate' }); assert.equal(r.json.data.status, 'active');
  r = await t.call(owner, 'POST', `/api/admin/batches/${id}/status`, { action: 'archive' }); assert.equal(r.json.data.status, 'archived'); assert.equal(r.json.data.isPublic, false);
  assert.equal((await t.call(owner, 'GET', '/api/admin/batches')).json.data.total, 0);
  assert.equal((await t.call(owner, 'GET', '/api/admin/batches?status=archived')).json.data.total, 1);
  r = await t.call(owner, 'POST', `/api/admin/batches/${id}/status`, { action: 'restore' }); assert.equal(r.json.data.status, 'active');
  r = await t.call(owner, 'POST', `/api/admin/batches/${id}/duplicate`); assert.equal(r.json.data.name, 'Batch A (Copy)'); assert.notEqual(r.json.data.id, id);
  await t.call(owner, 'POST', `/api/admin/batches/${id}/students`, { userId: '5001' });
  assert.equal((await t.call(owner, 'DELETE', `/api/admin/batches/${id}`)).status, 409);
  assert.equal((await t.call(owner, 'DELETE', `/api/admin/batches/${id}?force=1`)).status, 200);
  assert.equal(t.service.student.get({ role: 'super_admin', perms: new Set(['*']) }, '5001').batches.length, 0);
  t.close();
});

test('student mgmt: enroll/transfer/remove/bulk/block + premiumUsers sync + counts', async () => {
  const t = await boot(); seedUsers(t.dbs); seedBatch(t.dbs, 'b1', 'One'); seedBatch(t.dbs, 'b2', 'Two');
  assert.equal((await t.call(owner, 'POST', '/api/admin/batches/b1/students', { userId: '5001' })).status, 200);
  assert.deepEqual(t.dbs.batchDb.getOne('b1').premiumUsers, ['5001']);
  assert.equal((await t.call(owner, 'POST', '/api/admin/batches/b1/students', { userId: '99999' })).status, 404);
  let r = await t.call(owner, 'POST', '/api/admin/batches/b1/students', { userIds: ['5002', '5003', 'ghost'] }); assert.equal(r.json.data.added, 2); assert.equal(r.json.data.failed.length, 1);
  assert.equal((await t.call(owner, 'POST', '/api/admin/students/5001/transfer', { fromBatchId: 'b1', toBatchId: 'b2' })).status, 200);
  assert.deepEqual(t.dbs.batchDb.getOne('b1').premiumUsers.sort(), ['5002', '5003']); assert.deepEqual(t.dbs.batchDb.getOne('b2').premiumUsers, ['5001']);
  assert.equal((await t.call(owner, 'POST', '/api/admin/students/5001/transfer', { fromBatchId: 'b1', toBatchId: 'b2' })).status, 404);
  assert.equal((await t.call(owner, 'GET', '/api/admin/batches/b1/students')).json.data.total, 2);
  assert.equal((await t.call(owner, 'GET', '/api/admin/students?batchId=b2')).json.data.total, 1);
  assert.equal((await t.call(owner, 'GET', '/api/admin/students?unassigned=1')).json.data.total, 2);
  assert.equal((await t.call(owner, 'GET', '/api/admin/students?q=stu4')).json.data.total, 1);
  assert.equal((await t.call(owner, 'POST', '/api/admin/students/5004/block', { reason: 'spam' })).status, 200);
  assert.equal((await t.call(owner, 'GET', '/api/admin/students/5004')).json.data.status, 'blocked');
  assert.equal((await t.call(owner, 'POST', `/api/admin/students/${OWNER}/block`, {})).status, 404); // not a student row
  assert.equal((await t.call(owner, 'POST', '/api/admin/students/5004/unblock')).json.data.blocked, false);
  assert.equal((await t.call(owner, 'DELETE', '/api/admin/batches/b1/students/5002')).status, 200);
  assert.equal((await t.call(owner, 'DELETE', '/api/admin/batches/b1/students/5002')).status, 404);
  t.close();
});

test('faculty–batch integration: multi-faculty, subject-wise, multi-batch, catalog output', async () => {
  const t = await boot(); seedBatch(t.dbs, 'bA', 'Batch A', ['Accounts', 'Laws']); seedBatch(t.dbs, 'bB', 'Batch B', ['Accounts']);
  const f1 = (await t.call(owner, 'POST', '/api/admin/faculties', { name: 'CA Manish Mahajan', institute: 'JK Shah' })).json.data.id;
  const f2 = (await t.call(owner, 'POST', '/api/admin/faculties', { name: 'Prof Sagar Waghela' })).json.data.id;
  await t.call(owner, 'POST', '/api/admin/subjects', { name: 'Accounts', level: 'foundation', icon: '📖' }); await t.call(owner, 'POST', '/api/admin/subjects', { name: 'Laws', level: 'foundation' });
  for (const b of ['bA', 'bB']) await t.call(owner, 'PATCH', `/api/admin/batches/${b}`, { facultyId: f1, level: 'foundation', label: 'May 2026', status: 'active' });
  assert.equal((await t.call(owner, 'POST', '/api/admin/batches/bA/assignments', { subjectName: 'Laws', facultyId: f2 })).status, 200);
  assert.equal((await t.call(owner, 'POST', '/api/admin/batches/bA/assignments', { subjectName: 'Costing', facultyId: f2 })).status, 400);
  const d = (await t.call(owner, 'GET', '/api/admin/batches/bA')).json.data; assert.equal(d.faculties.length, 2);
  const fd = (await t.call(owner, 'GET', `/api/admin/faculties/${f1}`)).json.data; assert.equal(fd.batches.length, 2);
  const cat = (await t.call({ id: 8, first_name: 'S' }, 'GET', '/api/catalog?level=foundation')).json.data;
  const acc = cat.subjects.find(s => s.name === 'Accounts'), laws = cat.subjects.find(s => s.name === 'Laws');
  assert.equal(acc.faculties.length, 1); assert.equal(acc.faculties[0].batches.length, 2); assert.equal(laws.faculties[0].name, 'Prof Sagar Waghela');
  assert.equal(cat.subjects.find(s => s.name === 'Accounts').icon, '📖');
  await t.call(owner, 'POST', '/api/admin/batches/bA/status', { action: 'archive' });
  assert.equal((await t.call(null, 'GET', '/api/catalog')).json.data.subjects.find(s => s.name === 'Laws').faculties.length, 0);
  t.close();
});

test('RBAC enforced on the backend (not just hidden buttons)', async () => {
  const t = await boot(); seedUsers(t.dbs); seedBatch(t.dbs, 'b1', 'Mine'); seedBatch(t.dbs, 'b2', 'Not mine');
  const fid = (await t.call(owner, 'POST', '/api/admin/faculties', { name: 'Teacher T' })).json.data.id;
  await t.call(owner, 'PATCH', '/api/admin/batches/b1', { facultyId: fid });
  for (const [id, role, extra] of [[200001, 'faculty', { facultyId: fid }], [200002, 'moderator'], [200003, 'support'], [200004, 'admin']]) assert.equal((await t.call(owner, 'POST', '/api/admin/admins', { userId: String(id), role, ...extra })).status, 200);
  const fac = { id: 200001, first_name: 'F' }, mod = { id: 200002, first_name: 'M' }, sup = { id: 200003, first_name: 'S' }, adm = { id: 200004, first_name: 'A' };
  // faculty: sees only own batch, cannot edit batches, cannot touch others
  assert.equal((await t.call(fac, 'GET', '/api/admin/batches')).json.data.total, 1);
  assert.equal((await t.call(fac, 'GET', '/api/admin/batches/b2')).status, 403);
  assert.equal((await t.call(fac, 'POST', '/api/admin/batches', { name: 'x' })).status, 403);
  assert.equal((await t.call(fac, 'POST', '/api/admin/batches/b1/status', { action: 'archive' })).status, 403);
  assert.equal((await t.call(fac, 'GET', '/api/admin/admins')).status, 403);
  assert.equal((await t.call(fac, 'GET', '/api/admin/config')).status, 403);
  assert.equal((await t.call(fac, 'GET', '/api/admin/students')).json.data.total, 0);
  await t.call(owner, 'POST', '/api/admin/batches/b1/students', { userId: '5001' });
  assert.equal((await t.call(fac, 'GET', '/api/admin/students')).json.data.total, 1);
  assert.equal((await t.call(fac, 'GET', '/api/admin/students/5002')).status, 403);
  assert.equal((await t.call(fac, 'POST', '/api/admin/resources', { title: 'Own', url: 'https://x.io/a.pdf', batchIds: ['b1'] })).status, 200);
  assert.equal((await t.call(fac, 'POST', '/api/admin/resources', { title: 'Other', url: 'https://x.io/a.pdf', batchIds: ['b2'] })).status, 403);
  assert.equal((await t.call(fac, 'POST', '/api/admin/resources', { title: 'None', url: 'https://x.io/a.pdf', batchIds: [] })).status, 403);
  assert.equal((await t.call(fac, 'POST', '/api/admin/students/5001/block', {})).status, 403);
  // moderator / support
  assert.equal((await t.call(mod, 'POST', '/api/admin/students/5002/block', { reason: 'x' })).status, 200);
  assert.equal((await t.call(mod, 'POST', '/api/admin/batches', { name: 'nope' })).status, 403);
  assert.equal((await t.call(sup, 'POST', '/api/admin/students/5003/block', {})).status, 403);
  assert.equal((await t.call(sup, 'GET', '/api/admin/students')).status, 200);
  assert.equal((await t.call(sup, 'GET', '/api/admin/logs')).status, 403);
  // admin cannot manage admins; owner can; deactivated admin is locked out immediately
  assert.equal((await t.call(adm, 'POST', '/api/admin/admins', { userId: '300000', role: 'support' })).status, 403);
  assert.equal((await t.call(adm, 'POST', '/api/admin/batches', { name: 'Admin batch' })).status, 200);
  await t.call(owner, 'POST', '/api/admin/admins/200004/active', { active: false });
  assert.equal((await t.call(adm, 'GET', '/api/admin/dashboard')).status, 403);
  // per-admin permission overrides
  await t.call(owner, 'POST', '/api/admin/admins', { userId: '200003', role: 'support', extraPerms: ['logs.read'], deniedPerms: ['student.read'] });
  assert.equal((await t.call(sup, 'GET', '/api/admin/logs')).status, 200); assert.equal((await t.call(sup, 'GET', '/api/admin/students')).status, 403);
  // cannot demote/override owner; faculty role requires faculty
  assert.equal((await t.call(owner, 'POST', '/api/admin/admins', { userId: String(OWNER), role: 'support' })).status, 400);
  assert.equal((await t.call(owner, 'POST', '/api/admin/admins', { userId: '300001', role: 'faculty' })).status, 400);
  // denied attempts are audit-logged
  assert.ok((await t.call(owner, 'GET', '/api/admin/logs?action=security')).json.data.total > 0);
  t.close();
});

test('resources & categories: validation, filters, bulk assign, safe category delete', async () => {
  const t = await boot(); seedBatch(t.dbs, 'b1', 'One'); seedBatch(t.dbs, 'b2', 'Two');
  const cid = (await t.call(owner, 'POST', '/api/admin/categories', { name: 'Notes' })).json.data.id;
  assert.equal((await t.call(owner, 'POST', '/api/admin/categories', { name: 'notes' })).status, 400);
  assert.equal((await t.call(owner, 'POST', '/api/admin/resources', { title: 'Bad', url: 'ftp://x' })).status, 400);
  assert.equal((await t.call(owner, 'POST', '/api/admin/resources', { title: 'NoSrc' })).status, 400);
  assert.equal((await t.call(owner, 'POST', '/api/admin/resources', { title: 'T', url: 'https://a.io/x', type: 'exe' })).status, 400);
  assert.equal((await t.call(owner, 'POST', '/api/admin/resources', { title: 'T', url: 'https://a.io/x', batchIds: ['zzz'] })).status, 400);
  const rid = (await t.call(owner, 'POST', '/api/admin/resources', { title: 'Ch1 notes', type: 'pdf', url: 'https://a.io/x.pdf', categoryId: cid, batchIds: ['b1'] })).json.data.id;
  assert.equal((await t.call(owner, 'POST', '/api/admin/resources/bulk-assign', { ids: [rid], batchId: 'b2' })).json.data.updated, 1);
  assert.equal((await t.call(owner, 'GET', '/api/admin/resources?batchId=b2')).json.data.total, 1);
  assert.equal((await t.call(owner, 'GET', '/api/admin/resources?q=ch1&type=pdf')).json.data.total, 1);
  assert.equal((await t.call(owner, 'DELETE', `/api/admin/categories/${cid}`)).status, 409);
  await t.call(owner, 'DELETE', `/api/admin/resources/${rid}`); assert.equal((await t.call(owner, 'DELETE', `/api/admin/categories/${cid}`)).status, 200);
  t.close();
});

test('notifications: audiences, banned users skipped, escape HTML, scheduling, no double-send', async () => {
  const t = await boot(); seedUsers(t.dbs, 4); seedBatch(t.dbs, 'b1', 'One');
  await t.call(owner, 'POST', '/api/admin/batches/b1/students', { userIds: ['5001', '5002'] }); await t.call(owner, 'POST', '/api/admin/students/5002/block', {});
  assert.equal((await t.call(owner, 'POST', '/api/admin/notifications', { title: 'T', body: 'B', audience: 'batch' })).status, 400);
  const n1 = (await t.call(owner, 'POST', '/api/admin/notifications', { title: '<b>Hi</b>', body: 'Exam <soon>', audience: 'batch', batchIds: ['b1'], inApp: true })).json.data.id;
  assert.equal((await t.call(owner, 'GET', `/api/admin/notifications/${n1}/preview`)).json.data.recipients, 1);
  assert.equal((await t.call(owner, 'POST', `/api/admin/notifications/${n1}/send`)).json.data.queued, 1);
  assert.equal(t.sent.length, 1); assert.ok(t.sent[0][1].includes('&lt;b&gt;Hi&lt;/b&gt;')); assert.equal(t.dbs.announcementDb.all.length, 1);
  assert.equal((await t.call(owner, 'POST', `/api/admin/notifications/${n1}/send`)).status, 409);
  const n2 = (await t.call(owner, 'POST', '/api/admin/notifications', { title: 'All', body: 'x', audience: 'all' })).json.data.id; await t.call(owner, 'POST', `/api/admin/notifications/${n2}/send`);
  assert.equal(t.sent.length, 1 + 3);
  const n3 = (await t.call(owner, 'POST', '/api/admin/notifications', { title: 'Later', body: 'x', audience: 'users', userIds: ['5004'], scheduledAt: new Date(Date.now() - 1000).toISOString() })).json.data;
  assert.equal(n3.status, 'scheduled'); assert.equal(await t.service.notification.runScheduled(), 1); assert.equal(t.store.get('notification', n3.id).status, 'sent');
  t.close();
});

test('dashboard & analytics are database-driven; CSV neutralises formulas', async () => {
  const t = await boot(); seedUsers(t.dbs, 3); seedBatch(t.dbs, 'b1', 'One');
  let d = (await t.call(owner, 'GET', '/api/admin/dashboard')).json.data; assert.equal(d.students.total, 3); assert.equal(d.batches.total, 1); assert.equal(d.faculties.total, 0); assert.equal(d.lectures, 1);
  await t.call(owner, 'POST', '/api/admin/students/5001/block', {}); await t.call(owner, 'POST', '/api/admin/faculties', { name: 'F' });
  d = (await t.call(owner, 'GET', '/api/admin/dashboard')).json.data; assert.equal(d.students.blocked, 1); assert.equal(d.faculties.total, 1);
  t.dbs.userDb.upsert({ userId: '6000', firstName: '=HYPERLINK("x")', lastName: '', username: '', firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() });
  const csv = (await t.call(owner, 'GET', '/api/admin/reports/students')).json.data.csv; assert.ok(csv.includes(`"'=HYPERLINK`)); assert.ok(!csv.includes('"=HYPERLINK'));
  assert.equal((await t.call(owner, 'GET', '/api/admin/reports/passwords')).status, 400);
  t.close();
});

test('access, config, logs, backup/restore, idempotency, bad JSON', async () => {
  const t = await boot(); seedUsers(t.dbs, 2); seedBatch(t.dbs, 'b1', 'One');
  const r = await t.call(owner, 'POST', '/api/admin/students/5001/access', { hours: 24 }); assert.ok(new Date(r.json.data.expiresAt) > new Date());
  assert.equal((await t.call(owner, 'POST', '/api/admin/students/5001/access', { hours: 0 })).status, 400);
  assert.equal((await t.call(owner, 'POST', '/api/admin/students/5001/access', { revoke: true })).status, 200);
  assert.equal((await t.call(owner, 'PATCH', '/api/admin/config', { supportLink: 'javascript:x' })).status, 400);
  assert.equal((await t.call(owner, 'PATCH', '/api/admin/config', { supportLink: 'https://t.me/x', proTipEnabled: false })).json.data.proTipEnabled, false);
  const hdr = { 'x-request-id': 'abc' };
  await t.call(owner, 'POST', '/api/admin/faculties', { name: 'Once' }, hdr); await t.call(owner, 'POST', '/api/admin/faculties', { name: 'Once' }, hdr);
  assert.equal(t.store.list('faculty').filter(f => f.name === 'Once').length, 1);
  const bad = await fetch(`http://127.0.0.1:${t.port}/api/admin/faculties`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tg-init-data': signInit(owner) }, body: '{oops' }); assert.equal(bad.status, 400);
  const dump = (await t.call(owner, 'GET', '/api/admin/backup')).json.data; assert.ok(dump.entities.length > 0 && dump.batches.length === 1);
  const t2 = await boot(); assert.equal((await t2.call(owner, 'POST', '/api/admin/backup/restore', dump)).json.data.batchesRestored, 1);
  assert.equal(t2.store.list('faculty').length, 1); assert.equal((await t2.call(owner, 'POST', '/api/admin/backup/restore', dump)).json.data.entitiesRestored, 0);
  assert.equal((await t2.call(owner, 'POST', '/api/admin/backup/restore', { version: 9 })).status, 400);
  assert.ok((await t.call(owner, 'GET', '/api/admin/logs?q=faculty')).json.data.total >= 1);
  assert.equal((await t.call(owner, 'POST', '/api/admin/maintenance/prune-logs', { days: 1 })).status, 400);
  assert.equal((await t.call(owner, 'GET', '/api/admin/health')).json.data.batches, 1);
  t.close(); t2.close();
});

test('entity store mirrors writes via hooks and restoreMissing never overwrites', async () => {
  const w = [], d = []; const t = await boot({ hooks: { onWrite: (k, i) => w.push(k + ':' + i), onDelete: (k, i) => d.push(k + ':' + i) } });
  const id = (await t.call(owner, 'POST', '/api/admin/faculties', { name: 'M' })).json.data.id; await t.call(owner, 'DELETE', `/api/admin/faculties/${id}`);
  assert.ok(w.some(x => x === 'faculty:' + id)); assert.deepEqual(d, ['faculty:' + id]);
  t.store.put('config', 'main', { a: 1 }, { mirror: false }); assert.equal(t.store.restoreMissing([{ kind: 'config', id: 'main', data: { a: 2 } }]), 0); assert.equal(t.store.get('config', 'main').a, 1);
  t.close();
});

test('student visibility gate (used by existing /api/batches): archived + enrolled-only', async () => {
  const t = await boot(); seedUsers(t.dbs); seedBatch(t.dbs, 'b1', 'Open'); seedBatch(t.dbs, 'b2', 'Private'); seedBatch(t.dbs, 'b3', 'Gone');
  const V = t.service.isBatchVisible;
  assert.equal(V('b1', null), true);
  await t.call(owner, 'PATCH', '/api/admin/batches/b2', { visibility: 'enrolled' });
  assert.equal(V('b2', null), false); assert.equal(V('b2', '5001'), false);
  await t.call(owner, 'POST', '/api/admin/batches/b2/students', { userId: '5001' });
  assert.equal(V('b2', '5001'), true); assert.equal(V('b2', '5002'), false);
  await t.call(owner, 'POST', '/api/admin/batches/b3/status', { action: 'archive' }); assert.equal(V('b3', '5001'), false);
  await t.call(owner, 'POST', '/api/admin/batches/b3/status', { action: 'restore' }); assert.equal(V('b3', '5001'), true);
  t.close();
});
