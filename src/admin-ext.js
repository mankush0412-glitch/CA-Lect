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
    P('/lectures/:lid/number', 'batch.write', (c) => content.setLectureNumber(c.p.lid, c.b.n));
    P('/chapters/:cid/notes/:nid/number', 'batch.write', (c) => content.setNoteNumber(c.p.cid, c.p.nid, c.b.n));
    P('/lectures/:lid/move', 'batch.write', (c) => content.moveLecture(c.p.lid, c.b.dir));
    U('/chapters/:cid/notes/:nid', 'batch.write', (c) => content.renameNote(c.p.cid, c.p.nid, c.b.name));
    D('/chapters/:cid/notes/:nid', 'batch.write', (c) => content.deleteNote(c.p.cid, c.p.nid));
    /** ▲▼ ordering for faculties, subjects and batches: neighbours swap places (what students see follows the same order). */
    const swap = (items, id, dir, set) => { const i = items.findIndex((r) => String(r.id) === String(id)); if (i < 0) throw new HttpError(404, 'Not found'); const j = i + (dir === 'up' ? -1 : 1); if (j < 0 || j >= items.length) return { moved: false }; const a = items.slice(); [a[i], a[j]] = [a[j], a[i]]; a.forEach((r, k) => { if ((r.order == null ? 5000 : r.order) !== k * 10) set(r.id, k * 10); }); return { moved: true }; };
    const ord = (r) => (r.order == null ? 5000 : r.order);
    const sorted = (rows) => rows.slice().sort((a, b) => (ord(a) - ord(b)) || String(a.name).localeCompare(String(b.name)));
    /* Quick "add teacher to subject": makes the batch + subject entry in one go (attempt label optional). */
    P('/subjects/:id/teachers', 'batch.write', (c) => {
      const sub = S.subject.list(c.actor, { size: 1000 }).items.find((x) => String(x.id) === c.p.id); if (!sub) throw new HttpError(404, 'Subject not found');
      const fac = S.faculty.list(c.actor, { size: 1000 }).items.find((x) => String(x.id) === String(c.b.facultyId)); if (!fac) throw new HttpError(400, 'Choose a teacher');
      const label = String(c.b.label || '').trim(); const type = c.b.type === 'fastrack' ? 'fastrack' : 'regular';
      const b = S.batch.create(c.actor, { name: `${sub.name} – ${fac.name}${label ? ' – ' + label : ''}${type === 'fastrack' ? ' (Fastrack)' : ''}`, level: sub.level, type, institute: fac.institute || '', facultyId: String(fac.id), label, isPublic: true, status: 'active' });
      const ns = content.addSubject(b.id, { name: sub.name, icon: sub.icon, color: sub.color }); log(c, 'subject.addTeacher', sub.name, fac.name); return { batchId: b.id, subjectId: ns._id };
    });
    /* "New attempt": optionally relabel the current batch as the old attempt, then clone its subjects + chapter names (no lectures) into a new batch. */
    P('/batches/:id/new-attempt', 'batch.write', (c) => {
      const src = S.batch.get(c.actor, c.p.id); const doc = db.batch.getOne(c.p.id); const nl = String(c.b.newLabel || '').trim(); const ol = String(c.b.oldLabel || '').trim();
      if (!nl) throw new HttpError(400, 'New attempt label is required'); if (ol) S.batch.update(c.actor, c.p.id, { label: ol }); S.batch.update(c.actor, c.p.id, { featured: false });
      const base = src.label && src.name.includes(src.label) ? src.name.replace(src.label, nl) : `${src.name} – ${nl}`;
      const nb = S.batch.create(c.actor, { name: base === src.name ? `${src.name} – ${nl}` : base, level: src.level, type: src.type, institute: src.institute, facultyId: src.facultyId || '', label: nl, isPublic: true, status: 'active', featured: true, isPremium: src.isPremium, price: src.price, description: src.description });
      for (const sj of (doc && doc.subjects) || []) { const ns = content.addSubject(nb.id, { name: sj.name, icon: sj.icon, color: sj.color }); if (c.b.copyChapters !== false) for (const ch of sj.chapters || []) content.addChapter(nb.id, ns._id, ch.name); }
      log(c, 'batch.newAttempt', src.name, nl); return { batchId: nb.id };
    });
    /* All teacher/attempt batches of one subject (for the subject screen: set latest, delete). */
    G('/subjects/:id/attempts', 'batch.read', (c) => {
      const sub = S.subject.list(c.actor, { size: 1000 }).items.find((x) => String(x.id) === c.p.id); if (!sub) throw new HttpError(404, 'Subject not found'); const nm = (x) => String(x || '').trim().toLowerCase();
      return db.batch.getAll().filter((b) => (b.subjects || []).some((x) => nm(x.name) === nm(sub.name))).map((b) => S.batch.get(c.actor, String(b._id))).filter((x) => x.level === sub.level)
        .map((x) => ({ id: x.id, name: x.name, label: x.label, type: x.type, faculty: x.facultyName || '', featured: !!x.featured, chapters: x.chapters, lectures: x.lectures, students: x.students }));
    });
    /* Choose which attempt is the "Latest" shown on the teacher card (one per teacher + type). */
    P('/batches/:id/feature', 'batch.write', (c) => {
      const me = S.batch.get(c.actor, c.p.id); const on = c.b.on !== false;
      if (on) for (const o of S.batch.list(c.actor, { size: 1000 }).items) if (String(o.id) !== c.p.id && o.featured && o.level === me.level && o.type === me.type && String(o.facultyId || '') === String(me.facultyId || '')) S.batch.update(c.actor, String(o.id), { featured: false });
      S.batch.update(c.actor, c.p.id, { featured: on }); log(c, 'batch.feature', me.name, on ? 'on' : 'off'); return { featured: on };
    });
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
