'use strict';
/** Extra admin routes: batch content structure (subjects/chapters/lectures/notes) and ad servers. */
module.exports = function adminExt({ content, access, db, botUsername = () => '' }) {
  const crypto = require('crypto'); const { HttpError } = require('./service');
  /** Short-lived link that opens the bot in an upload/replace session for staff. */
  const link = (job) => { const t = crypto.randomBytes(8).toString('hex'); db.kv.set('up:' + t, JSON.stringify({ ...job, exp: Date.now() + 30 * 60000 })); const u = botUsername(); return { token: t, url: u ? `https://t.me/${u}?start=u_${t}` : '' , botConfigured: !!u }; };
  return ({ G, P, U, D, S }) => {
    const log = (c, a, t, d) => S.log(c.actor, a, t, d);
    G('/batches/:id/content', 'batch.read', (c) => { const b = db.batch.getOne(c.p.id); if (!b) return { subjects: [] }; return { id: b._id, name: b.name, subjects: (b.subjects || []).map((s) => ({ id: s._id, name: s.name, chapters: (s.chapters || []).map((ch, i) => ({ id: ch._id, number: i + 1, name: ch.name, lectures: (ch.lectures || []).map((l, k) => ({ id: l._id, number: k + 1, name: l.name, duration: l.duration || 0, fileType: l.fileType })), notes: (ch.notes || []).map((n) => ({ id: n._id, name: n.name, fileType: n.fileType })) })) })) }; });
    P('/batches/:id/subjects', 'batch.write', (c) => { const r = content.addSubject(c.p.id, c.b); log(c, 'content.addSubject', c.p.id, r.name); return r; });
    U('/batches/:id/subjects/:sid', 'batch.write', (c) => { const r = content.renameSubject(c.p.id, c.p.sid, c.b.name); log(c, 'content.renameSubject', c.p.id, r.name); return r; });
    D('/batches/:id/subjects/:sid', 'batch.write', (c) => { const r = content.deleteSubject(c.p.id, c.p.sid); log(c, 'content.deleteSubject', c.p.id, c.p.sid); return r; });
    P('/batches/:id/subjects/:sid/chapters', 'batch.write', (c) => { const r = content.addChapter(c.p.id, c.p.sid, c.b.name); log(c, 'content.addChapter', c.p.id, r.name); return r; });
    U('/batches/:id/subjects/:sid/chapters/:cid', 'batch.write', (c) => content.renameChapter(c.p.id, c.p.sid, c.p.cid, c.b.name));
    D('/batches/:id/subjects/:sid/chapters/:cid', 'batch.write', (c) => { const r = content.deleteChapter(c.p.id, c.p.sid, c.p.cid); log(c, 'content.deleteChapter', c.p.id, c.p.cid); return r; });
    P('/batches/:id/subjects/:sid/chapters/:cid/move', 'batch.write', (c) => content.moveChapter(c.p.id, c.p.sid, c.p.cid, c.b.dir));
    U('/lectures/:lid', 'batch.write', (c) => content.renameLecture(c.p.lid, c.b.name));
    D('/lectures/:lid', 'batch.write', (c) => { const r = content.deleteLecture(c.p.lid); log(c, 'content.deleteLecture', c.p.lid); return r; });
    P('/chapters/:cid/upload-link', 'batch.write', (c) => { const e = content.index().ch.get(c.p.cid); if (!e) throw new HttpError(404, 'Chapter not found'); return link({ k: 'add', cid: c.p.cid }); });
    P('/lectures/:lid/replace-link', 'batch.write', (c) => { if (!content.index().lec.get(c.p.lid)) throw new HttpError(404, 'Lecture not found'); return link({ k: 'rl', lid: c.p.lid }); });
    P('/chapters/:cid/notes/:nid/replace-link', 'batch.write', (c) => link({ k: 'rn', cid: c.p.cid, nid: c.p.nid }));
    P('/lectures/:lid/move', 'batch.write', (c) => content.moveLecture(c.p.lid, c.b.dir));
    U('/chapters/:cid/notes/:nid', 'batch.write', (c) => content.renameNote(c.p.cid, c.p.nid, c.b.name));
    D('/chapters/:cid/notes/:nid', 'batch.write', (c) => content.deleteNote(c.p.cid, c.p.nid));
    /** ▲▼ ordering for faculties, subjects and batches: neighbours swap places (what students see follows the same order). */
    const swap = (items, id, dir, set) => { const i = items.findIndex((r) => String(r.id) === String(id)); if (i < 0) throw new HttpError(404, 'Not found'); const j = i + (dir === 'up' ? -1 : 1); if (j < 0 || j >= items.length) return { moved: false }; const a = items.slice(); [a[i], a[j]] = [a[j], a[i]]; a.forEach((r, k) => { if ((r.order == null ? 5000 : r.order) !== k * 10) set(r.id, k * 10); }); return { moved: true }; };
    const ord = (r) => (r.order == null ? 5000 : r.order);
    const sorted = (rows) => rows.slice().sort((a, b) => (ord(a) - ord(b)) || String(a.name).localeCompare(String(b.name)));
    P('/faculties/:id/move', 'faculty.write', (c) => { const all = S.faculty.list(c.actor, { size: 1000 }).items; const me = all.find((f) => String(f.id) === c.p.id); if (!me) throw new HttpError(404, 'Faculty not found'); return swap(sorted(all.filter((f) => f.status === me.status)), c.p.id, c.b.dir, (id, order) => S.faculty.update(c.actor, id, { order })); });
    P('/subjects/:id/move', 'subject.write', (c) => { const all = S.subject.list(c.actor, { size: 1000 }).items; const me = all.find((s) => String(s.id) === c.p.id); if (!me) throw new HttpError(404, 'Subject not found'); return swap(sorted(all.filter((s) => s.level === me.level)), c.p.id, c.b.dir, (id, order) => S.subject.update(c.actor, id, { order })); });
    P('/batches/:id/move', 'batch.write', (c) => { const all = S.batch.list(c.actor, { size: 1000 }).items; const me = all.find((b) => String(b.id) === c.p.id); if (!me) throw new HttpError(404, 'Batch not found'); return swap(sorted(all.filter((b) => b.level === me.level && (b.type || 'regular') === (me.type || 'regular'))), c.p.id, c.b.dir, (id, order) => S.batch.update(c.actor, id, { order })); });
    G('/suspended', 'student.block', () => access.suspendedList());
    P('/suspended/:id/lift', 'student.block', (c) => { const had = access.unsuspend(c.p.id); log(c, 'student.unsuspend', c.p.id); return { lifted: had }; });
    G('/adservers', 'config.read', () => access.adminServers.list());
    P('/adservers', 'config.write', (c) => { const r = access.adminServers.save(c.b); log(c, 'adserver.create', r.name); return r; });
    U('/adservers/:id', 'config.write', (c) => { const r = access.adminServers.save(c.b, c.p.id); log(c, 'adserver.update', r.name); return r; });
    D('/adservers/:id', 'config.write', (c) => { const r = access.adminServers.remove(c.p.id); log(c, 'adserver.delete', c.p.id); return r; });
  };
};
