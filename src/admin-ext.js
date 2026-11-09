'use strict';
/** Extra admin routes: batch content structure (subjects/chapters/lectures/notes) and ad servers. */
module.exports = function adminExt({ content, access, db }) {
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
    D('/chapters/:cid/notes/:nid', 'batch.write', (c) => content.deleteNote(c.p.cid, c.p.nid));
    G('/adservers', 'config.read', () => access.adminServers.list());
    P('/adservers', 'config.write', (c) => { const r = access.adminServers.save(c.b); log(c, 'adserver.create', r.name); return r; });
    U('/adservers/:id', 'config.write', (c) => { const r = access.adminServers.save(c.b, c.p.id); log(c, 'adserver.update', r.name); return r; });
    D('/adservers/:id', 'config.write', (c) => { const r = access.adminServers.remove(c.p.id); log(c, 'adserver.delete', c.p.id); return r; });
  };
};
