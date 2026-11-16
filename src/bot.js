'use strict';
const { esc, hm } = require('./access');
const TZ = 330 * 60000;

function createBot({ tg, db, store, service, content, access, planner, config, now = () => Date.now(), botUsername = () => '', onBan = null, onUnban = null }) {
  const opts = { onBan, onUnban };
  const cfg = () => service.config.get();
  const appUrl = () => (config.publicUrl ? `${config.publicUrl}/app/` : '');
  const staffName = (m) => [m.from.first_name, m.from.last_name].filter(Boolean).join(' ');
  const webBtn = (text, path = '') => (appUrl() ? { text, web_app: { url: appUrl() + path } } : null);
  const sessions = new Map(); const queues = new Map(); const SESSION_MS = 4 * 3600000;

  const enqueue = (uid, fn) => { const prev = queues.get(uid) || Promise.resolve(); const next = prev.catch(() => {}).then(fn); queues.set(uid, next); next.finally(() => { if (queues.get(uid) === next) queues.delete(uid); }); return next; };
  const safe = async (fn) => { try { return await fn(); } catch (e) { return null; } };

  // ── level choice / force-join / welcome ──────────────────────────────────
  const LV = { foundation: 'CA Foundation', intermediate: 'CA Intermediate' };
  const cap1 = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  /** Channels a student of `level` must join: the shared list plus the level's own list. */
  const channels = (level) => service.config.joinFor(level);
  const joined = (uid, level) => db.kv.get(`joined2:${uid}:${level}`) === '1';
  const userLevel = (uid) => { const u = db.user.findOne(String(uid)); return u && LV[u.level] ? u.level : ''; };
  /** Tidy chat: every menu message the bot sends is remembered and deleted the next time a new menu is sent (e.g. each /start). The pinned how-to video is the only thing that stays. */
  const tidy = () => cfg().cleanChat !== false;
  function uiTrack(chatId, m) { if (!m || !m.message_id || !tidy()) return m; let a = []; try { a = JSON.parse(db.kv.get('ui:' + chatId) || '[]'); } catch (e) {} a.push(m.message_id); db.kv.set('ui:' + chatId, JSON.stringify(a.slice(-30))); return m; }
  async function uiClear(chatId, extra) {
    if (!tidy()) return; let a = []; try { a = JSON.parse(db.kv.get('ui:' + chatId) || '[]'); } catch (e) {} db.kv.set('ui:' + chatId, '[]'); const ids = [...a, ...(extra ? [extra] : [])]; if (!ids.length) return;
    try { await tg.call('deleteMessages', { chat_id: chatId, message_ids: ids.slice(-100) }); } catch (e) { await Promise.allSettled(ids.map((id) => tg.call('deleteMessage', { chat_id: chatId, message_id: id }))); }
  }
  async function sendLevelChoice(chatId, name, startMsgId) {
    await uiClear(chatId, startMsgId);
    const rows = [[{ text: '✅ CA Foundation', callback_data: 'lv:foundation' }], [{ text: '✅ CA Intermediate', callback_data: 'lv:intermediate' }]];
    return uiTrack(chatId, await tg.sendMessage(chatId, `🎓 <b>Choose Your Level</b>\n\nHey ${esc(name || 'there')}! Select the course you are preparing for.\nWe will set up lectures, notes and updates for it.\n\n\n👇 Tap one option below`, { reply_markup: kb(rows) }));
  }
  async function sendJoinGate(chatId, level) {
    await uiClear(chatId);
    const rows = channels(level).map((c) => [{ text: `📢 Join ${c.title}`, url: c.url }]); rows.push([{ text: "✅ I've Joined", callback_data: 'joined:' + level }]);
    return uiTrack(chatId, await tg.sendMessage(chatId, `🔒 <b>Unlock ${esc(LV[level])}</b>\n\nJoin the channel${channels(level).length === 1 ? '' : 's'} below to unlock lectures, notes and your study planner.\n\n👉 Tap each button to join, then press <b>✅ I've Joined</b>.`, { reply_markup: kb(rows) }));
  }
  async function sendWelcome(chatId, user, level, startMsgId) {
    await uiClear(chatId, startMsgId);
    const c = cfg(); const name = esc(user.first_name || 'there'); const custom = c.welcomeText ? esc(c.welcomeText).replace(/\{name\}/g, name) : null;
    const text = custom || `👋 Hey, <b>${name}</b>!\n\nTo watch lectures and view the notes, tap the 🎓 <b>Open WebApp</b> button.\n\nUse the ❓ <b>How to watch lectures?</b> button if you need guidance.`;
    const rows = []; const w = webBtn('🎓 Open WebApp'); if (w) rows.push([w]);
    rows.push([{ text: '❓ How to watch lectures?', callback_data: 'how' }]);
    const seen = new Set(); const add = (title, url) => { if (url && !seen.has(url)) { seen.add(url); rows.push([{ text: title, url }]); } };
    channels(level).forEach((ch) => add(`📢 Join ${ch.title}`, ch.url)); add('📢 Join Channel', c.channelLink); add('📢 Join Backup Channel', c.backupChannelLink); add('💬 Join WhatsApp Channel', c.whatsappLink);
    if (level) rows.push([{ text: `🔄 Level: ${LV[level]} · Change`, callback_data: 'lvchange' }]);
    return uiTrack(chatId, await tg.sendMessage(chatId, text, { reply_markup: kb(rows) }));
  }
  /** Runs after the level is known: straight to the welcome + Open WebApp. The force-join gate is shown inside the WebApp. */
  async function proceed(chatId, user, level, startMsgId) { return sendWelcome(chatId, user, level, startMsgId); }
  async function verifyJoined(uid, level) {
    for (const ch of channels(level)) { if (!ch.chatId) continue; try { const m = await tg.getChatMember(ch.chatId, uid); if (['left', 'kicked'].includes(m.status)) return false; } catch (e) { /* bot cannot see the channel: trust the student */ } }
    return true;
  }
  const referText = (uid) => { const c = cfg(); const link = botUsername() ? `https://t.me/${botUsername()}?start=ref_${uid}` : ''; return `🎁 <b>Refer & Earn</b>\n\nShare your personal link with friends. For every friend who joins you get <b>+${c.referralHours}h access</b> and <b>${c.referralPoints} points</b>.\n\n${link ? `🔗 <code>${link}</code>` : 'Open the app → Referral tab to get your link.'}`; };
  const howtoWait = new Map(); const pendingBc = new Map();

  // ── staff upload session ─────────────────────────────────────────────────
  const getS = (uid) => { const s = sessions.get(uid); if (s && now() - s.at > SESSION_MS) { sessions.delete(uid); return null; } return s || null; };
  const kb = (rows) => ({ inline_keyboard: rows });
  function pickRows(prefix, items, extra = []) { const rows = []; for (let i = 0; i < items.length; i += 1) rows.push([{ text: items[i], callback_data: `${prefix}:${i}` }]); return kb(rows.concat(extra)); }
  /* Upload wizard: Level → Subject → Teacher → Attempt → Chapter (same order the students see). */
  const lvName = (x) => LV[x] || (x ? 'CA ' + x[0].toUpperCase() + x.slice(1) : '');
  const attName = (b) => (b.label || b.name) + (b.type === 'fastrack' ? ' ⚡' : '');
  async function startUpload(chatId, uid) {
    const all = service.uploadBatches(); if (!all.length) return tg.sendMessage(chatId, '⚠️ No batches yet. Create one in the admin panel first (/panel).');
    const s = { step: 'wiz', at: now(), w: { all }, lectures: 0, notes: 0, log: [] }; sessions.set(uid, s); return wizShow(chatId, s, 0);
  }
  async function wizShow(chatId, s, mid) {
    const w = s.w; const cancel = [{ text: '✖ Cancel', callback_data: 'uc' }]; const back = { text: '⬅ Back', callback_data: 'wb' }; let text, rows;
    if (!w.level) { w.levels = [...new Set(w.all.map((x) => x.level))].sort((x, y) => (x === 'foundation' ? -1 : y === 'foundation' ? 1 : x < y ? -1 : 1)); text = '📤 <b>Upload session</b>\n\nStep 1 · <b>Select the level</b>:'; rows = [...w.levels.map((l, i) => [{ text: `🎓 ${lvName(l)}`, callback_data: `wl:${i}` }]), cancel]; }
    else if (!w.subj) { const m = new Map(); for (const b of w.all) if (b.level === w.level) for (const x of b.subjects) m.set(x.name.trim().toLowerCase(), x.name); w.subjects = [...m.values()].sort((x, y) => x.localeCompare(y)); text = `📤 <b>${esc(lvName(w.level))}</b>\n\nStep 2 · <b>Select the subject</b>:`; rows = [...w.subjects.map((n, i) => [{ text: `📘 ${n}`, callback_data: `ws:${i}` }]), [back, ...cancel]]; if (!w.subjects.length) text += '\n\n⚠️ No subjects in this level yet. Add them in the panel.'; }
    else if (!w.fac && w.fac !== '') { const g = new Map(); for (const b of w.all) if (b.level === w.level && b.subjects.some((x) => x.name.trim().toLowerCase() === w.subj.trim().toLowerCase())) { const k = b.facultyId || ''; if (!g.has(k)) g.set(k, { id: k, name: b.faculty || 'No teacher', n: 0 }); g.get(k).n++; } w.facs = [...g.values()]; text = `📤 <b>${esc(lvName(w.level))} › ${esc(w.subj)}</b>\n\nStep 3 · <b>Select the teacher</b>:`; rows = [...w.facs.map((f, i) => [{ text: `👨‍🏫 ${f.name}${f.n > 1 ? ` · ${f.n} attempts` : ''}`, callback_data: `wf:${i}` }]), [back, ...cancel]]; }
    else { w.atts = w.all.filter((b) => b.level === w.level && (b.facultyId || '') === w.fac && b.subjects.some((x) => x.name.trim().toLowerCase() === w.subj.trim().toLowerCase())); const fn = (w.atts[0] && w.atts[0].faculty) || 'No teacher'; text = `📤 <b>${esc(lvName(w.level))} › ${esc(w.subj)} › ${esc(fn)}</b>\n\nStep 4 · <b>Select the attempt</b>:`; rows = [...w.atts.map((b, i) => [{ text: `🗓 ${attName(b)}`, callback_data: `wa:${i}` }]), [back, ...cancel]]; }
    if (mid) return safe(() => tg.editMessageText(chatId, mid, text, { reply_markup: kb(rows) })); return tg.sendMessage(chatId, text, { reply_markup: kb(rows) });
  }
  async function wizPick(chatId, s, b, mid) { const sj = b.subjects.find((x) => x.name.trim().toLowerCase() === s.w.subj.trim().toLowerCase()); s.batchId = b.id; s.batchName = b.name; s.subjectId = sj.id; s.subjectName = sj.name; s.step = 'subject'; await safe(() => tg.editMessageText(chatId, mid, `📚 <b>${esc(b.faculty || b.name)}${b.label ? ' · ' + esc(b.label) : ''}</b> › 📘 ${esc(sj.name)}`)); return chooseChapterKeyboard(chatId, s); }
  /** Live part of the panel: how many files of this batch are done, what is uploading now, and any Telegram rate-limit wait. */
  const capOn = (s) => (s.cap === undefined ? cfg().autoCapture !== false : s.cap);
  const liveBlock = (s) => {
    if (!(s.queued > 0)) return ''; const total = s.burstTotal || s.queued, done = Math.min(s.burstDone || 0, total), n = Math.round(done / total * 10);
    let t = `\n\n⏳ <b>Uploading ${Math.min(done + 1, total)} of ${total}</b>\n${'█'.repeat(n)}${'░'.repeat(10 - n)} ${Math.round(done / total * 100)}%`;
    if (s.cur) t += `\n▶️ ${esc(s.cur)}`; if (s.queued > 1) t += `\n🕓 Waiting in queue: ${s.queued - 1}`;
    if (s.waitUntil && s.waitUntil > now()) t += `\n⏸ Telegram rate-limit — resumes in ~${Math.ceil((s.waitUntil - now()) / 1000)}s (automatic)`;
    return t;
  };
  const statusText = (s) => `📤 <b>Upload in progress</b>\n━━━━━━━━━━━━━━\n📚 ${esc(s.batchName)}\n📘 ${esc(s.subjectName)}\n📂 <b>${esc(s.chapterName)}</b>\n━━━━━━━━━━━━━━\n✅ Lectures: <b>${s.lectures}</b>   📄 Notes: <b>${s.notes}</b>\n${(() => { const m = s.chapterId ? content.missingOf(s.chapterId) : []; return m.length ? `\n⚠️ <b>Missing lectures</b>: ${m.slice(0, 15).join(', ')}${m.length > 15 ? '…' : ''}` : ''; })()}${s.skipped || s.failed ? `\n⏭ Skipped: <b>${s.skipped || 0}</b>   ❌ Failed: <b>${s.failed || 0}</b>` : ''}\n🏷 Name &amp; number: ${capOn(s) ? 'read from caption / file name' : '<b>manual</b> — “Lecture N” / “Note N” by order'}\n🔀 Mode: ${s.mode === 'lec' ? 'lectures only (PDFs / images skipped)' : s.mode === 'notes' ? 'everything → notes' : 'auto — videos → lectures, everything else → notes'}${liveBlock(s)}${(s.recent && s.recent.length) ? '\n\n🕘 Recent:\n' + s.recent.map((x) => '• ' + esc(x)).join('\n') : ''}\n\n${s.unitName ? `\n\n📁 Unit: <b>${esc(s.unitName)}</b>` : ''}${s.target ? `\n\n🔁 <b>Next file replaces ${s.target.kind} ${s.target.num}</b>` : ''}${s.insertAt ? `\n\n📍 Next lectures insert at <b>#${s.insertAt}</b>` : ''}\n\n<i>Send or forward videos (lectures) and PDFs/images (notes) — saved files are removed from this chat automatically (🧹 Auto-clean). Done when finished.\n/ch Name switch chapter · /unit Name · /missing 4 5 7 (never existed) · /lec 5 · /note 2 replace by number · /at 5 insert · /undo last upload · /autonum off</i>`;
  const statusKb = (s) => kb([
    [{ text: `${(s.mode || 'auto') === 'auto' ? '✔ ' : ''}🤖 Auto`, callback_data: 'ma' }, { text: `${s.mode === 'lec' ? '✔ ' : ''}🎬 Lectures`, callback_data: 'ml' }, { text: `${s.mode === 'notes' ? '✔ ' : ''}📄 Notes`, callback_data: 'mn' }],
    [{ text: '📂 Change chapter', callback_data: 'ucc' }],
    [{ text: s.unitName ? `📁 Unit: ${s.unitName.slice(0, 18)}` : '📁 Unit', callback_data: 'uu' }, { text: '🔁 Replace #', callback_data: 'ur' }, { text: '📍 Insert at #', callback_data: 'ua' }],
    [{ text: '↩️ Undo last', callback_data: 'uz' }, { text: s.autoNum === false ? '🔢 Auto-order: OFF' : '🔢 Auto-order: ON', callback_data: 'ug' }, ...((s.target || s.insertAt) ? [{ text: '✖ Clear', callback_data: 'ux' }] : [])],
    [{ text: s.clean === false ? '🧹 Auto-clean: OFF' : '🧹 Auto-clean: ON', callback_data: 'uk' }, { text: capOn(s) ? '🏷 Auto-capture: ON' : '🏷 Auto-capture: OFF', callback_data: 'uq' }],
    [{ text: '✅ Done', callback_data: 'ud' }]]);
  async function showStatus(chatId, s, fresh) {
    if (s.statusId && !fresh) {
      if (s.queued > 1 && s.liveAt && Date.now() - s.liveAt < 1500) { if (!s.liveT) { s.liveT = setTimeout(() => { s.liveT = null; showStatus(chatId, s); }, 1500); if (s.liveT.unref) s.liveT.unref(); } return; }
      s.liveAt = Date.now(); await safe(() => tg.editMessageText(chatId, s.statusId, statusText(s), { reply_markup: statusKb(s) })); keepAtBottom(chatId, s); return;
    }
    const m = await tg.sendMessage(chatId, statusText(s), { reply_markup: statusKb(s) }); s.statusId = m.message_id;
  }
  /* Forwarded files push the status panel up the chat. Once the flow goes quiet, re-send it at the very bottom. */
  function keepAtBottom(chatId, s) {
    if (s.bump) clearTimeout(s.bump);
    s.bump = setTimeout(async () => { s.bump = null; if (!s.statusId || s.done) return; const old = s.statusId; try { const m = await tg.sendMessage(chatId, statusText(s), { reply_markup: statusKb(s) }); s.statusId = m.message_id; await safe(() => tg.call('deleteMessage', { chat_id: chatId, message_id: old })); } catch (e) {} }, 2500);
    if (s.bump.unref) s.bump.unref();
  }
  /** Auto-clean: once a file is safely stored, remove the forwarded copy from the chat so the panel stays at the bottom. */
  const clean = (chatId, s, msg) => { if (s.clean !== false) safe(() => tg.call('deleteMessage', { chat_id: chatId, message_id: msg.message_id })); };
  async function ingest(msg, s) {
    const chatId = msg.chat.id; const storage = config.storageChannelId; if (!storage) return tg.sendMessage(chatId, '⚠️ STORAGE_CHANNEL_ID is not set.');
    let kind, name, duration = 0, size = 0, fileType; const nmo = { prefer: cfg().nameSource === 'filename' ? 'filename' : 'caption', words: cfg().removeWords || [] };
    if (msg.video) { kind = 'lecture'; fileType = 'video'; duration = msg.video.duration || 0; size = msg.video.file_size || 0; name = content.suggestName(msg.video.file_name, msg.caption, nmo); }
    else if (msg.video_note) { kind = 'lecture'; fileType = 'video'; duration = msg.video_note.duration || 0; name = content.suggestName('', msg.caption, nmo); }
    else if (msg.audio) { kind = 'lecture'; fileType = 'audio'; duration = msg.audio.duration || 0; size = msg.audio.file_size || 0; name = content.suggestName(msg.audio.file_name || msg.audio.title, msg.caption, nmo); }
    else if (msg.document) { const v = /^video\//.test(msg.document.mime_type || ''); kind = v ? 'lecture' : 'note'; fileType = v ? 'video' : 'document'; size = msg.document.file_size || 0; name = content.suggestName(msg.document.file_name, msg.caption, nmo); }
    else if (msg.photo) { kind = 'note'; fileType = 'photo'; name = content.suggestName('', msg.caption, nmo); }
    else return;
    if (s.mode === 'notes' && kind === 'lecture') kind = 'note';
    if (!capOn(s)) { const c = content.countsOf(s.chapterId); name = kind === 'lecture' ? `Lecture ${content.nextLabel(s.chapterId)}` : `Note ${c.notes + 1}`; }
    if (s.mode === 'lec' && kind === 'note') { s.skipped = (s.skipped || 0) + 1; return tg.sendMessage(chatId, '⏭ <b>Skipped</b> — you are in <b>Lectures only</b> mode and this is a notes file (PDF / image). Switch to 🤖 Auto to upload it as a note.', { reply_to_message_id: msg.message_id }); }
    const fo = msg.video || msg.video_note || msg.audio || msg.document || (msg.photo && msg.photo[msg.photo.length - 1]) || {}; const fid = fo.file_unique_id || '';
    const tgt = s.target && s.target.kind === kind ? s.target : null;
    if (s.target && !tgt) return tg.sendMessage(chatId, `⚠️ You asked to replace a <b>${s.target.kind} ${s.target.num}</b>, but this file is a ${kind}. Send the right file type, or /cancel_target.`, { reply_to_message_id: msg.message_id });
    const dup = !tgt && content.hasFile(s.chapterId, fid); if (dup) { s.skipped = (s.skipped || 0) + 1; return tg.sendMessage(chatId, `⏭ <b>Skipped — already uploaded</b> as ${dup.kind === 'lecture' ? 'Lecture' : 'Note'} ${dup.number}: ${esc(dup.name)}`, { reply_to_message_id: msg.message_id }); }
    let copied; try { copied = await storeCopy(chatId, storage, msg, (w) => { s.waitUntil = w ? now() + w * 1000 : 0; showStatus(chatId, s); }); } catch (e) { s.waitUntil = 0; s.failed = (s.failed || 0) + 1; return tg.sendMessage(chatId, storeError(e), { reply_to_message_id: msg.message_id }); }
    try {
      if (tgt) { const cur = tgt.kind === 'lecture' ? content.lectureAt(s.chapterId, tgt.num) : content.noteAt(s.chapterId, tgt.num);
        if (!cur) { s.target = null; return tg.sendMessage(chatId, `⚠️ ${tgt.kind} ${tgt.num} no longer exists.`); }
        if (kind === 'lecture') content.replaceLecture(cur._id, { channelMsgId: copied.message_id, duration, size, fileType, fid }); else content.replaceNote(s.chapterId, cur._id, { channelMsgId: copied.message_id, fileType, fid });
        clean(chatId, s, msg); s.target = null; s.replaced = (s.replaced || 0) + 1; s.last = `🔁 ${kind === 'lecture' ? 'Lecture' : 'Note'} ${tgt.num} replaced: ${cur.name}`; (s.items = s.items || []).push({ k: 'replace', label: s.last }); (s.recent = s.recent || []).push(s.last); s.recent = s.recent.slice(-3); s.at = now(); return showStatus(chatId, s);
      }
      if (kind === 'lecture') { const pos = s.insertAt || (s.autoNum === false || !capOn(s) ? 0 : content.autoPosition(s.chapterId, name, s.unitId)); const l = content.addLecture(s.batchId, s.subjectId, s.chapterId, { name, duration, size, fileType, channelMsgId: copied.message_id, fid, position: pos, unitId: s.unitId || '' }); const no = content.labelOf(l._id); if (s.insertAt) s.insertAt = pos + 1; (s.items = s.items || []).push({ k: 'lecture', id: l._id, label: `Lecture ${no}: ${l.name}` }); s.lectures++; s.last = `🎬 ${no}. ${l.name}${l.duration ? ' · ' + hm(l.duration) : ''}`; (s.recent = s.recent || []).push(s.last); s.recent = s.recent.slice(-3); }
      else { const n = content.addNote(s.batchId, s.subjectId, s.chapterId, { name, fileType, channelMsgId: copied.message_id, fid }); (s.items = s.items || []).push({ k: 'note', id: n._id, label: `Note: ${n.name}` }); s.notes++; s.last = `📄 ${n.name}`; (s.recent = s.recent || []).push(s.last); s.recent = s.recent.slice(-3); }
      clean(chatId, s, msg); s.at = now(); await showStatus(chatId, s);
    } catch (e) { await tg.sendMessage(chatId, `❌ ${esc(e.message)}`); }
  }
  /** Admin panel → bot: open an upload session in one chapter, or wait for the file that replaces a lecture/note. */
  async function startFromLink(chatId, uid, tok) {
    let j = null; try { j = JSON.parse(db.kv.get('up:' + tok) || 'null'); } catch (e) {} if (!j || j.exp < now()) return tg.sendMessage(chatId, '⌛ This link expired. Create a new one from the admin panel.');
    const idx = content.index();
    if (j.k === 'add') { const e = idx.ch.get(j.cid); if (!e) return tg.sendMessage(chatId, '⚠️ That chapter no longer exists.'); const s = { step: 'active', at: now(), batchId: e.batch._id, batchName: e.batch.name, subjectId: e.subject._id, subjectName: e.subject.name, chapterId: e.chapter._id, chapterName: e.chapter.name, mode: 'auto', lectures: 0, notes: 0, log: [] }; sessions.set(uid, s); return showStatus(chatId, s, true); }
    if (j.k === 'rl') { const e = idx.lec.get(j.lid); if (!e) return tg.sendMessage(chatId, '⚠️ That lecture no longer exists.'); sessions.set(uid, { step: 'replace', kind: 'lecture', lid: j.lid, at: now() }); return tg.sendMessage(chatId, `🔁 <b>Replace lecture</b>\n${esc(e.batch.name)} › ${esc(e.subject.name)} › ${esc(e.chapter.name)}\n<b>${esc(e.lecture.name)}</b>\n\nSend the <b>new video</b> now (the lecture keeps its name, number and everyone's progress). /cancel to stop.`); }
    if (j.k === 'rn') { const e = idx.ch.get(j.cid); const n = e && (e.chapter.notes || []).find((x) => x._id === j.nid); if (!n) return tg.sendMessage(chatId, '⚠️ That note no longer exists.'); sessions.set(uid, { step: 'replace', kind: 'note', cid: j.cid, nid: j.nid, at: now() }); return tg.sendMessage(chatId, `🔁 <b>Replace note</b>\n${esc(e.chapter.name)} › <b>${esc(n.name)}</b>\n\nSend the <b>new PDF / file</b> now. /cancel to stop.`); }
  }
  async function replaceIngest(msg, s, uid) {
    const chatId = msg.chat.id; const storage = config.storageChannelId; if (!storage) return tg.sendMessage(chatId, '⚠️ STORAGE_CHANNEL_ID is not set.');
    let fileType, duration = 0, size = 0; const v = msg.video || msg.video_note || msg.audio || (msg.document && /^video\//.test(msg.document.mime_type || '') ? msg.document : null);
    if (s.kind === 'lecture') { if (!v) return tg.sendMessage(chatId, '⚠️ Please send a video for a lecture.'); fileType = msg.audio ? 'audio' : 'video'; duration = v.duration || 0; size = v.file_size || 0; }
    else { if (!(msg.document || msg.photo)) return tg.sendMessage(chatId, '⚠️ Please send a PDF / document / image for a note.'); fileType = msg.photo ? 'photo' : 'document'; }
    let copied; try { copied = await storeCopy(chatId, storage, msg); } catch (e) { return tg.sendMessage(chatId, storeError(e)); }
    try { if (s.kind === 'lecture') { const l = content.replaceLecture(s.lid, { channelMsgId: copied.message_id, duration, size, fileType }); sessions.delete(uid); return tg.sendMessage(chatId, `✅ Lecture replaced: <b>${esc(l.name)}</b>${l.duration ? ' · ' + hm(l.duration) : ''}`); }
      const n = content.replaceNote(s.cid, s.nid, { channelMsgId: copied.message_id, fileType }); sessions.delete(uid); return tg.sendMessage(chatId, `✅ Note replaced: <b>${esc(n.name)}</b>`);
    } catch (e) { return tg.sendMessage(chatId, `❌ ${esc(e.message)}`); }
  }
  /* Copy a file into the storage channel. Telegram rate-limits bulk uploads (429 "retry after N"): wait and retry by itself instead of failing. */
  let lastCopyAt = 0; const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  async function storeCopy(chatId, storage, msg, onWait) {
    for (let attempt = 0; ; attempt++) {
      const gap = Date.now() - lastCopyAt; if (gap < 1100) await nap(1100 - gap);
      try { const r = await tg.call('copyMessage', { chat_id: storage, from_chat_id: chatId, message_id: msg.message_id }); lastCopyAt = Date.now(); return r; } catch (e) {
        lastCopyAt = Date.now(); if (e.code !== 429 || attempt >= 5) throw e;
        const w = Math.min(120, (Number(e.retryAfter) || 20) + 1); if (attempt === 0) { try { await tg.sendMessage(chatId, `⏳ <b>Telegram is rate-limiting uploads</b> — waiting ~${w}s, then continuing automatically. Keep forwarding; nothing is lost.`); } catch (x) { /* notice only */ } }
        if (onWait) onWait(w); await nap(w * 1000); if (onWait) onWait(0);
      }
    }
  }
  const storeError = (e) => e.code === 429 ? `⏳ Telegram is still rate-limiting (retry after ${e.retryAfter || '?'}s). Wait a minute and send this file again.` : `❌ Could not store the file: ${esc(e.message)}${e.code === 400 || e.code === 403 ? '\nMake sure the bot is an admin of the storage channel.' : ''}`;
  async function sessionCmd(chatId, s, cmd, arg) {
    const n = parseInt(String(arg || '').replace(/\D/g, ''), 10);
    if (cmd === '/missing') { const a = String(arg || '').trim(); if (/^(none|clear|off|reset)$/i.test(a)) { content.setSkipped(s.chapterId, []); await tg.sendMessage(chatId, '✅ Cleared — every gap will be reported as missing again.'); return showStatus(chatId, s, true); } if (!a) { const k = content.skippedOf(s.chapterId); return tg.sendMessage(chatId, k.length ? `🚫 Lectures that do not exist (not reported as missing): <b>${k.join(', ')}</b>\n\nChange: /missing 4 5 7 · Clear: /missing none` : 'No numbers are marked as non-existent.\n\nIf some lectures were never recorded, tell me: /missing 4 5 7'); } const r = content.setSkipped(s.chapterId, a); await tg.sendMessage(chatId, r.skip.length ? `🚫 Marked as non-existent: <b>${r.skip.join(', ')}</b>\nThey will not be shown as missing for students or in this panel, and new “Lecture N” names skip them.` : '⚠️ Send numbers, e.g. /missing 4 5 7'); return showStatus(chatId, s, true); }
    if (cmd === '/autonum') { s.autoNum = !/^off|no|0/i.test(String(arg || '')); return tg.sendMessage(chatId, s.autoNum ? '🔢 Auto-order is <b>ON</b>: a file named “Lecture 5 …” / “L05 …” / “05. …” goes to its right place by number, even if you forward files in any order.' : '🔢 Auto-order is <b>OFF</b>: files are added at the end (or at /at N).'); }
    if (cmd === '/unit') { const nm = String(arg || '').trim(); if (!nm || /^(none|off|no|clear)$/i.test(nm)) { s.unitId = ''; s.unitName = ''; return tg.sendMessage(chatId, '📁 Unit cleared — new lectures go to the chapter directly (no unit).'); } try { const u = content.addUnit(s.batchId, s.subjectId, s.chapterId, nm); s.unitId = u._id; s.unitName = u.name; s.insertAt = 0; } catch (e) { return tg.sendMessage(chatId, `❌ ${esc(e.message)}`); } await tg.sendMessage(chatId, `📁 Unit: <b>${esc(s.unitName)}</b>\nNew lectures go into this unit. /unit none to stop.`); return showStatus(chatId, s, true); }
    if (cmd === '/ch') { const nm = String(arg || '').trim(); if (!nm) return tg.sendMessage(chatId, 'Usage: /ch Chapter name — switches to that chapter (creates it if it does not exist yet).'); const b = db.batch.getOne(s.batchId); const subj = b.subjects.find((x) => x._id === s.subjectId); let ch = (subj.chapters || []).find((x) => x.name.trim().toLowerCase() === nm.toLowerCase()); const made = !ch; try { if (!ch) ch = content.addChapter(s.batchId, s.subjectId, nm); } catch (e) { return tg.sendMessage(chatId, `❌ ${esc(e.message)}`); } s.chapterId = ch._id; s.chapterName = ch.name; s.target = null; s.insertAt = 0; s.unitId = ''; s.unitName = ''; await tg.sendMessage(chatId, `${made ? '🆕 Chapter created' : '📂 Switched to'}: <b>${esc(ch.name)}</b>`); return showStatus(chatId, s, true); }
    if (cmd === '/cancel_target') { s.target = null; s.insertAt = 0; return tg.sendMessage(chatId, '✖ Replace / insert mode cleared. New files are added at the end.'); }
    if (cmd === '/undo') { const it = (s.items || [])[(s.items || []).length - 1]; if (!it) return tg.sendMessage(chatId, 'Nothing to undo in this session.'); if (it.k === 'replace') { return tg.sendMessage(chatId, '⚠️ A replacement cannot be undone. Send /lec N again with the correct file.'); } s.items.pop(); try { if (it.k === 'lecture') { content.deleteLecture(it.id); s.lectures = Math.max(0, s.lectures - 1); if (s.insertAt) s.insertAt = Math.max(1, s.insertAt - 1); } else { content.deleteNote(s.chapterId, it.id); s.notes = Math.max(0, s.notes - 1); } s.recent = (s.recent || []).slice(0, -1); } catch (e) { return tg.sendMessage(chatId, `❌ ${esc(e.message)}`); } await tg.sendMessage(chatId, `↩️ Removed: ${esc(it.label)}`); return showStatus(chatId, s, true); }
    if (!(n >= 1)) return tg.sendMessage(chatId, cmd === '/at' ? 'Usage: /at 5 — the next lectures are inserted from number 5 onward (others shift down).' : `Usage: ${cmd} 5 — then send the file that replaces ${cmd === '/lec' ? 'lecture' : 'note'} number 5.`);
    if (cmd === '/at') { s.insertAt = n; s.target = null; return tg.sendMessage(chatId, `📍 Next lectures will be inserted from <b>number ${n}</b> onward. /cancel_target to go back to adding at the end.`); }
    if (cmd === '/lec') { const cur = content.lectureAt(s.chapterId, n); if (!cur) return tg.sendMessage(chatId, `⚠️ This chapter has no lecture ${n}. To add one there, use /at ${n}.`); s.target = { kind: 'lecture', num: n }; return tg.sendMessage(chatId, `🔁 <b>Replace lecture ${n}</b>: ${esc(cur.name)}\nSend the <b>new video</b> now (name, number and student progress stay).\n/cancel_target to stop.`); }
    const cur = content.noteAt(s.chapterId, n); if (!cur) return tg.sendMessage(chatId, `⚠️ This chapter has no note ${n}.`); s.target = { kind: 'note', num: n }; return tg.sendMessage(chatId, `🔁 <b>Replace note ${n}</b>: ${esc(cur.name)}\nSend the <b>new PDF / file</b> now.\n/cancel_target to stop.`);
  }
  async function finishUpload(chatId, uid, s) {
    s.done = true; if (s.bump) clearTimeout(s.bump); sessions.delete(uid); const lines = [`✅ <b>Upload finished</b>`, `${esc(s.batchName)} › ${esc(s.subjectName)} › ${esc(s.chapterName)}`, `Lectures: <b>${s.lectures}</b> · Notes: <b>${s.notes}</b>${s.replaced ? ` · Replaced: <b>${s.replaced}</b>` : ''}${s.skipped ? ` · Skipped duplicates: <b>${s.skipped}</b>` : ''}`, ...((s.items || []).length ? ['', ...(s.items || []).slice(-25).map((x) => '• ' + esc(x.label))] : [])];
    await tg.sendMessage(chatId, lines.join('\n'));
    if (s.lectures) { const users = planner.plansWithAlerts(s.batchId); for (const u of users) { await safe(() => tg.sendMessage(u, `🆕 <b>New lectures added</b>\n${esc(s.subjectName)} › ${esc(s.chapterName)} (${s.lectures} new)`, { reply_markup: kb([[webBtn('Open', '')].filter(Boolean)]) })); } }
  }
  async function chooseChapterKeyboard(chatId, s) {
    const b = db.batch.getOne(s.batchId); const subj = b.subjects.find((x) => x._id === s.subjectId); s.chapters = subj.chapters.slice(-30).map((c) => ({ id: c._id, name: c.name })); s.step = 'chapter';
    return tg.sendMessage(chatId, `📘 <b>${esc(subj.name)}</b>\n\nSelect a chapter or create a new one:`, { reply_markup: pickRows('uh', s.chapters.map((c) => c.name), [[{ text: '➕ New chapter', callback_data: 'un' }, { text: '📋 Copy from another teacher', callback_data: 'ucp' }], [{ text: '✖ Cancel', callback_data: 'uc' }]]) });
  }

  // ── commands ─────────────────────────────────────────────────────────────
  async function staffCommand(msg, cmd, arg) {
    const chatId = msg.chat.id; const uid = String(msg.from.id);
    switch (cmd) {
      case '/upload': return startUpload(chatId, uid);
      case '/done': { const s = getS(uid); if (!s || s.step !== 'active') return tg.sendMessage(chatId, 'No active upload session. Use /upload.'); return finishUpload(chatId, uid, s); }
      case '/lec': case '/note': case '/at': case '/undo': case '/cancel_target': case '/ch': case '/autonum': case '/unit': case '/missing': { const s = getS(uid); if (!s || s.step !== 'active') return tg.sendMessage(chatId, 'Start a session first: /upload (or “Add files” in the admin panel).'); return sessionCmd(chatId, s, cmd, arg); }
      case '/cancel': sessions.delete(uid); howtoWait.delete(uid); pendingBc.delete(uid); return tg.sendMessage(chatId, '✖ Cancelled.');
      case '/howto': howtoWait.set(uid, now()); return tg.sendMessage(chatId, '🎬 <b>How-to video</b>\n\nSend the video (or document) students should see when they tap “How to watch lectures?”. Send /cancel to stop.');
      case '/broadcast': { const raw = String(arg || ''); const pin = /(^|\s)--pin(\s|$)/.test(raw); const t = raw.replace(/(^|\s)--pin(?=\s|$)/g, ' ').trim(); const rp = msg.reply_to_message; const total = (db.user.listAll ? db.user.listAll() : db.user.getAll()).filter((u) => !db.ban.isBanned(u.userId)).length;
        if (rp) { pendingBc.set(uid, { copy: { from: chatId, mid: rp.message_id }, pin }); return tg.sendMessage(chatId, `📣 <b>Broadcast preview</b>\n\nThe message you replied to will be copied to <b>${total}</b> students${pin ? ' and pinned' : ''}.`, { reply_markup: kb([[{ text: `✅ Send to ${total}`, callback_data: 'bcs' }, { text: '✖ Cancel', callback_data: 'bcc' }]]) }); }
        if (t.length < 3) return tg.sendMessage(chatId, '📣 <b>Broadcast</b>\n\n• Text: /broadcast &lt;message&gt; (first line = title)\n• Photo / video / file / sticker: send it, <b>reply</b> to it with /broadcast\n• Add <code>--pin</code> to pin it in every chat'); const parts = t.split('\n'); const title = parts[0].slice(0, 100); const body = (parts.slice(1).join('\n').trim() || title).slice(0, 3500); pendingBc.set(uid, { title, body, pin }); return tg.sendMessage(chatId, `📣 <b>Broadcast preview</b>\n\n<b>${esc(title)}</b>\n${esc(body)}\n\nThis goes to <b>${total}</b> students${pin ? ' and is pinned' : ''}.`, { reply_markup: kb([[{ text: `✅ Send to ${total}`, callback_data: 'bcs' }, { text: '✖ Cancel', callback_data: 'bcc' }]]) }); }
      case '/panel': { const b = webBtn('🛠 Open Panel', '../admin/'); return tg.sendMessage(chatId, '🛠 <b>Management Panel</b>', b ? { reply_markup: kb([[b]]) } : {}); }
      case '/stats': { const d = service.dashboard({ role: 'super_admin', perms: new Set(['*']) }); return tg.sendMessage(chatId, `📊 <b>Stats</b>\n👥 Students: <b>${d.students.total}</b> (active 7d: ${d.students.active}, blocked: ${d.students.blocked})\n📚 Batches: <b>${d.batches.total}</b>\n🎬 Lectures: <b>${d.lectures}</b>\n🧑‍🏫 Faculties: <b>${d.faculties.total}</b>`); }
      case '/ban': { const m = /^(\d{5,15})(?:\s+([\s\S]{1,200}))?$/.exec(String(arg || '').trim()); if (!m) return tg.sendMessage(chatId, 'Usage: /ban &lt;userId&gt; [reason]\nExample: /ban 123456789 Multiple accounts'); if (m[1] === String(config.ownerId)) return tg.sendMessage(chatId, 'The owner cannot be banned.'); const why = (m[2] || '').trim() || 'Banned by admin'; db.ban.ban({ userId: m[1], reason: why, bannedBy: uid }); if (opts.onBan) await safe(() => opts.onBan(m[1], why)); return tg.sendMessage(chatId, `🚫 Banned <code>${m[1]}</code>\nReason: ${esc(why)}\n\nTheir pending delivered lectures were removed.`); }
      case '/banned': { const l = db.ban.listAll().sort((x, y) => (y.at || 0) - (x.at || 0)); if (!l.length) return tg.sendMessage(chatId, '✅ No banned users.'); return tg.sendMessage(chatId, `🚫 <b>Banned users (${l.length})</b>\n\n` + l.slice(0, 40).map((x) => { const u = db.user.findOne(x.userId) || {}; const n = [u.firstName, u.lastName].filter(Boolean).join(' ') || '—'; return `• ${esc(n)} · <code>${x.userId}</code>\n   ${esc(x.reason || 'No reason')}`; }).join('\n') + '\n\n/unban &lt;id&gt;'); }
      case '/rmword': { const a = String(arg || '').trim().replace(/^['"“”‘’]+|['"“”‘’]+$/g, ''); const actor = { id: uid, name: 'bot', role: 'super_admin', perms: new Set(['*']) }; const cur = cfg().removeWords || []; const save = (w) => service.config.set(actor, { removeWords: w });
        if (!a || a.toLowerCase() === 'list') return tg.sendMessage(chatId, cur.length ? `🧹 <b>Removed from names (${cur.length})</b>\n\n` + cur.map((w) => `• ${esc(w)}`).join('\n') + '\n\nAdd: /rmword &lt;word&gt;\nRemove one: /rmword del &lt;word&gt;\nClear all: /rmword clear' : '🧹 No words are being removed.\n\nAdd one: /rmword @MyChannel');
        if (a.toLowerCase() === 'clear') { save([]); return tg.sendMessage(chatId, '✅ Remove-words list cleared.'); }
        const d = /^del\s+([\s\S]+)$/i.exec(a); if (d) { save(cur.filter((w) => w.toLowerCase() !== d[1].trim().toLowerCase())); return tg.sendMessage(chatId, `✅ Removed “${esc(d[1].trim())}” from the list.`); }
        save([...cur, a]); const r = content.cleanAllNames([a]); return tg.sendMessage(chatId, `✅ Will remove “${esc(a)}” from lecture/note names and captions.\n🧼 ${r.renamed} existing name${r.renamed === 1 ? '' : 's'} cleaned.`); }
      case '/unsuspend': { if (!/^\d{5,15}$/.test(arg || '')) return tg.sendMessage(chatId, 'Usage: /unsuspend &lt;userId&gt;'); const had = access.unsuspend(arg); await safe(() => tg.sendMessage(arg, '✅ <b>Your suspension has been lifted.</b>\n\nSend /start to continue.')); return tg.sendMessage(chatId, had ? `✅ Unsuspended ${esc(arg)}` : 'That user is not suspended.'); }
      case '/suspended': { const l = access.suspendedList(); return tg.sendMessage(chatId, l.length ? '⛔ <b>Suspended students</b>\n\n' + l.slice(0, 40).map((x) => `${esc(x.name)} · <code>${x.userId}</code> · until ${access.fmtIST(x.until)}`).join('\n') + '\n\n/unsuspend &lt;id&gt;' : 'No one is suspended right now.'); }
      case '/unban': { if (!/^\d{5,15}$/.test(arg || '')) return tg.sendMessage(chatId, 'Usage: /unban &lt;userId&gt;'); db.ban.unban(arg); if (opts.onUnban) await safe(() => opts.onUnban(arg)); return tg.sendMessage(chatId, `✅ Unbanned ${esc(arg)}`); }
      case '/grant': { const [id, h] = String(arg || '').split(/\s+/); if (!/^\d{5,15}$/.test(id || '') || !(Number(h) > 0)) return tg.sendMessage(chatId, 'Usage: /grant &lt;userId&gt; &lt;hours&gt;'); if (!db.user.findOne(id)) return tg.sendMessage(chatId, 'User not found.'); const w = access.grantHours(id, Number(h), 'admin'); return tg.sendMessage(chatId, `✅ Access extended until ${new Date(w.expiresAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`); }
      default: return null;
    }
  }
  // ── suspension & appeals ────────────────────────────────────────────────
  const owner = () => String(config.ownerId || '0');
  async function suspendedMessage(chatId, uid, sx, msg) {
    if (db.kv.get('appealwait:' + uid) === '1' && msg.text && !msg.text.startsWith('/')) {
      db.kv.set('appealwait:' + uid, ''); db.kv.set('appeal:' + uid, 'sent'); const u = db.user.findOne(uid) || {}; const who = esc([u.firstName, u.lastName].filter(Boolean).join(' ') || 'Student') + (u.username ? ' (@' + esc(u.username) + ')' : '') + ' · <code>' + uid + '</code>';
      const to = owner(); if (to && to !== '0') await safe(() => tg.sendMessage(to, `🆘 <b>Suspension appeal</b>\n\n👤 ${who}\n📢 Left: ${esc(sx.channel || 'a required channel')}\n⏳ Suspended until ${access.fmtIST(sx.until)}\n\n💬 <i>${esc(msg.text.slice(0, 800))}</i>`, { reply_markup: kb([[{ text: '✅ Unsuspend', callback_data: 'usp:' + uid }, { text: '❌ Reject', callback_data: 'urj:' + uid }]]) }));
      return tg.sendMessage(chatId, '✅ Your appeal has been sent to the admin. You will get a reply here.');
    }
    return tg.sendMessage(chatId, access.suspendMsg(sx), { reply_markup: kb(access.suspendBtns) });
  }
  async function appealStart(chatId, uid, sx, ack) {
    const st = db.kv.get('appeal:' + uid); if (st === 'sent') return ack('Your appeal is already with the admin. Please wait for a reply.', true); if (st === 'rejected') return ack('Your appeal was not accepted. The suspension ends on ' + access.fmtIST(sx.until) + '.', true);
    db.kv.set('appealwait:' + uid, '1'); await ack(); return tg.sendMessage(chatId, '✍️ <b>Write your appeal</b>\n\nSend one message now explaining why the suspension should be lifted.');
  }
  async function appealDecision(q, uid, chatId, data, ack) {
    if (!access.isStaff(uid)) return ack('Only admins can do this', true); const [k, target] = data.split(':'); const done = (t) => safe(() => tg.editMessageText(chatId, q.message.message_id, (q.message.text ? esc(q.message.text) + '\n\n' : '') + t));
    if (k === 'usp') { const had = access.unsuspend(target); await ack(had ? 'Unsuspended' : 'Already free'); await safe(() => tg.sendMessage(target, '✅ <b>Your suspension has been lifted.</b>\n\nSend /start to continue. You may need to join the required channels again.')); return done('✅ Unsuspended'); }
    db.kv.set('appeal:' + target, 'rejected'); await ack('Rejected'); await safe(() => tg.sendMessage(target, '❌ <b>Your appeal was not accepted.</b>\n\nThe suspension will end automatically.')); return done('❌ Appeal rejected');
  }
  async function onMessage(msg) {
    if (!msg.from || msg.chat.type !== 'private') return; const uid = String(msg.from.id); const chatId = msg.chat.id; const text = (msg.text || '').trim();
    const { user, created } = db.user.touch(msg.from, now()); if (db.ban.isBanned(uid)) return tg.sendMessage(chatId, '🚫 Your account is blocked. Contact support if you think this is a mistake.');
    if (!access.isStaff(uid)) { await safe(() => access.checkLeft(uid)); const sx = access.suspension(uid); if (sx) return suspendedMessage(chatId, uid, sx, msg); }
    const m = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text); const cmd = m ? '/' + m[1].toLowerCase() : null; const arg = m ? (m[2] || '').trim() : '';
    if (cmd === '/start') {
      if (/^ref_\d+$/.test(arg) && created) { const r = access.refer(uid, arg.slice(4)); if (r) await safe(() => tg.sendMessage(arg.slice(4), `🎉 <b>${esc(msg.from.first_name || 'A friend')}</b> joined using your link!\n+${r.points} points · +${r.hours}h access`)); }
      if (/^L_[0-9a-f]{16}$/.test(arg)) { try { await access.deliverLectures(uid, [arg.slice(2)]); } catch (e) { await tg.sendMessage(chatId, `⚠️ ${esc(e.message)}`); } return; }
      if (/^u_[0-9a-f]{16}$/.test(arg) && access.isStaff(uid)) return startFromLink(chatId, uid, arg.slice(2));
      const lvl = userLevel(uid); if (!lvl) return sendLevelChoice(chatId, msg.from.first_name, msg.message_id);
      return proceed(chatId, msg.from, lvl, msg.message_id);
    }
    if (access.isStaff(uid)) {
      const s = getS(uid);
      if (cmd && ['/upload', '/done', '/cancel', '/lec', '/note', '/at', '/undo', '/cancel_target', '/ch', '/autonum', '/unit', '/missing', '/panel', '/stats', '/ban', '/unban', '/banned', '/rmword', '/grant', '/howto', '/broadcast', '/unsuspend', '/suspended'].includes(cmd)) return staffCommand(msg, cmd, arg);
      if (howtoWait.has(uid) && (msg.video || msg.document || msg.animation || msg.video_note)) { howtoWait.delete(uid); try { const cp = await tg.call('copyMessage', { chat_id: config.storageChannelId, from_chat_id: chatId, message_id: msg.message_id }); db.kv.set('howto:msg', String(cp.message_id)); return tg.sendMessage(chatId, '✅ How-to video saved. Students will see it under “How to watch lectures?”.'); } catch (e) { return tg.sendMessage(chatId, `❌ Could not save: ${esc(e.message)}`); } }
      if (s && s.step === 'newunit' && text && !cmd) { try { const u = content.addUnit(s.batchId, s.subjectId, s.chapterId, text); s.unitId = u._id; s.unitName = u.name; s.step = 'active'; s.insertAt = 0; s.at = now(); return showStatus(chatId, s, true); } catch (e) { return tg.sendMessage(chatId, `❌ ${esc(e.message)}`); } }
      if (s && s.step === 'newchapter' && text && !cmd) { try { const c = content.addChapter(s.batchId, s.subjectId, text); s.chapterId = c._id; s.chapterName = c.name; s.step = 'active'; s.mode = 'auto'; s.at = now(); return showStatus(chatId, s, true); } catch (e) { return tg.sendMessage(chatId, `❌ ${esc(e.message)}`); } }
      if (s && s.step === 'replace' && (msg.video || msg.document || msg.photo || msg.audio || msg.video_note)) return enqueue(uid, () => replaceIngest(msg, s, uid));
      if (s && s.step === 'active' && (msg.video || msg.document || msg.photo || msg.audio || msg.video_note)) { s.at = now(); s.queued = (s.queued || 0) + 1; s.burstTotal = (s.burstTotal || 0) + 1; keepAtBottom(msg.chat.id, s); return enqueue(uid, async () => { s.cur = (msg.video && (msg.video.file_name || msg.caption)) || (msg.document && msg.document.file_name) || msg.caption || (msg.photo ? 'photo' : 'file'); s.cur = String(s.cur).slice(0, 60); try { await ingest(msg, s); } finally { s.queued = Math.max(0, (s.queued || 1) - 1); s.burstDone = (s.burstDone || 0) + 1; s.cur = ''; s.waitUntil = 0; if (!s.queued) { s.burstTotal = 0; s.burstDone = 0; } await showStatus(msg.chat.id, s); } }); }
      if (cmd === '/help') return tg.sendMessage(chatId, '🛠 <b>Staff commands</b>\n/upload — start an upload session (or use ‘Add files’ / ‘Replace’ in the admin panel)\n/done — finish it\n/lec 5 · /note 2 — replace lecture/note by number\n/at 5 — insert next lectures from number 5\n/ch Name — switch or create chapter\n/unit Name — put next lectures in a unit (/unit none to stop)\n/autonum off — stop auto-ordering by number in the file name\n/undo — remove last upload\n/cancel — cancel\n/panel — admin panel\n/stats — quick stats\n/ban &lt;id&gt; [reason] · /unban &lt;id&gt; · /banned\n/rmword &lt;word&gt; · /rmword list · /rmword clear\n/grant &lt;id&gt; &lt;hours&gt;\n/broadcast &lt;message&gt; (or reply to media with /broadcast, add --pin)\n/howto — set the “How to watch” video');
    }
    if (cmd === '/help' || cmd === '/app' || cmd === '/menu' || !cmd) { const w = webBtn('🎓 Open WebApp'); return tg.sendMessage(chatId, 'Tap <b>Open WebApp</b> to watch lectures, track your study time and plan your schedule.', w ? { reply_markup: kb([[w]]) } : {}); }
  }
  /** Inline buttons on the daily reminder: send today's lectures / notes of one chapter straight into the chat. */
  async function reminderAction(uid, chatId, data, ack) {
    const [k, date, idx] = data.split(':'); const p = planner.get(uid); const d = p && p.days.find((x) => x.date === date); const it = d && d.items[parseInt(idx, 10)];
    if (!it) return ack('This plan changed. Open your plan to continue.', true);
    try {
      if (k === 'rl') { const ids = it.lectures.filter((l) => !p.done[l.id]).map((l) => l.id); if (!ids.length) return ack('All lectures here are already done 🎉', true); await ack(`Sending ${ids.length} lecture${ids.length === 1 ? '' : 's'}…`); const r = await access.deliverLectures(uid, ids.slice(0, 30)); if (r.failed && r.failed.length) await tg.sendMessage(chatId, `⚠️ ${r.failed.length} lecture(s) could not be sent: ${esc(r.failed[0].error)}`); else await tg.sendMessage(chatId, `✅ Sent ${r.sent} lecture${r.sent === 1 ? '' : 's'} · ${esc(it.chapter)}\n🎟 Quota left today: <b>${r.quota.left}</b>`); }
      else { await ack('Sending notes…'); const r = await access.deliverNotes(uid, it.chapterId); await tg.sendMessage(chatId, `✅ Sent ${r.sent} note${r.sent === 1 ? '' : 's'} · ${esc(it.chapter)}`); }
    } catch (e) { await safe(() => tg.sendMessage(chatId, `⚠️ ${esc(e.message || 'Could not send')}`)); }
  }
  /** Media / pinned broadcasts go straight to every student's chat (copyMessage keeps captions) with live progress. */
  async function directBroadcast(chatId, mid, pb) {
    const users = (db.user.listAll ? db.user.listAll() : db.user.getAll()).map((u) => String(u.userId)).filter((id) => !db.ban.isBanned(id)); let sent = 0, blocked = 0, failed = 0;
    const edit = (t) => safe(() => tg.editMessageText(chatId, mid, t));
    for (let i = 0; i < users.length; i++) {
      const id = users[i];
      try { const m = pb.copy ? await tg.call('copyMessage', { chat_id: id, from_chat_id: pb.copy.from, message_id: pb.copy.mid }) : await tg.sendMessage(id, `<b>${esc(pb.title)}</b>\n${esc(pb.body)}`); if (pb.pin && m && m.message_id) await safe(() => tg.call('pinChatMessage', { chat_id: id, message_id: m.message_id, disable_notification: true })); sent++; }
      catch (e) { if (/blocked|deactivated|Forbidden|chat not found/i.test(e.message || '')) blocked++; else failed++; if (e.retryAfter) { await new Promise((r) => setTimeout(r, Math.min(e.retryAfter, 30) * 1000)); i--; failed--; continue; } }
      if ((i + 1) % 20 === 0) await edit(`📡 Broadcasting…\n✅ ${sent} · 🚫 ${blocked} · ❌ ${failed} · ${i + 1}/${users.length}`);
      if ((i + 1) % 25 === 0) await new Promise((r) => setTimeout(r, 1000));
    }
    await edit(`✅ <b>Broadcast complete</b>\n\n✅ Delivered: ${sent}\n🚫 Blocked the bot: ${blocked}\n❌ Failed: ${failed}`);
  }
  async function onCallback(q) {
    const uid = String(q.from.id); const chatId = q.message && q.message.chat.id; const data = q.data || ''; const ack = (t, a) => { safe(() => tg.answerCallbackQuery(q.id, t, a)); return Promise.resolve(); }; // fire-and-forget: the button stops spinning at once and we carry on
    db.user.touch(q.from, now()); if (db.ban.isBanned(uid)) return ack('Blocked', true);
    if (/^(usp|urj):\d+$/.test(data)) return appealDecision(q, uid, chatId, data, ack);
    if (!access.isStaff(uid)) { const sx = access.suspension(uid); if (sx) { if (data === 'appeal') return appealStart(chatId, uid, sx, ack); return ack('Your account is suspended until ' + access.fmtIST(sx.until), true); } }
    if (data.startsWith('lv:')) { const l = data.slice(3); if (!LV[l]) return ack(); db.user.setLevel(uid, l); await ack(LV[l] + ' selected ✅'); await safe(() => tg.editMessageText(chatId, q.message.message_id, `✅ <b>${esc(LV[l])}</b> selected.`)); return proceed(chatId, q.from, l); }
    if (data === 'lvchange') { await ack(); return sendLevelChoice(chatId, q.from.first_name); }
    if (data.startsWith('joined:')) { const l = data.slice(7); if (!LV[l]) return ack(); if (!(await verifyJoined(uid, l))) return ack('Please join all channels first, then press the button again.', true); db.kv.set(`joined2:${uid}:${l}`, '1'); await ack('Thanks! 🎉 Unlocked'); return sendWelcome(chatId, q.from, l); }
    if (data === 'refer') { await ack(); return uiTrack(chatId, await tg.sendMessage(chatId, referText(uid))); }
    if (data === 'how') {
      await ack(); const c = cfg(); const mid = parseInt(db.kv.get('howto:msg') || '0', 10); const rows = [[{ text: '🎁 Refer & Earn', callback_data: 'refer' }]]; if (c.howToUrl) rows.unshift([{ text: '🔗 More help', url: c.howToUrl }]);
      if (mid && config.storageChannelId) {
        try {
          const prev = parseInt(db.kv.get('howpin:' + chatId) || '0', 10); if (prev) await safe(() => tg.call('deleteMessage', { chat_id: chatId, message_id: prev })); // deleting the old one also unpins it
          const sent = await tg.copyMessage(chatId, config.storageChannelId, mid, { caption: c.howToCaption ? esc(c.howToCaption) : '▶️ <b>How to watch lectures</b>', reply_markup: kb(rows) });
          if (sent && sent.message_id) { db.kv.set('howpin:' + chatId, String(sent.message_id)); if (c.pinHowTo !== false) await safe(() => tg.call('pinChatMessage', { chat_id: chatId, message_id: sent.message_id, disable_notification: true })); }
          return sent;
        } catch (e) { /* fall back to text */ }
      }
      return uiTrack(chatId, await tg.sendMessage(chatId, '▶️ <b>How to watch lectures</b>\n\n1. Tap <b>Open WebApp</b>\n2. Open the <b>Access</b> tab and activate your free access\n3. Go to <b>Lectures</b> → pick a subject → faculty → batch → chapter\n4. Tap <b>Lectures</b>, choose a lecture number — it arrives in this chat\n5. Use <b>Notes</b> for PDFs', { reply_markup: kb(rows) }));
    }
    if (data === 'bcs' || data === 'bcc') { const pb = pendingBc.get(uid); pendingBc.delete(uid); if (!access.isStaff(uid) || !pb) return ack('Expired', true); if (data === 'bcc') { await ack('Cancelled'); return safe(() => tg.editMessageText(chatId, q.message.message_id, '✖ Broadcast cancelled.')); } await ack('Sending…'); if (pb.copy || pb.pin) { directBroadcast(chatId, q.message.message_id, pb); return; } const actor = { id: uid, name: 'bot', role: 'super_admin', perms: new Set(['*']) }; try { const n = service.notification.create(actor, { title: pb.title, body: pb.body, audience: 'all', inApp: true, btnKind: cfg().supportLink ? 'support' : 'none', btnText: 'Support' }); const r = await service.notification.send(actor, n.id); return safe(() => tg.editMessageText(chatId, q.message.message_id, `📣 Broadcast queued for <b>${r.queued}</b> students.`)); } catch (e) { return tg.sendMessage(chatId, `❌ ${esc(e.message)}`); } }
    if (/^r[ln]:/.test(data)) return reminderAction(uid, chatId, data, ack);
    if (!access.isStaff(uid)) return ack();
    const s = getS(uid); if (!s) return ack('Session expired. Send /upload again.', true);
    const [k, v] = data.split(':'); const i = parseInt(v, 10);
    if (s.step === 'active' && /^u[urxagz]/.test(k) && k !== 'ucc' && k !== 'ud' && k !== 'um') {
      const mid = q.message.message_id; const edit = (t, rows) => safe(() => tg.editMessageText(chatId, mid, t, { reply_markup: kb(rows) })); const back = [{ text: '⬅ Back', callback_data: 'ux0' }]; s.statusId = mid; const grid = (pre, nums, per = 5) => { const rows = []; for (let a = 0; a < nums.length; a += per) rows.push(nums.slice(a, a + per).map((n) => ({ text: String(n), callback_data: `${pre}:${n}` }))); return rows; };
      const names = (arr) => arr.slice(0, 40).map((x, n) => `${n + 1}. ${esc(String(x.name).slice(0, 38))}`).join('\n');
      if (k === 'uu') { const b = db.batch.getOne(s.batchId); const c = b.subjects.find((x) => x._id === s.subjectId).chapters.find((x) => x._id === s.chapterId); s.unitList = (c.units || []).map((u) => ({ id: u._id, name: u.name })); await ack(); return edit(`📁 <b>Unit</b> for the next lectures\n${s.unitList.length ? '' : '\nNo units in this chapter yet — create one.'}`, [...s.unitList.map((u, n) => [{ text: `${u.id === s.unitId ? '✅ ' : ''}${u.name}`, callback_data: `uus:${n}` }]), [{ text: '➕ New unit', callback_data: 'uun' }, { text: '🚫 No unit', callback_data: 'uu0' }], back]); }
      if (k === 'uus' && (s.unitList || [])[i]) { s.unitId = s.unitList[i].id; s.unitName = s.unitList[i].name; s.insertAt = 0; await ack('Unit: ' + s.unitName); return showStatus(chatId, s); }
      if (k === 'uu0') { s.unitId = ''; s.unitName = ''; await ack('No unit'); return showStatus(chatId, s); }
      if (k === 'uun') { s.step = 'newunit'; s.statusMsg = mid; await ack(); return tg.editMessageText(chatId, mid, '✏️ Send the <b>name of the new unit</b> (e.g. Unit 1 – Basics):'); }
      if (k === 'ur') { const c = content.index().ch.get(s.chapterId).chapter; await ack(); return edit(`🔁 <b>Replace which lecture?</b>\nPick the number, then send the new video.\n\n${names(c.lectures || []) || 'No lectures yet.'}`, [...grid('urn', (c.lectures || []).slice(0, 60).map((_, n) => n + 1)), [{ text: '📄 Replace a note instead', callback_data: 'urm' }], back]); }
      if (k === 'urm') { const c = content.index().ch.get(s.chapterId).chapter; await ack(); return edit(`🔁 <b>Replace which note?</b>\n\n${names(c.notes || []) || 'No notes yet.'}`, [...grid('urq', (c.notes || []).slice(0, 60).map((_, n) => n + 1)), back]); }
      if ((k === 'urn' || k === 'urq') && i >= 1) { const isL = k === 'urn'; const cur = isL ? content.lectureAt(s.chapterId, i) : content.noteAt(s.chapterId, i); if (!cur) return ack('Not found', true); s.target = { kind: isL ? 'lecture' : 'note', num: i }; s.insertAt = 0; await ack(`Send the new ${isL ? 'video' : 'file'} for ${i}`); return showStatus(chatId, s); }
      if (k === 'ua') { const c = content.index().ch.get(s.chapterId).chapter; const n = (c.lectures || []).length; await ack(); return edit(`📍 <b>Insert at which number?</b>\nNext lectures go in from that number onward; the rest shift down. (${n} lectures now)`, [...grid('uan', Array.from({ length: Math.min(n + 1, 60) }, (_, z) => z + 1)), back]); }
      if (k === 'uan' && i >= 1) { s.insertAt = i; s.target = null; await ack('Inserting from #' + i); return showStatus(chatId, s); }
      if (k === 'ux') { s.target = null; s.insertAt = 0; await ack('Cleared'); return showStatus(chatId, s); }
      if (k === 'ug') { s.autoNum = s.autoNum === false; await ack(s.autoNum === false ? 'Auto-order off' : 'Auto-order on'); return showStatus(chatId, s); }
      if (k === 'uz') { await ack(); return sessionCmd(chatId, s, '/undo', ''); }
      if (k === 'ux0') { await ack(); return showStatus(chatId, s); }
    }
    if (k === 'uc') { sessions.delete(uid); await ack('Cancelled'); return safe(() => tg.editMessageText(chatId, q.message.message_id, '✖ Upload cancelled.')); }
    if (s.step === 'wiz' && /^w[lsfab]/.test(k)) {
      const mid = q.message.message_id; const w = s.w; await ack();
      if (k === 'wb') { if (w.fac !== undefined) delete w.fac; else if (w.subj) w.subj = ''; else if (w.level) w.level = ''; if (w.subj === '' ) delete w.subj; if (w.level === '') delete w.level; return wizShow(chatId, s, mid); }
      if (k === 'wl' && w.levels && w.levels[i]) { w.level = w.levels[i]; return wizShow(chatId, s, mid); }
      if (k === 'ws' && w.subjects && w.subjects[i]) { w.subj = w.subjects[i]; return wizShow(chatId, s, mid); }
      if (k === 'wf' && w.facs && w.facs[i]) { w.fac = w.facs[i].id; const atts = w.all.filter((b) => b.level === w.level && (b.facultyId || '') === w.fac && b.subjects.some((x) => x.name.trim().toLowerCase() === w.subj.trim().toLowerCase())); if (atts.length === 1) return wizPick(chatId, s, atts[0], mid); return wizShow(chatId, s, mid); }
      if (k === 'wa' && w.atts && w.atts[i]) return wizPick(chatId, s, w.atts[i], mid);
      return;
    }
    if (s.step === 'chapter' && (k === 'ucp' || k === 'ucs')) {
      const mid = q.message.message_id; const nm = (x) => String(x || '').trim().toLowerCase(); await ack();
      if (k === 'ucp') { const all = service.uploadBatches(); s.copySrc = all.flatMap((b) => b.subjects.filter((x) => nm(x.name) === nm(s.subjectName) && x.chapters > 0 && !(b.id === s.batchId && x.id === s.subjectId)).map((x) => ({ batchId: b.id, subjectId: x.id, text: `${b.faculty || 'No teacher'}${b.label ? ' · ' + b.label : ''}${b.type === 'fastrack' ? ' ⚡' : ''} — ${x.chapters} ch${x.units ? ', ' + x.units + ' units' : ''}` }))); return safe(() => tg.editMessageText(chatId, mid, `📋 <b>Copy chapters &amp; units</b>\nInto: ${esc(s.subjectName)}\n\n${s.copySrc.length ? 'Copy from which teacher / attempt? (lectures are not copied)' : 'No other teacher has chapters for this subject yet.'}`, { reply_markup: kb([...s.copySrc.slice(0, 30).map((x, n) => [{ text: x.text, callback_data: `ucs:${n}` }]), [{ text: '⬅ Back', callback_data: 'ucb' }]]) })); }
      const src = (s.copySrc || [])[i]; if (!src) return; try { const r = content.copyStructure(src.batchId, src.subjectId, s.batchId, s.subjectId); await safe(() => tg.editMessageText(chatId, mid, `✅ Copied <b>${r.chapters}</b> chapter${r.chapters === 1 ? '' : 's'} and <b>${r.units}</b> unit${r.units === 1 ? '' : 's'}${r.kept ? ` (${r.kept} already existed)` : ''}.`)); } catch (e) { await tg.sendMessage(chatId, `❌ ${esc(e.message)}`); } return chooseChapterKeyboard(chatId, s);
    }
    if (s.step === 'chapter' && k === 'ucb') { await ack(); await safe(() => tg.call('deleteMessage', { chat_id: chatId, message_id: q.message.message_id })); return chooseChapterKeyboard(chatId, s); }
    if (k === 'ub' && s.step === 'batch' && s.batches[i]) { const b = db.batch.getOne(s.batches[i].id); s.batchId = b._id; s.batchName = b.name; s.subjects = (b.subjects || []).map((x) => ({ id: x._id, name: x.name })); s.step = 'subject'; await ack(); if (!s.subjects.length) return tg.editMessageText(chatId, q.message.message_id, `⚠️ <b>${esc(b.name)}</b> has no subjects yet.\nAdd one in the panel (Batches → ${esc(b.name)} → Content), then /upload again.`); return tg.editMessageText(chatId, q.message.message_id, `📚 <b>${esc(b.name)}</b>\n\nSelect the subject:`, { reply_markup: pickRows('us', s.subjects.map((x) => x.name), [[{ text: '✖ Cancel', callback_data: 'uc' }]]) }); }
    if (k === 'us' && s.step === 'subject' && s.subjects[i]) { s.subjectId = s.subjects[i].id; s.subjectName = s.subjects[i].name; await ack(); await safe(() => tg.editMessageText(chatId, q.message.message_id, `📘 <b>${esc(s.subjectName)}</b> selected.`)); return chooseChapterKeyboard(chatId, s); }
    if (k === 'uh' && s.step === 'chapter' && s.chapters[i]) { s.chapterId = s.chapters[i].id; s.chapterName = s.chapters[i].name; s.step = 'active'; s.mode = 'auto'; await ack(); await safe(() => tg.editMessageText(chatId, q.message.message_id, `📂 <b>${esc(s.chapterName)}</b> selected.`)); return showStatus(chatId, s, true); }
    if (k === 'un' && s.step === 'chapter') { s.step = 'newchapter'; await ack(); return tg.editMessageText(chatId, q.message.message_id, '✏️ Send the <b>name of the new chapter</b>:'); }
    if (k === 'ucc' && s.step === 'active') { await ack(); return chooseChapterKeyboard(chatId, s); }
    if (k === 'uq' && s.step === 'active') { s.cap = !capOn(s); await ack(s.cap ? 'Auto-capture ON — name & number read from caption / file name' : 'Auto-capture OFF — files are named “Lecture N” / “Note N” in order; rename in admin'); return showStatus(chatId, s); }
    if (k === 'uk' && s.step === 'active') { s.clean = s.clean === false; await ack(s.clean === false ? 'Auto-clean OFF — forwarded files stay in chat' : 'Auto-clean ON — forwarded files are removed once saved'); return showStatus(chatId, s); }
    if (/^m[aln]$/.test(k) && s.step === 'active') { s.mode = k === 'ma' ? 'auto' : k === 'ml' ? 'lec' : 'notes'; await ack(s.mode === 'auto' ? 'Auto: videos → lectures, rest → notes' : s.mode === 'lec' ? 'Lectures only' : 'Everything becomes notes'); return showStatus(chatId, s); }
    if (k === 'um' && s.step === 'active') { s.mode = s.mode === 'auto' ? 'notes' : 'auto'; await ack(s.mode === 'auto' ? 'Videos become lectures' : 'Everything becomes notes'); return showStatus(chatId, s); }
    if (k === 'ud' && s.step === 'active') { await ack('Done'); return finishUpload(chatId, uid, s); }
    return ack();
  }
  async function handleUpdate(u) { try { if (u.chat_member) return await access.onMemberUpdate(u.chat_member); if (u.message) return await onMessage(u.message); if (u.callback_query) return await onCallback(u.callback_query); } catch (e) { console.error('[bot]', e.message); } }

  /** Sent right after a plan is generated: full analysis, then a pointer to the reminders. */
  async function sendPlanSummary(uid) {
    const p = planner.view(uid); if (!p) return; const bh = planner.behind(uid); const t = new Date(now() + TZ); const day = t.toISOString().slice(0, 10); const td = p.days && p.days.find((d) => d.date === day);
    const fin = p.finishDate ? new Date(p.finishDate + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
    const lines = [`📅 <b>Your study plan is ready!</b>`, '', `🎯 Exam: <b>${esc(p.examMonth || '—')}</b>`, `🏁 You finish on: <b>${esc(fin)}</b>`, `🎬 Lectures: <b>${p.total}</b> · ⏳ ${hm(p.secondsLeft || 0)} to go`, `📈 Progress: <b>${p.pct}%</b>`];
    if (td) lines.push('', `☀️ <b>Today</b> · ${td.items.reduce((x, i) => x + i.lectures.length, 0)} lectures · ${hm(td.seconds)}`);
    lines.push('', bh.count ? `⚠️ <b>${bh.count} lecture${bh.count === 1 ? '' : 's'} behind</b> (${hm(bh.seconds)}) — catch up soon.` : '✅ You are on track. Keep going!', '', '🔔 I will remind you every day with your lectures and tell you if you fall behind.');
    const w = webBtn('📋 Open my plan'); const extra = w ? { reply_markup: kb([[w]]) } : {};
    // the PDF goes first, with the analysis as its caption; the plain message is the fallback
    try { const buf = planner.pdf(uid); const r = await tg.sendDocumentBuffer(uid, buf, planner.pdfName(uid), lines.join('\n').slice(0, 1000), 'application/pdf', extra.reply_markup); return r; } catch (e) { return tg.sendMessage(uid, lines.join('\n'), extra); }
  }

  // ── scheduled work: daily plan reminders ────────────────────────────────
  async function tick() {
    const t = new Date(now() + TZ); const hhmm = t.toISOString().slice(11, 16); const day = t.toISOString().slice(0, 10); let n = 0;
    for (const r of planner.dueReminders(hhmm, day)) {
      db.kv.set(`remind:${r.userId}:${day}`, '1');
      const items = r.day.items; const cnt = items.reduce((x, i) => x + i.lectures.length, 0); const bh = planner.behind(r.userId);
      const dt = new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }).replace(',', '');
      const lines = items.map((i) => `📘 <b>${esc(i.subject)}</b> · ${esc(i.chapter)}\n     ${i.lectures.length} lecture${i.lectures.length === 1 ? '' : 's'} · ${hm(i.seconds)}`).join('\n');
      const warn = bh.count ? `\n⚠️ ${bh.count} lecture${bh.count === 1 ? '' : 's'} pending from earlier days (${hm(bh.seconds)}) — open your plan to catch up.` : '';
      const rows = []; items.slice(0, 4).forEach((i, x) => { rows.push([{ text: `📥 Send lectures · ${i.chapter.slice(0, 26)} (${i.lectures.length})`, callback_data: `rl:${day}:${x}` }]); rows.push([{ text: `📝 Notes · ${i.chapter.slice(0, 30)}`, callback_data: `rn:${day}:${x}` }]); });
      const w = webBtn('📋 Open my plan'); if (w) rows.push([w]);
      await safe(() => tg.sendMessage(r.userId, `☀️ <b>Your study plan for today</b> · ${esc(dt)}\n\n${lines}\n\n⏱ Total today: <b>${hm(r.day.seconds)}</b>${warn}`, { reply_markup: kb(rows) })); n++;
    } return n;
  }
  return { handleUpdate, tick, sessions, sendWelcome, sendPlanSummary };
}
module.exports = { createBot };
