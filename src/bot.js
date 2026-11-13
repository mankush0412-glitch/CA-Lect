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
  async function startUpload(chatId, uid) {
    const bs = db.batch.getAll(); if (!bs.length) return tg.sendMessage(chatId, '⚠️ No batches yet. Create one in the admin panel first (/panel).');
    sessions.set(uid, { step: 'batch', at: now(), batches: bs.slice(0, 40).map((b) => ({ id: b._id, name: b.name })), lectures: 0, notes: 0, log: [] });
    return tg.sendMessage(chatId, '📤 <b>Upload session</b>\n\nSelect the batch:', { reply_markup: pickRows('ub', sessions.get(uid).batches.map((b) => b.name), [[{ text: '✖ Cancel', callback_data: 'uc' }]]) });
  }
  const statusText = (s) => `📤 <b>Upload in progress</b>\n━━━━━━━━━━━━━━\n📚 ${esc(s.batchName)}\n📘 ${esc(s.subjectName)}\n📂 <b>${esc(s.chapterName)}</b>\n━━━━━━━━━━━━━━\n✅ Lectures: <b>${s.lectures}</b>   📄 Notes: <b>${s.notes}</b>\n🔀 Mode: ${s.mode === 'auto' ? 'videos → lectures' : 'everything → notes'}${(s.recent && s.recent.length) ? '\n\n🕘 Recent:\n' + s.recent.map((x) => '• ' + esc(x)).join('\n') : ''}\n\n<i>Send or forward videos (lectures) and PDFs/images (notes). Press Done when finished.</i>`;
  const statusKb = (s) => kb([[{ text: s.mode === 'auto' ? '🎬 Videos→Lectures' : '📄 Everything→Notes', callback_data: 'um' }, { text: '📂 Change chapter', callback_data: 'ucc' }], [{ text: '✅ Done', callback_data: 'ud' }]]);
  async function showStatus(chatId, s, fresh) {
    if (s.statusId && !fresh) { await safe(() => tg.editMessageText(chatId, s.statusId, statusText(s), { reply_markup: statusKb(s) })); keepAtBottom(chatId, s); return; }
    const m = await tg.sendMessage(chatId, statusText(s), { reply_markup: statusKb(s) }); s.statusId = m.message_id;
  }
  /* Forwarded files push the status panel up the chat. Once the flow goes quiet, re-send it at the very bottom. */
  function keepAtBottom(chatId, s) {
    if (s.bump) clearTimeout(s.bump);
    s.bump = setTimeout(async () => { s.bump = null; if (!s.statusId || s.done) return; const old = s.statusId; try { const m = await tg.sendMessage(chatId, statusText(s), { reply_markup: statusKb(s) }); s.statusId = m.message_id; await safe(() => tg.call('deleteMessage', { chat_id: chatId, message_id: old })); } catch (e) {} }, 2500);
    if (s.bump.unref) s.bump.unref();
  }
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
      if (kind === 'lecture') { const l = content.addLecture(s.batchId, s.subjectId, s.chapterId, { name, duration, size, fileType, channelMsgId: copied.message_id }); s.lectures++; s.last = `🎬 ${l.name}${l.duration ? ' · ' + hm(l.duration) : ''}`; (s.recent = s.recent || []).push(s.last); s.recent = s.recent.slice(-3); }
      else { const n = content.addNote(s.batchId, s.subjectId, s.chapterId, { name, fileType, channelMsgId: copied.message_id }); s.notes++; s.last = `📄 ${n.name}`; (s.recent = s.recent || []).push(s.last); s.recent = s.recent.slice(-3); }
      s.at = now(); await showStatus(chatId, s);
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
    let copied; try { copied = await tg.call('copyMessage', { chat_id: storage, from_chat_id: chatId, message_id: msg.message_id }); } catch (e) { return tg.sendMessage(chatId, `❌ Could not store the file: ${esc(e.message)}\nMake sure the bot is an admin of the storage channel.`); }
    try { if (s.kind === 'lecture') { const l = content.replaceLecture(s.lid, { channelMsgId: copied.message_id, duration, size, fileType }); sessions.delete(uid); return tg.sendMessage(chatId, `✅ Lecture replaced: <b>${esc(l.name)}</b>${l.duration ? ' · ' + hm(l.duration) : ''}`); }
      const n = content.replaceNote(s.cid, s.nid, { channelMsgId: copied.message_id, fileType }); sessions.delete(uid); return tg.sendMessage(chatId, `✅ Note replaced: <b>${esc(n.name)}</b>`);
    } catch (e) { return tg.sendMessage(chatId, `❌ ${esc(e.message)}`); }
  }
  async function finishUpload(chatId, uid, s) {
    s.done = true; if (s.bump) clearTimeout(s.bump); sessions.delete(uid); const lines = [`✅ <b>Upload finished</b>`, `${esc(s.batchName)} › ${esc(s.subjectName)} › ${esc(s.chapterName)}`, `Lectures: <b>${s.lectures}</b> · Notes: <b>${s.notes}</b>`];
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
      case '/cancel': sessions.delete(uid); howtoWait.delete(uid); pendingBc.delete(uid); return tg.sendMessage(chatId, '✖ Cancelled.');
      case '/howto': howtoWait.set(uid, now()); return tg.sendMessage(chatId, '🎬 <b>How-to video</b>\n\nSend the video (or document) students should see when they tap “How to watch lectures?”. Send /cancel to stop.');
      case '/broadcast': { const t = String(arg || '').trim(); if (t.length < 3) return tg.sendMessage(chatId, 'Usage: /broadcast &lt;message&gt;\nFirst line becomes the title.'); const parts = t.split('\n'); const title = parts[0].slice(0, 100); const body = (parts.slice(1).join('\n').trim() || title).slice(0, 3500); const total = db.user.count ? db.user.count() : 0; pendingBc.set(uid, { title, body }); return tg.sendMessage(chatId, `📣 <b>Broadcast preview</b>\n\n<b>${esc(title)}</b>\n${esc(body)}\n\nThis goes to <b>${total}</b> students.`, { reply_markup: kb([[{ text: `✅ Send to ${total}`, callback_data: 'bcs' }, { text: '✖ Cancel', callback_data: 'bcc' }]]) }); }
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
      if (/^u_[0-9a-f]{16}$/.test(arg) && access.isStaff(uid)) return startFromLink(chatId, uid, arg.slice(2));
      const lvl = userLevel(uid); if (!lvl) return sendLevelChoice(chatId, msg.from.first_name, msg.message_id);
      return proceed(chatId, msg.from, lvl, msg.message_id);
    }
    if (access.isStaff(uid)) {
      const s = getS(uid);
      if (cmd && ['/upload', '/done', '/cancel', '/panel', '/stats', '/ban', '/unban', '/grant', '/howto', '/broadcast'].includes(cmd)) return staffCommand(msg, cmd, arg);
      if (howtoWait.has(uid) && (msg.video || msg.document || msg.animation || msg.video_note)) { howtoWait.delete(uid); try { const cp = await tg.call('copyMessage', { chat_id: config.storageChannelId, from_chat_id: chatId, message_id: msg.message_id }); db.kv.set('howto:msg', String(cp.message_id)); return tg.sendMessage(chatId, '✅ How-to video saved. Students will see it under “How to watch lectures?”.'); } catch (e) { return tg.sendMessage(chatId, `❌ Could not save: ${esc(e.message)}`); } }
      if (s && s.step === 'newchapter' && text && !cmd) { try { const c = content.addChapter(s.batchId, s.subjectId, text); s.chapterId = c._id; s.chapterName = c.name; s.step = 'active'; s.mode = 'auto'; s.at = now(); return showStatus(chatId, s, true); } catch (e) { return tg.sendMessage(chatId, `❌ ${esc(e.message)}`); } }
      if (s && s.step === 'replace' && (msg.video || msg.document || msg.photo || msg.audio || msg.video_note)) return enqueue(uid, () => replaceIngest(msg, s, uid));
      if (s && s.step === 'active' && (msg.video || msg.document || msg.photo || msg.audio || msg.video_note)) return enqueue(uid, () => ingest(msg, s));
      if (cmd === '/help') return tg.sendMessage(chatId, '🛠 <b>Staff commands</b>\n/upload — start an upload session (or use ‘Add files’ / ‘Replace’ in the admin panel)\n/done — finish it\n/cancel — cancel\n/panel — admin panel\n/stats — quick stats\n/ban &lt;id&gt; · /unban &lt;id&gt;\n/grant &lt;id&gt; &lt;hours&gt;\n/broadcast &lt;message&gt; — send to all students\n/howto — set the “How to watch” video');
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
  async function onCallback(q) {
    const uid = String(q.from.id); const chatId = q.message && q.message.chat.id; const data = q.data || ''; const ack = (t, a) => { safe(() => tg.answerCallbackQuery(q.id, t, a)); return Promise.resolve(); }; // fire-and-forget: the button stops spinning at once and we carry on
    db.user.touch(q.from, now()); if (db.ban.isBanned(uid)) return ack('Blocked', true);
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
    if (data === 'bcs' || data === 'bcc') { const pb = pendingBc.get(uid); pendingBc.delete(uid); if (!access.isStaff(uid) || !pb) return ack('Expired', true); if (data === 'bcc') { await ack('Cancelled'); return safe(() => tg.editMessageText(chatId, q.message.message_id, '✖ Broadcast cancelled.')); } await ack('Sending…'); const actor = { id: uid, name: 'bot', role: 'super_admin', perms: new Set(['*']) }; try { const n = service.notification.create(actor, { title: pb.title, body: pb.body, audience: 'all', inApp: true, btnKind: cfg().supportLink ? 'support' : 'none', btnText: 'Support' }); const r = await service.notification.send(actor, n.id); return safe(() => tg.editMessageText(chatId, q.message.message_id, `📣 Broadcast queued for <b>${r.queued}</b> students.`)); } catch (e) { return tg.sendMessage(chatId, `❌ ${esc(e.message)}`); } }
    if (/^r[ln]:/.test(data)) return reminderAction(uid, chatId, data, ack);
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
