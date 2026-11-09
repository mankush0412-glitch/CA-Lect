'use strict';
const { esc, hm } = require('./access');
const TZ = 330 * 60000;

function createBot({ tg, db, store, service, content, access, planner, config, now = () => Date.now(), botUsername = () => '' }) {
  const cfg = () => service.config.get();
  const appUrl = () => (config.publicUrl ? `${config.publicUrl}/app/` : '');
  const staffName = (m) => [m.from.first_name, m.from.last_name].filter(Boolean).join(' ');
  const webBtn = (text, path = '') => (appUrl() ? { text, web_app: { url: appUrl() + path } } : null);
  const sessions = new Map(); const queues = new Map(); const SESSION_MS = 45 * 60000;

  const enqueue = (uid, fn) => { const prev = queues.get(uid) || Promise.resolve(); const next = prev.catch(() => {}).then(fn); queues.set(uid, next); next.finally(() => { if (queues.get(uid) === next) queues.delete(uid); }); return next; };
  const safe = async (fn) => { try { return await fn(); } catch (e) { return null; } };

  // ── welcome / force-join ─────────────────────────────────────────────────
  const channels = () => (cfg().joinChannels || []).filter((c) => c.url);
  const joined = (uid) => db.kv.get('joined:' + uid) === '1';
  async function sendJoinGate(chatId) {
    const rows = channels().map((c) => [{ text: `📢 ${c.title}`, url: c.url }]); rows.push([{ text: "✅ I've Joined", callback_data: 'joined' }]);
    return tg.sendMessage(chatId, `⚠️ <b>Join our channels first</b>\n\nTo use this bot you need to join our channels.\n\n👉 Tap the buttons below to join them one by one, then press <b>✅ I've Joined</b>.`, { reply_markup: { inline_keyboard: rows } });
  }
  async function sendWelcome(chatId, user) {
    const c = cfg(); const name = esc(user.first_name || 'there'); const custom = c.welcomeText ? esc(c.welcomeText).replace(/\{name\}/g, name) : null;
    const text = custom || `👋 Hey, <b>${name}</b>!\n\nTo watch lectures and view the notes, click on the 🚀 <b>Open WebApp</b> button.\n\nUse the ❓ <b>How to watch lectures?</b> button if you need guidance.`;
    const kb = []; const w = webBtn('🚀 Open WebApp'); if (w) kb.push([w]);
    kb.push([c.howToUrl ? { text: '❓ How to watch lectures?', url: c.howToUrl } : { text: '❓ How to watch lectures?', callback_data: 'how' }]);
    channels().forEach((ch) => kb.push([{ text: `📢 ${ch.title}`, url: ch.url }])); if (c.whatsappLink) kb.push([{ text: '💬 Join WhatsApp Channel', url: c.whatsappLink }]);
    return tg.sendMessage(chatId, text, { reply_markup: { inline_keyboard: kb } });
  }
  async function verifyJoined(uid) {
    for (const ch of channels()) { if (!ch.chatId) continue; try { const m = await tg.getChatMember(ch.chatId, uid); if (['left', 'kicked'].includes(m.status)) return false; } catch (e) { /* bot cannot see the channel: do not lock the student out */ } }
    return true;
  }

  // ── staff upload session ─────────────────────────────────────────────────
  const getS = (uid) => { const s = sessions.get(uid); if (s && now() - s.at > SESSION_MS) { sessions.delete(uid); return null; } return s || null; };
  const kb = (rows) => ({ inline_keyboard: rows });
  function pickRows(prefix, items, extra = []) { const rows = []; for (let i = 0; i < items.length; i += 1) rows.push([{ text: items[i], callback_data: `${prefix}:${i}` }]); return kb(rows.concat(extra)); }
  async function startUpload(chatId, uid) {
    const bs = db.batch.getAll(); if (!bs.length) return tg.sendMessage(chatId, '⚠️ No batches yet. Create one in the admin panel first (/panel).');
    sessions.set(uid, { step: 'batch', at: now(), batches: bs.slice(0, 40).map((b) => ({ id: b._id, name: b.name })), lectures: 0, notes: 0, log: [] });
    return tg.sendMessage(chatId, '📤 <b>Upload session</b>\n\nSelect the batch:', { reply_markup: pickRows('ub', sessions.get(uid).batches.map((b) => b.name), [[{ text: '✖ Cancel', callback_data: 'uc' }]]) });
  }
  const statusText = (s) => `📤 <b>Uploading</b>\n\n📚 ${esc(s.batchName)}\n📘 ${esc(s.subjectName)} › <b>${esc(s.chapterName)}</b>\n\n✅ Lectures: <b>${s.lectures}</b>   📄 Notes: <b>${s.notes}</b>${s.last ? `\n\nLast: ${esc(s.last)}` : ''}\n\n<i>Send or forward videos (lectures) and PDFs/images (notes). Press Done when finished.</i>`;
  const statusKb = (s) => kb([[{ text: s.mode === 'auto' ? '🎬 Videos→Lectures' : '📄 Everything→Notes', callback_data: 'um' }, { text: '📂 Change chapter', callback_data: 'ucc' }], [{ text: '✅ Done', callback_data: 'ud' }]]);
  async function showStatus(chatId, s, fresh) { if (s.statusId && !fresh) return safe(() => tg.editMessageText(chatId, s.statusId, statusText(s), { reply_markup: statusKb(s) })); const m = await tg.sendMessage(chatId, statusText(s), { reply_markup: statusKb(s) }); s.statusId = m.message_id; }
  async function ingest(msg, s) {
    const chatId = msg.chat.id; const storage = config.storageChannelId; if (!storage) return tg.sendMessage(chatId, '⚠️ STORAGE_CHANNEL_ID is not set.');
    let kind, name, duration = 0, size = 0, fileType;
    if (msg.video) { kind = 'lecture'; fileType = 'video'; duration = msg.video.duration || 0; size = msg.video.file_size || 0; name = content.suggestName(msg.video.file_name, msg.caption); }
    else if (msg.video_note) { kind = 'lecture'; fileType = 'video'; duration = msg.video_note.duration || 0; name = content.suggestName('', msg.caption); }
    else if (msg.audio) { kind = 'lecture'; fileType = 'audio'; duration = msg.audio.duration || 0; size = msg.audio.file_size || 0; name = content.suggestName(msg.audio.file_name || msg.audio.title, msg.caption); }
    else if (msg.document) { const v = /^video\//.test(msg.document.mime_type || ''); kind = v ? 'lecture' : 'note'; fileType = v ? 'video' : 'document'; size = msg.document.file_size || 0; name = content.suggestName(msg.document.file_name, msg.caption); }
    else if (msg.photo) { kind = 'note'; fileType = 'photo'; name = content.suggestName('', msg.caption); }
    else return;
    if (s.mode === 'notes' && kind === 'lecture') kind = 'note';
    let copied; try { copied = await tg.call('copyMessage', { chat_id: storage, from_chat_id: chatId, message_id: msg.message_id }); } catch (e) { return tg.sendMessage(chatId, `❌ Could not store the file: ${esc(e.message)}\nMake sure the bot is an admin of the storage channel.`, { reply_to_message_id: msg.message_id }); }
    try {
      if (kind === 'lecture') { const l = content.addLecture(s.batchId, s.subjectId, s.chapterId, { name, duration, size, fileType, channelMsgId: copied.message_id }); s.lectures++; s.last = `${l.name}${l.duration ? ' · ' + hm(l.duration) : ''}`; }
      else { const n = content.addNote(s.batchId, s.subjectId, s.chapterId, { name, fileType, channelMsgId: copied.message_id }); s.notes++; s.last = `📄 ${n.name}`; }
      s.at = now(); await showStatus(chatId, s);
    } catch (e) { await tg.sendMessage(chatId, `❌ ${esc(e.message)}`); }
  }
  async function finishUpload(chatId, uid, s) {
    sessions.delete(uid); const lines = [`✅ <b>Upload finished</b>`, `${esc(s.batchName)} › ${esc(s.subjectName)} › ${esc(s.chapterName)}`, `Lectures: <b>${s.lectures}</b> · Notes: <b>${s.notes}</b>`];
    await tg.sendMessage(chatId, lines.join('\n'));
    if (s.lectures) { const users = planner.plansWithAlerts(s.batchId); for (const u of users) { await safe(() => tg.sendMessage(u, `🆕 <b>New lectures added</b>\n${esc(s.subjectName)} › ${esc(s.chapterName)} (${s.lectures} new)`, { reply_markup: kb([[webBtn('Open', '')].filter(Boolean)]) })); } }
  }
  async function chooseChapterKeyboard(chatId, s) {
    const b = db.batch.getOne(s.batchId); const subj = b.subjects.find((x) => x._id === s.subjectId); s.chapters = subj.chapters.slice(-30).map((c) => ({ id: c._id, name: c.name })); s.step = 'chapter';
    return tg.sendMessage(chatId, `📘 <b>${esc(subj.name)}</b>\n\nSelect a chapter or create a new one:`, { reply_markup: pickRows('uh', s.chapters.map((c) => c.name), [[{ text: '➕ New chapter', callback_data: 'un' }], [{ text: '✖ Cancel', callback_data: 'uc' }]]) });
  }

  // ── commands ─────────────────────────────────────────────────────────────
  async function staffCommand(msg, cmd, arg) {
    const chatId = msg.chat.id; const uid = String(msg.from.id);
    switch (cmd) {
      case '/upload': return startUpload(chatId, uid);
      case '/done': { const s = getS(uid); if (!s || s.step !== 'active') return tg.sendMessage(chatId, 'No active upload session. Use /upload.'); return finishUpload(chatId, uid, s); }
      case '/cancel': sessions.delete(uid); return tg.sendMessage(chatId, '✖ Cancelled.');
      case '/panel': { const b = webBtn('🛠 Open Panel', '../admin/'); return tg.sendMessage(chatId, '🛠 <b>Management Panel</b>', b ? { reply_markup: kb([[b]]) } : {}); }
      case '/stats': { const d = service.dashboard({ role: 'super_admin', perms: new Set(['*']) }); return tg.sendMessage(chatId, `📊 <b>Stats</b>\n👥 Students: <b>${d.students.total}</b> (active 7d: ${d.students.active}, blocked: ${d.students.blocked})\n📚 Batches: <b>${d.batches.total}</b>\n🎬 Lectures: <b>${d.lectures}</b>\n🧑‍🏫 Faculties: <b>${d.faculties.total}</b>`); }
      case '/ban': { if (!/^\d{5,15}$/.test(arg || '')) return tg.sendMessage(chatId, 'Usage: /ban &lt;userId&gt;'); if (arg === String(config.ownerId)) return tg.sendMessage(chatId, 'The owner cannot be banned.'); db.ban.ban({ userId: arg, reason: 'Banned via bot', bannedBy: uid }); return tg.sendMessage(chatId, `🚫 Banned ${esc(arg)}`); }
      case '/unban': { if (!/^\d{5,15}$/.test(arg || '')) return tg.sendMessage(chatId, 'Usage: /unban &lt;userId&gt;'); db.ban.unban(arg); return tg.sendMessage(chatId, `✅ Unbanned ${esc(arg)}`); }
      case '/grant': { const [id, h] = String(arg || '').split(/\s+/); if (!/^\d{5,15}$/.test(id || '') || !(Number(h) > 0)) return tg.sendMessage(chatId, 'Usage: /grant &lt;userId&gt; &lt;hours&gt;'); if (!db.user.findOne(id)) return tg.sendMessage(chatId, 'User not found.'); const w = access.grantHours(id, Number(h), 'admin'); return tg.sendMessage(chatId, `✅ Access extended until ${new Date(w.expiresAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`); }
      default: return null;
    }
  }
  async function onMessage(msg) {
    if (!msg.from || msg.chat.type !== 'private') return; const uid = String(msg.from.id); const chatId = msg.chat.id; const text = (msg.text || '').trim();
    const { user, created } = db.user.touch(msg.from, now()); if (db.ban.isBanned(uid)) return tg.sendMessage(chatId, '🚫 Your account is blocked. Contact support if you think this is a mistake.');
    const m = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text); const cmd = m ? '/' + m[1].toLowerCase() : null; const arg = m ? (m[2] || '').trim() : '';
    if (cmd === '/start') {
      if (/^ref_\d+$/.test(arg) && created) { const r = access.refer(uid, arg.slice(4)); if (r) await safe(() => tg.sendMessage(arg.slice(4), `🎉 <b>${esc(msg.from.first_name || 'A friend')}</b> joined using your link!\n+${r.points} points · +${r.hours}h access`)); }
      if (/^L_[0-9a-f]{16}$/.test(arg)) { try { await access.deliverLectures(uid, [arg.slice(2)]); } catch (e) { await tg.sendMessage(chatId, `⚠️ ${esc(e.message)}`); } return; }
      if (channels().length && !joined(uid) && !access.isStaff(uid)) return sendJoinGate(chatId);
      return sendWelcome(chatId, msg.from);
    }
    if (access.isStaff(uid)) {
      const s = getS(uid);
      if (cmd && ['/upload', '/done', '/cancel', '/panel', '/stats', '/ban', '/unban', '/grant'].includes(cmd)) return staffCommand(msg, cmd, arg);
      if (s && s.step === 'newchapter' && text && !cmd) { try { const c = content.addChapter(s.batchId, s.subjectId, text); s.chapterId = c._id; s.chapterName = c.name; s.step = 'active'; s.mode = 'auto'; s.at = now(); return showStatus(chatId, s, true); } catch (e) { return tg.sendMessage(chatId, `❌ ${esc(e.message)}`); } }
      if (s && s.step === 'active' && (msg.video || msg.document || msg.photo || msg.audio || msg.video_note)) return enqueue(uid, () => ingest(msg, s));
      if (cmd === '/help') return tg.sendMessage(chatId, '🛠 <b>Staff commands</b>\n/upload — start an upload session\n/done — finish it\n/cancel — cancel\n/panel — admin panel\n/stats — quick stats\n/ban &lt;id&gt; · /unban &lt;id&gt;\n/grant &lt;id&gt; &lt;hours&gt;');
    }
    if (cmd === '/help' || cmd === '/app' || cmd === '/menu' || !cmd) { const w = webBtn('🚀 Open WebApp'); return tg.sendMessage(chatId, 'Tap <b>Open WebApp</b> to watch lectures, track your study time and plan your schedule.', w ? { reply_markup: kb([[w]]) } : {}); }
  }
  async function onCallback(q) {
    const uid = String(q.from.id); const chatId = q.message && q.message.chat.id; const data = q.data || ''; const ack = (t, a) => safe(() => tg.answerCallbackQuery(q.id, t, a));
    db.user.touch(q.from, now()); if (db.ban.isBanned(uid)) return ack('Blocked', true);
    if (data === 'joined') { if (!(await verifyJoined(uid))) return ack('Please join all channels first, then press the button again.', true); db.kv.set('joined:' + uid, '1'); await ack('Thanks! 🎉'); return sendWelcome(chatId, q.from); }
    if (data === 'how') { await ack(); return tg.sendMessage(chatId, '▶️ <b>How to watch lectures</b>\n\n1. Tap <b>Open WebApp</b>\n2. Open the <b>Access</b> tab and activate your free access\n3. Go to <b>Lectures</b> → pick a subject → faculty → batch → chapter\n4. Tap <b>Lectures</b>, choose a lecture number — it arrives in this chat instantly.'); }
    if (!access.isStaff(uid)) return ack();
    const s = getS(uid); if (!s) return ack('Session expired. Send /upload again.', true);
    const [k, v] = data.split(':'); const i = parseInt(v, 10);
    if (k === 'uc') { sessions.delete(uid); await ack('Cancelled'); return safe(() => tg.editMessageText(chatId, q.message.message_id, '✖ Upload cancelled.')); }
    if (k === 'ub' && s.step === 'batch' && s.batches[i]) { const b = db.batch.getOne(s.batches[i].id); s.batchId = b._id; s.batchName = b.name; s.subjects = (b.subjects || []).map((x) => ({ id: x._id, name: x.name })); s.step = 'subject'; await ack(); if (!s.subjects.length) return tg.editMessageText(chatId, q.message.message_id, `⚠️ <b>${esc(b.name)}</b> has no subjects yet.\nAdd one in the panel (Batches → ${esc(b.name)} → Content), then /upload again.`); return tg.editMessageText(chatId, q.message.message_id, `📚 <b>${esc(b.name)}</b>\n\nSelect the subject:`, { reply_markup: pickRows('us', s.subjects.map((x) => x.name), [[{ text: '✖ Cancel', callback_data: 'uc' }]]) }); }
    if (k === 'us' && s.step === 'subject' && s.subjects[i]) { s.subjectId = s.subjects[i].id; s.subjectName = s.subjects[i].name; await ack(); await safe(() => tg.editMessageText(chatId, q.message.message_id, `📘 <b>${esc(s.subjectName)}</b> selected.`)); return chooseChapterKeyboard(chatId, s); }
    if (k === 'uh' && s.step === 'chapter' && s.chapters[i]) { s.chapterId = s.chapters[i].id; s.chapterName = s.chapters[i].name; s.step = 'active'; s.mode = 'auto'; await ack(); await safe(() => tg.editMessageText(chatId, q.message.message_id, `📂 <b>${esc(s.chapterName)}</b> selected.`)); return showStatus(chatId, s, true); }
    if (k === 'un' && s.step === 'chapter') { s.step = 'newchapter'; await ack(); return tg.editMessageText(chatId, q.message.message_id, '✏️ Send the <b>name of the new chapter</b>:'); }
    if (k === 'ucc' && s.step === 'active') { await ack(); return chooseChapterKeyboard(chatId, s); }
    if (k === 'um' && s.step === 'active') { s.mode = s.mode === 'auto' ? 'notes' : 'auto'; await ack(s.mode === 'auto' ? 'Videos become lectures' : 'Everything becomes notes'); return showStatus(chatId, s); }
    if (k === 'ud' && s.step === 'active') { await ack('Done'); return finishUpload(chatId, uid, s); }
    return ack();
  }
  async function handleUpdate(u) { try { if (u.message) return await onMessage(u.message); if (u.callback_query) return await onCallback(u.callback_query); } catch (e) { console.error('[bot]', e.message); } }

  // ── scheduled work: daily plan reminders ────────────────────────────────
  async function tick() {
    const t = new Date(now() + TZ); const hhmm = t.toISOString().slice(11, 16); const day = t.toISOString().slice(0, 10); let n = 0;
    for (const r of planner.dueReminders(hhmm, day)) {
      db.kv.set(`remind:${r.userId}:${day}`, '1'); const lines = r.day.items.map((i) => `• ${esc(i.subject)} · ${esc(i.chapter)} (${i.lectures.length})`).join('\n'); const w = webBtn("📅 Open today's plan");
      await safe(() => tg.sendMessage(r.userId, `⏰ <b>Today's study plan</b>\n\n${lines}\n\nTotal: <b>${hm(r.day.seconds)}</b>`, w ? { reply_markup: kb([[w]]) } : {})); n++;
    } return n;
  }
  return { handleUpdate, tick, sessions, sendWelcome };
}
module.exports = { createBot };
