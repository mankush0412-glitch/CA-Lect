'use strict';
const path = require('path');
const env = process.env;
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
module.exports = function loadConfig(over = {}) {
  const c = {
    botToken: env.BOT_TOKEN || '',
    deliveryBotToken: env.DELIVERY_BOT_TOKEN || '',
    razorpayKeyId: env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: env.RAZORPAY_KEY_SECRET || '',
    ownerId: env.OWNER_ID || '',
    port: int(env.PORT, 3000),
    publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
    dataDir: env.DATA_DIR || path.join(process.cwd(), 'data'),
    storageChannelId: env.STORAGE_CHANNEL_ID || '',
    mode: env.BOT_MODE || (env.PUBLIC_URL ? 'webhook' : 'polling'), // webhook | polling | off
    webhookSecret: env.WEBHOOK_SECRET || '',
    brand: env.BRAND_NAME || 'StudyMate',
    tgApi: env.TG_API_BASE || 'https://api.telegram.org',
    fullscreen: env.FULLSCREEN === '1',
    ...over,
  };
  return c;
};
