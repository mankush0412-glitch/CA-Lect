'use strict';
/**
 * Integration glue: mounts the management API + student catalog on the existing Express app,
 * mirrors new entities to MongoDB (Render's disk is ephemeral) and restores them at startup.
 * server.js only needs: const mgmt = require('./core/wire').wire({...}); mgmt.setBot(bot).
 */
const { EntityStore } = require('./entity-store');
const { createService } = require('./service');
const { createAdminHandler, createCatalogHandler } = require('./router');
const { createStudy } = require('./study');
const { createStudyHandler } = require('./study-router');
const { resolveActor, verifyInitData } = require('./rbac');

function wire({ app, db, mongoose, Batch, botToken, ownerId }) {
  let bot = null;
  const entitySchema = new mongoose.Schema({ kind: { type: String, required: true }, id: { type: String, required: true }, data: mongoose.Schema.Types.Mixed }, { minimize: false });
  entitySchema.index({ kind: 1, id: 1 }, { unique: true });
  const Entity = mongoose.models.Entity || mongoose.model('Entity', entitySchema);
  const mongoUp = () => mongoose.connection.readyState === 1;

  const store = new EntityStore(db.getDb(), {
    onWrite: (kind, id, data) => { if (mongoUp()) Entity.updateOne({ kind, id }, { $set: { data } }, { upsert: true }).catch(e => console.error('[entity backup]', e.message)); },
    onDelete: (kind, id) => { if (mongoUp()) Entity.deleteOne({ kind, id }).catch(e => console.error('[entity backup]', e.message)); },
  });

  const batchDb = db.batch;
  const service = createService({
    store, batchDb, userDb: db.user, banDb: db.bannedUser, accessDb: db.access, announcementDb: db.announcement, ownerId,
    // Same persistence path the existing routes use: SQLite already written, mirror to Mongo (best-effort).
    mirrorBatch: (id) => setImmediate(async () => { try { const d = batchDb.getOne(id); if (d && mongoUp()) await Batch.findByIdAndUpdate(id, d, { upsert: true }); } catch (e) { console.error('[batch mirror]', e.message); } }),
    mirrorBatchDelete: (id) => { if (mongoUp()) Batch.findByIdAndDelete(id).catch(() => {}); },
    sendMessage: (userId, html) => bot.sendMessage(parseInt(userId), html, { parse_mode: 'HTML', disable_web_page_preview: true }),
    getPayments: async () => {
      const rows = [];
      for (const name of ['PaytmOrder', 'RazorpayOrder']) { const M = mongoose.models[name]; if (!M) continue; (await M.find({}).sort({ createdAt: -1 }).limit(300).lean()).forEach(o => rows.push({ provider: name.replace('Order', ''), orderId: o.orderId, userId: o.userId, name: [o.firstName, o.lastName].filter(Boolean).join(' '), batchId: o.batchId, amount: o.amount, coupon: o.couponCode || '', status: o.status, createdAt: o.createdAt })); }
      return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    listAdsFree: () => (db.adsFree.getAllActive ? db.adsFree.getAllActive() : []).map(r => ({ userId: r.userId, expiresAt: r.expiresAt })),
  });

  const study = createStudy({
    sqlite: db.getDb(), store, userDb: db.user, banDb: db.bannedUser,
    subjectCatalog: (lv) => store.list('subject').filter((x) => x.level === lv && x.status !== 'archived').sort((a, b) => (a.order || 0) - (b.order || 0)).map((x) => x.name),
    mirror: (kind, id, data) => { if (mongoUp()) Entity.updateOne({ kind, id }, { $set: { data } }, { upsert: true }).catch(() => {}); },
    mirrorDel: (kind, id) => { if (mongoUp()) Entity.deleteOne({ kind, id }).catch(() => {}); },
  });

  // Restore anything that exists in Mongo but not locally (fresh Render disk).
  async function restore() {
    try { const rows = await Entity.find({}).lean(); const mapped = rows.map(r => ({ kind: r.kind, id: r.id, data: r.data })); const n = store.restoreMissing(mapped.filter(r => !/^study_(day|member)$/.test(r.kind))) + study.restore(mapped); if (n) console.log(`[mgmt] restored ${n} entities from MongoDB`); }
    catch (e) { console.error('[mgmt] restore failed:', e.message); }
  }
  if (mongoUp()) restore(); else mongoose.connection.once('connected', restore);

  setInterval(() => { if (bot) service.notification.runScheduled().catch(e => console.error('[scheduler]', e.message)); }, 60000).unref();

  app.use('/api/admin', createAdminHandler({ service, study, store, botToken, ownerId }));
  app.use('/api/study', createStudyHandler({ study, botToken, banDb: db.bannedUser, sendMessage: (id, html) => bot.sendMessage(parseInt(id), html, { parse_mode: 'HTML' }) }));
  app.get('/api/catalog', createCatalogHandler({ service, botToken }));

  return {
    service, store, study,
    setBot(b) { bot = b; },
    /** true if this Telegram user may open the management panel (owner or an active admin_user). */
    isPanelUser: (userId) => !!resolveActor({ id: userId }, ownerId, store),
  };
}
module.exports = { wire };
