'use strict';
/** Batch → subject → chapter → lecture/notes structure. Used by the upload flow, the admin panel and the Mini App. */
const crypto = require('crypto');
const { HttpError } = require('./service');
const bad = (m) => new HttpError(400, m); const nf = (m) => new HttpError(404, m);
const nid = () => crypto.randomBytes(8).toString('hex');
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
/** Tidy file names: drop @channel tags, [1080p] style tags and separators. */
const tidy = (n) => String(n || '').replace(/@\w+/g, ' ').replace(/[\[(]\s*(?:\d{3,4}p|hd|fhd|uhd|x264|hevc)\s*[\])]/gi, ' ').replace(/\s+/g, ' ').replace(/^[\s._-]+|[\s._-]+$/g, '').trim();
/** Lecture number written at the start of a name: "L05 - X", "Lecture 5 X", "05. X", "Class 12". */
const numFromName = (n) => { const m = /^\s*(?:lecture|lec|class|session|day|part|l)?[\s._#-]*0*(\d{1,3})(?![\d])(?=[\s._:)-]|$)/i.exec(String(n || '')); return m ? parseInt(m[1], 10) : 0; };
const stripExt = (n) => String(n || '').replace(/\.(mp4|mkv|mov|avi|webm|pdf|docx?|pptx?|xlsx?|jpe?g|png)$/i, '').replace(/[_]+/g, ' ').trim();

function createContent({ db, mirrorBatch }) {
  let idx = null, idxV = -1;
  function index() {
    if (idx && idxV === db.batch.version) return idx; const lec = new Map(), ch = new Map();
    for (const b of db.batch.getAll()) for (const s of b.subjects || []) for (const c of s.chapters || []) { ch.set(c._id, { batch: b, subject: s, chapter: c }); for (const l of c.lectures || []) lec.set(l._id, { batch: b, subject: s, chapter: c, lecture: l }); }
    idx = { lec, ch }; idxV = db.batch.version; return idx;
  }
  const save = (b) => { db.batch.upsert(b); if (mirrorBatch) mirrorBatch(String(b._id)); return b; };
  function loc(batchId, subjectId, chapterId) {
    const b = db.batch.getOne(batchId); if (!b) throw nf('Batch not found'); const s = (b.subjects || []).find((x) => x._id === subjectId); if (!s) throw nf('Subject not found');
    const c = chapterId ? (s.chapters || []).find((x) => x._id === chapterId) : null; if (chapterId && !c) throw nf('Chapter not found'); return { b, s, c };
  }
  const api = {
    index,
    addSubject(batchId, { name, icon, color }) { const b = db.batch.getOne(batchId); if (!b) throw nf('Batch not found'); name = clean(name, 40); if (!name) throw bad('Subject name is required'); b.subjects = b.subjects || []; if (b.subjects.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw bad('This batch already has that subject'); const s = { _id: nid(), name, icon: clean(icon, 4) || '', color: /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#7c7be6', chapters: [] }; b.subjects.push(s); save(b); return s; },
    renameSubject(batchId, subjectId, name) { const { b, s } = loc(batchId, subjectId); s.name = clean(name, 40) || s.name; save(b); return s; },
    deleteSubject(batchId, subjectId) { const { b } = loc(batchId, subjectId); b.subjects = b.subjects.filter((x) => x._id !== subjectId); save(b); return { deleted: true }; },
    addChapter(batchId, subjectId, name) { const { b, s } = loc(batchId, subjectId); name = clean(name, 80); if (!name) throw bad('Chapter name is required'); const c = { _id: nid(), name, lectures: [], notes: [], units: [] }; s.chapters.push(c); save(b); return c; },
    renameChapter(batchId, subjectId, chapterId, name) { const { b, c } = loc(batchId, subjectId, chapterId); c.name = clean(name, 80) || c.name; save(b); return c; },
    deleteChapter(batchId, subjectId, chapterId) { const { b, s } = loc(batchId, subjectId, chapterId); s.chapters = s.chapters.filter((x) => x._id !== chapterId); save(b); return { deleted: true }; },
    moveChapter(batchId, subjectId, chapterId, dir) { const { b, s } = loc(batchId, subjectId, chapterId); const i = s.chapters.findIndex((x) => x._id === chapterId), j = i + (dir === 'up' ? -1 : 1); if (j < 0 || j >= s.chapters.length) return { moved: false }; [s.chapters[i], s.chapters[j]] = [s.chapters[j], s.chapters[i]]; save(b); return { moved: true }; },
    addLecture(batchId, subjectId, chapterId, m) {
      const { b, c } = loc(batchId, subjectId, chapterId); if (!m.channelMsgId) throw bad('Missing storage message id'); c.lectures = c.lectures || [];
      const n = c.lectures.length + 1; const l = { _id: nid(), name: clean(m.name, 80) || `Lecture ${String(n).padStart(2, '0')}`, duration: Math.max(0, Math.round(m.duration || 0)), fileType: m.fileType || 'video', size: m.size || 0, channelMsgId: m.channelMsgId, addedAt: Date.now() }; if (m.fid) l.fid = String(m.fid);
      const pos = Math.floor(Number(m.position)); if (pos >= 1 && pos <= c.lectures.length) c.lectures.splice(pos - 1, 0, l); else c.lectures.push(l); save(b); return l;
    },
    renameLecture(lectureId, name) { const e = index().lec.get(lectureId); if (!e) throw nf('Lecture not found'); const b = db.batch.getOne(e.batch._id); const l = b.subjects.find((s) => s._id === e.subject._id).chapters.find((c) => c._id === e.chapter._id).lectures.find((x) => x._id === lectureId); l.name = clean(name, 80) || l.name; save(b); return l; },
    deleteLecture(lectureId) { const e = index().lec.get(lectureId); if (!e) throw nf('Lecture not found'); const b = db.batch.getOne(e.batch._id); const c = b.subjects.find((s) => s._id === e.subject._id).chapters.find((x) => x._id === e.chapter._id); c.lectures = c.lectures.filter((l) => l._id !== lectureId); save(b); return { deleted: true }; },
    addNote(batchId, subjectId, chapterId, m) { const { b, c } = loc(batchId, subjectId, chapterId); if (!m.channelMsgId) throw bad('Missing storage message id'); c.notes = c.notes || []; const n = { _id: nid(), name: clean(stripExt(m.name), 80) || `Notes ${c.notes.length + 1}`, fileType: m.fileType || 'document', channelMsgId: m.channelMsgId }; if (m.fid) n.fid = String(m.fid); c.notes.push(n); save(b); return n; },
    /** Position helpers: lecture / note numbers are 1-based positions inside a chapter. */
    lectureAt(chapterId, n) { const e = index().ch.get(chapterId); return e ? (e.chapter.lectures || [])[Math.floor(n) - 1] || null : null; },
    noteAt(chapterId, n) { const e = index().ch.get(chapterId); return e ? (e.chapter.notes || [])[Math.floor(n) - 1] || null : null; },
    numberOf(lectureId) { const e = index().lec.get(lectureId); return e ? (e.chapter.lectures || []).findIndex((l) => l._id === lectureId) + 1 : 0; },
    hasFile(chapterId, fid) { const e = index().ch.get(chapterId); if (!e || !fid) return null; const L = (e.chapter.lectures || []).findIndex((l) => l.fid === fid); if (L >= 0) return { kind: 'lecture', number: L + 1, name: e.chapter.lectures[L].name }; const N = (e.chapter.notes || []).findIndex((l) => l.fid === fid); return N >= 0 ? { kind: 'note', number: N + 1, name: e.chapter.notes[N].name } : null; },
    /** Move a lecture to number n inside its chapter (others shift). */
    setLectureNumber(lectureId, n) { const e = index().lec.get(lectureId); if (!e) throw nf('Lecture not found'); const b = db.batch.getOne(e.batch._id); const c = b.subjects.find((s) => s._id === e.subject._id).chapters.find((x) => x._id === e.chapter._id); const i = c.lectures.findIndex((l) => l._id === lectureId); const j = Math.max(0, Math.min(c.lectures.length - 1, Math.floor(Number(n)) - 1 || 0)); const [l] = c.lectures.splice(i, 1); c.lectures.splice(j, 0, l); save(b); return { number: j + 1 }; },
    setNoteNumber(chapterId, noteId, n) { const e = index().ch.get(chapterId); if (!e) throw nf('Chapter not found'); const b = db.batch.getOne(e.batch._id); const c = b.subjects.find((s) => s._id === e.subject._id).chapters.find((x) => x._id === chapterId); const i = (c.notes || []).findIndex((x) => x._id === noteId); if (i < 0) throw nf('Note not found'); const j = Math.max(0, Math.min(c.notes.length - 1, Math.floor(Number(n)) - 1 || 0)); const [x] = c.notes.splice(i, 1); c.notes.splice(j, 0, x); save(b); return { number: j + 1 }; },
    /** Swap the stored file of a lecture (same id, name, position — plans and progress survive). */
    replaceLecture(lectureId, m) { const e = index().lec.get(lectureId); if (!e) throw nf('Lecture not found'); if (!m.channelMsgId) throw bad('Missing storage message id'); const b = db.batch.getOne(e.batch._id); const l = b.subjects.find((s) => s._id === e.subject._id).chapters.find((c) => c._id === e.chapter._id).lectures.find((x) => x._id === lectureId); Object.assign(l, { channelMsgId: m.channelMsgId, duration: Math.max(0, Math.round(m.duration || 0)), size: m.size || 0, fileType: m.fileType || l.fileType, replacedAt: Date.now(), ...(m.fid ? { fid: String(m.fid) } : {}) }); save(b); return l; },
    moveLecture(lectureId, dir) { const e = index().lec.get(lectureId); if (!e) throw nf('Lecture not found'); const b = db.batch.getOne(e.batch._id); const c = b.subjects.find((s) => s._id === e.subject._id).chapters.find((x) => x._id === e.chapter._id); const i = c.lectures.findIndex((l) => l._id === lectureId), j = i + (dir === 'up' ? -1 : 1); if (j < 0 || j >= c.lectures.length) return { moved: false }; [c.lectures[i], c.lectures[j]] = [c.lectures[j], c.lectures[i]]; save(b); return { moved: true }; },
    replaceNote(chapterId, noteId, m) { const e = index().ch.get(chapterId); if (!e) throw nf('Chapter not found'); if (!m.channelMsgId) throw bad('Missing storage message id'); const b = db.batch.getOne(e.batch._id); const c = b.subjects.find((s) => s._id === e.subject._id).chapters.find((x) => x._id === chapterId); const n = (c.notes || []).find((x) => x._id === noteId); if (!n) throw nf('Note not found'); Object.assign(n, { channelMsgId: m.channelMsgId, fileType: m.fileType || n.fileType, ...(m.fid ? { fid: String(m.fid) } : {}) }); save(b); return n; },
    renameNote(chapterId, noteId, name) { const e = index().ch.get(chapterId); if (!e) throw nf('Chapter not found'); const b = db.batch.getOne(e.batch._id); const c = b.subjects.find((s) => s._id === e.subject._id).chapters.find((x) => x._id === chapterId); const n = (c.notes || []).find((x) => x._id === noteId); if (!n) throw nf('Note not found'); n.name = clean(name, 80) || n.name; save(b); return n; },
    deleteNote(chapterId, noteId) { const e = index().ch.get(chapterId); if (!e) throw nf('Chapter not found'); const b = db.batch.getOne(e.batch._id); const c = b.subjects.find((s) => s._id === e.subject._id).chapters.find((x) => x._id === chapterId); c.notes = (c.notes || []).filter((n) => n._id !== noteId); save(b); return { deleted: true }; },
    /** Student-safe view of one batch subject: no storage ids, lecture numbers and totals. */
    view(batchId, subjectId) {
      const { b, s } = loc(batchId, subjectId);
      return { batchId: b._id, subjectId: s._id, subject: s.name, chapters: s.chapters.map((c, i) => { const ls = c.lectures || []; return { id: c._id, number: i + 1, name: c.name, lectures: ls.map((l, k) => ({ id: l._id, number: k + 1, name: l.name, duration: l.duration || 0, fileType: l.fileType })), notes: (c.notes || []).map((n) => ({ id: n._id, name: n.name })), seconds: ls.reduce((x, l) => x + (l.duration || 0), 0) }; }) };
    },
    suggestName: (fileName, caption) => clean(caption, 80) || clean(tidy(stripExt(fileName)), 80),
    numFromName,
    /** Where a lecture named like "Lecture 5 ..." belongs: before the first lecture with a bigger number (0 = end). */
    autoPosition(chapterId, name) { const N = numFromName(name); const e = index().ch.get(chapterId); if (!N || !e) return 0; const ls = e.chapter.lectures || []; const i = ls.findIndex((l) => { const k = numFromName(l.name); return k && k > N; }); return i >= 0 ? i + 1 : 0; },
  };
  return api;
}
module.exports = { createContent };
