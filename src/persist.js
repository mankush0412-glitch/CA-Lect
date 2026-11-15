'use strict';
/**
 * Off-server persistence. The app keeps everything in one SQLite file; if the container/server is replaced the file is gone.
 * This module copies a compressed snapshot of the database to places that survive that, and restores it on the next start:
 *   1. MongoDB   — set MONGODB_URI (needs the `mongodb` npm package: `npm install mongodb`, already in package.json optionalDependencies)
 *   2. Telegram  — set BACKUP_CHAT_ID (or it falls back to STORAGE_CHANNEL_ID): the snapshot is sent as a document and PINNED there;
 *                  on a fresh server the newest pinned snapshot is downloaded again. The bot must be admin with "pin messages".
 * Lectures/notes themselves live in the Telegram storage channel, so the snapshot only holds the index (small).
 */
const fs = require('fs'); const path = require('path'); const os = require('os'); const zlib = require('zlib');
const CHUNK = 8 * 1024 * 1024; const TG_LIMIT_SEND = 49e6; const TG_LIMIT_GET = 19.5e6;

const mongoUri = (env) => env.MONGODB_URI || env.MONGO_URI || env.MONGO_URL || '';
// Telegram snapshots go only to an explicit BACKUP_CHAT_ID, or to the storage channel when MongoDB is NOT configured.
const tgChat = (env) => env.BACKUP_CHAT_ID || (mongoUri(env) ? '' : (env.STORAGE_CHANNEL_ID || ''));
const loadMongo = () => { try { return require('mongodb'); } catch (e) { return null; } };

async function withMongo(env, mod, fn) {
  const client = new mod.MongoClient(mongoUri(env), { serverSelectionTimeoutMS: 10000 }); await client.connect();
  try { return await fn(client.db(env.MONGODB_DB || 'studymate').collection(env.MONGODB_COLLECTION || 'studymate_backup')); } finally { await client.close().catch(() => {}); }
}
async function mongoSave(env, mod, gz) {
  const gen = Date.now(); const parts = Math.max(1, Math.ceil(gz.length / CHUNK));
  await withMongo(env, mod, async (col) => {
    for (let i = 0; i < parts; i++) await col.replaceOne({ _id: `chunk:${gen}:${i}` }, { _id: `chunk:${gen}:${i}`, gen, i, data: gz.subarray(i * CHUNK, (i + 1) * CHUNK) }, { upsert: true });
    await col.replaceOne({ _id: 'meta' }, { _id: 'meta', gen, parts, size: gz.length, at: new Date().toISOString() }, { upsert: true }); // commit point
    await col.deleteMany({ _id: { $regex: '^chunk:' }, gen: { $ne: gen } });
  });
}
async function mongoLoad(env, mod) {
  return withMongo(env, mod, async (col) => {
    const meta = await col.findOne({ _id: 'meta' }); if (!meta) return null; const rows = await col.find({ gen: meta.gen, _id: { $regex: '^chunk:' } }).toArray();
    if (rows.length !== meta.parts) throw new Error('MongoDB snapshot is incomplete'); rows.sort((a, b) => a.i - b.i);
    return Buffer.concat(rows.map((r) => Buffer.from(r.data.buffer ? r.data.buffer : r.data)));
  });
}
async function tgSave(tg, chat, gz, stamp) {
  if (gz.length > TG_LIMIT_SEND) throw new Error('snapshot too large for Telegram (' + gz.length + ' bytes)');
  let prev = null; try { const c = await tg.call('getChat', { chat_id: chat }); prev = c.pinned_message || null; } catch (e) { /* ignore */ }
  const m = await tg.sendDocumentBuffer(chat, gz, `studymate-backup-${stamp}.db.gz`, '🗄 StudyMate database snapshot (auto)', 'application/gzip');
  await tg.call('pinChatMessage', { chat_id: chat, message_id: m.message_id, disable_notification: true });
  if (prev && prev.document && /^studymate-backup-/.test(prev.document.file_name || '')) { try { await tg.call('deleteMessage', { chat_id: chat, message_id: prev.message_id }); } catch (e) { /* ignore */ } }
}
async function tgLoad(tg, chat) {
  const c = await tg.call('getChat', { chat_id: chat }); const d = c.pinned_message && c.pinned_message.document; if (!d || !/^studymate-backup-/.test(d.file_name || '')) return null;
  if (d.file_size && d.file_size > TG_LIMIT_GET) throw new Error('snapshot is larger than Telegram allows bots to download; use MONGODB_URI');
  const f = await tg.call('getFile', { file_id: d.file_id }); const r = await fetch(`${tg.base}/file/bot${tg.token}/${f.file_path}`); if (!r.ok) throw new Error('download failed ' + r.status); return Buffer.from(await r.arrayBuffer());
}

/** Run BEFORE the database is opened. Restores only when there is no local database (or FORCE_RESTORE=1). */
async function restore({ file, env = process.env, tg, deps = {}, log = console }) {
  try { if (fs.existsSync(file) && fs.statSync(file).size > 0 && env.FORCE_RESTORE !== '1') return { restored: false, reason: 'local database exists' }; } catch (e) { /* fall through */ }
  const tries = [];
  if (mongoUri(env)) { const mod = deps.mongo || loadMongo(); if (mod) tries.push(['mongodb', () => mongoLoad(env, mod)]); else log.warn('[persist] MONGODB_URI is set but the "mongodb" package is not installed (run: npm install mongodb)'); }
  if (tg && tgChat(env)) tries.push(['telegram', () => tgLoad(tg, tgChat(env))]);
  for (const [name, load] of tries) {
    try { const gz = await load(); if (!gz) continue; const raw = zlib.gunzipSync(gz); if (raw.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error('not a SQLite file');
      fs.mkdirSync(path.dirname(file), { recursive: true }); for (const x of ['', '-wal', '-shm']) fs.rmSync(file + x, { force: true }); fs.writeFileSync(file, raw); log.log(`[persist] database restored from ${name} (${raw.length} bytes)`); return { restored: true, from: name };
    } catch (e) { log.error(`[persist] restore from ${name} failed: ${e.message}`); }
  }
  return { restored: false, reason: tries.length ? 'no snapshot found' : 'no persistence configured' };
}

function createSnapshotter({ sqlite, env = process.env, tg, deps = {}, log = console, now = () => Date.now() }) {
  let lastChanges = -1, timer = null, fast = null, lastLib = null, lastRunAt = 0, running = false; const status = { enabled: false, last: null, error: '', targets: [] };
  const targets = () => { const t = []; if (mongoUri(env)) t.push('mongodb'); if (tg && tgChat(env)) t.push('telegram'); return t; };
  /** Fingerprint of the library (lectures, notes, chapters, faculties, batches, settings…): changes only when an admin adds/edits/removes content. */
  const library = () => { const a = sqlite.prepare('SELECT COUNT(*) c, COALESCE(MAX(updated_at),0) u, COALESCE(SUM(length(data)),0) s FROM entities').get(); let b = { c: 0, s: 0 }; try { b = sqlite.prepare('SELECT COUNT(*) c, COALESCE(SUM(length(data)),0) s FROM batches').get(); } catch (e) { /* table may not exist */ } return [a.c, a.u, a.s, b.c, b.s].join(':'); };
  const changes = () => sqlite.prepare('SELECT total_changes() AS c').get().c;
  function snapshot() { const tmp = path.join(os.tmpdir(), `sm-snap-${process.pid}-${now()}.db`); try { sqlite.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); return zlib.gzipSync(fs.readFileSync(tmp), { level: 6 }); } finally { fs.rmSync(tmp, { force: true }); } }
  async function run(force = false) {
    if (running) return status; const c = changes(); if (!force && c === lastChanges) return status; const t = targets(); status.targets = t; if (!t.length) return status; running = true;
    try {
      const gz = snapshot(); const stamp = new Date(now() + 330 * 60000).toISOString().slice(0, 16).replace(/[-:T]/g, ''); const errs = []; let ok = 0;
      if (t.includes('mongodb')) { const mod = deps.mongo || loadMongo(); if (!mod) errs.push('mongodb package missing'); else { try { await mongoSave(env, mod, gz); ok++; } catch (e) { errs.push('mongodb: ' + e.message); } } }
      if (t.includes('telegram')) { try { await tgSave(tg, tgChat(env), gz, stamp); ok++; } catch (e) { errs.push('telegram: ' + e.message); } }
      status.error = errs.join(' | '); if (ok) { lastChanges = c; status.last = new Date(now()).toISOString(); lastRunAt = now(); try { lastLib = library(); } catch (e) { /* ignore */ } } if (errs.length) log.error('[persist] ' + status.error);
    } catch (e) { status.error = e.message; log.error('[persist] snapshot failed: ' + e.message); } finally { running = false; }
    return status;
  }
  return {
    run, status: () => ({ ...status, targets: targets() }),
    start() { const t = targets(); status.enabled = t.length > 0; if (!t.length) return; const every = Math.max(1, parseInt(env.BACKUP_EVERY_MIN, 10) || 10) * 60000; setTimeout(() => run(true).catch(() => {}), 20000).unref(); timer = setInterval(() => run().catch(() => {}), every); timer.unref();
      // uploads/edits by admins are saved within ~30-60 s, so a crash right after uploading does not lose them
      try { lastLib = library(); } catch (e) { /* ignore */ } fast = setInterval(() => { try { const l = library(); if (l !== lastLib && now() - lastRunAt > 25000) run(true).catch(() => {}); } catch (e) { /* ignore */ } }, 30000); fast.unref(); log.log('[persist] snapshots enabled → ' + t.join(' + ') + ` (every ${every / 60000} min when data changed)`); },
    async stop() { if (timer) clearInterval(timer); if (fast) clearInterval(fast); timer = null; fast = null; if (status.enabled) await run().catch(() => {}); },
  };
}
module.exports = { restore, createSnapshotter };
