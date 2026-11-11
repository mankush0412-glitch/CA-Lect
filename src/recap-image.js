'use strict';
/* Zero-dependency recap card renderer: draws a PNG (gradient card, stat boxes, daily bars, subject split) with a tiny
   built-in 5x7 bitmap font and zlib. Used by "Send recap to Telegram". */
const zlib = require('zlib');

const FONT = {
  A: '01110100011000110001111111000110001', B: '11110100011000111110100011000111110', C: '01110100011000010000100001000101110', D: '11110100011000110001100011000111110', E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000', G: '01110100011000010111100011000101110', H: '10001100011000111111100011000110001', I: '01110001000010000100001000010001110', J: '00111000100001000010000101001001100', K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111', M: '10001110111010110101100011000110001', N: '10001110011010110011100011000110001', O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000', Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001', S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100', U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100', W: '10001100011000110101101011101110001', X: '10001100010101000100010101000110001', Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111',
  0: '01110100011001110101110011000101110', 1: '00100011000010000100001000010001110', 2: '01110100010000100010001000100011111', 3: '11110000010000101110000010000111110', 4: '00010001100101010010111110001000010', 5: '11111100001111000001000001000111110', 6: '00110010001000011110100011000101110', 7: '11111000010001000100010000100001000', 8: '01110100011000101110100011000101110', 9: '01110100011000101111000010001001100',
  ' ': '00000000000000000000000000000000000', '.': '00000000000000000000000000110001100', ',': '00000000000000000000000000001100100', ':': '00000011000110000000011000110000000', '-': '00000000000000011111000000000000000', '/': '00001000010001000100010001000010000', '%': '11001110010001000100010001001110011', '+': '00000001000010011111001000010000000', '(': '00010001000100001000010000010000010', ')': '01000001000001000010000100010001000', "'": '00100001000100000000000000000000000', '>': '10000010000010000010001000100010000', '&': '01100100101010001000101010010001101',
};
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function canvas(w, h) {
  const px = Buffer.alloc(w * h * 3);
  const set = (x, y, c, a = 1) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 3; if (a >= 1) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; } else { px[i] = clamp(px[i] * (1 - a) + c[0] * a); px[i + 1] = clamp(px[i + 1] * (1 - a) + c[1] * a); px[i + 2] = clamp(px[i + 2] * (1 - a) + c[2] * a); } };
  return {
    w, h, px,
    gradient(c1, c2) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const t = (x / w * 0.55 + y / h * 0.45); const i = (y * w + x) * 3; px[i] = clamp(c1[0] + (c2[0] - c1[0]) * t); px[i + 1] = clamp(c1[1] + (c2[1] - c1[1]) * t); px[i + 2] = clamp(c1[2] + (c2[2] - c1[2]) * t); } },
    rrect(x, y, rw, rh, r, c, a = 1) { for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) { const dx = i < r ? r - i : i >= rw - r ? i - (rw - r - 1) : 0; const dy = j < r ? r - j : j >= rh - r ? j - (rh - r - 1) : 0; if (dx * dx + dy * dy <= r * r) set(x + i, y + j, c, a); } },
    text(str, x, y, scale, c, align = 'left', maxW = 0) {
      str = String(str).toUpperCase(); const cw = 6 * scale; let s = str; if (maxW) while (s.length > 1 && s.length * cw > maxW) s = s.slice(0, -1);
      const wpx = s.length * cw - scale; let cx = align === 'center' ? x - Math.round(wpx / 2) : align === 'right' ? x - wpx : x;
      for (const ch of s) { const g = FONT[ch] || FONT[' ']; for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r * 5 + q] === '1') for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) set(cx + q * scale + sx, y + r * scale + sy, c); cx += cw; }
    },
  };
}
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const hm = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m`; };
const PAL = ['#f0a030', '#7c7be6', '#2fb67f', '#e5668a', '#4aa8e0', '#d6b24a'];

/** r = study.recap(...) result; brand = bot name; name = student's display name. Returns a PNG Buffer. */
function renderRecap(r, { brand = 'StudyMate', name = '' } = {}) {
  const W = 900, H = 1180; const c = canvas(W, H); c.gradient(hex('#f08a2c'), hex('#6a4fd8'));
  const white = [255, 255, 255]; const soft = [255, 255, 255];
  c.text(`${r.period === 'all' ? 'ALL TIME' : 'THIS ' + String(r.period).toUpperCase()} - RECAP`, 60, 60, 4, white); c.text(String(r.label).replace('→', '-'), 60, 105, 3, white);
  if (name) c.text(name, W - 60, 60, 3, white, 'right', 380);
  c.text(hm(r.totalSeconds), 60, 170, 12, white); c.text('TOTAL STUDY TIME', 60, 275, 3, white);
  const bx = (i) => 60 + i * 262; [['DAYS ACTIVE', `${r.daysActive}/${r.daysInRange}`], ['AVG / DAY', hm(r.avgSeconds)], ['GOALS HIT', String(r.goalsHit)]].forEach(([l, v], i) => { c.rrect(bx(i), 340, 236, 130, 24, soft, 0.2); c.text(v, bx(i) + 118, 372, 5, white, 'center', 210); c.text(l, bx(i) + 118, 436, 2, white, 'center', 210); });
  c.text('DAILY BREAKDOWN', 60, 520, 3, white);
  const daily = r.daily || []; if (daily.length && daily.length <= 31) { const max = Math.max(1, ...daily.map((d) => d.seconds)); const area = { x: 60, y: 570, w: 780, h: 230 }; const bw = Math.floor(area.w / daily.length); const bar = Math.max(6, Math.floor(bw * 0.62));
    daily.forEach((d, i) => { const hh = d.seconds ? Math.max(8, Math.round(d.seconds / max * (area.h - 40))) : 6; const x = area.x + i * bw + Math.round((bw - bar) / 2); c.rrect(x, area.y + area.h - 30 - hh, bar, hh, Math.min(8, Math.floor(bar / 2)), d.seconds ? white : soft, d.seconds ? 1 : 0.3); if (daily.length <= 8) { const dow = new Date(d.day + 'T00:00:00Z').getUTCDay(); c.text('SMTWTFS'[dow], x + Math.round(bar / 2) - 5, area.y + area.h - 18, 2, white); } });
  } else c.text(r.period === 'all' ? 'ALL-TIME TOTALS' : 'NO DATA', 60, 600, 3, white);
  c.text('SUBJECT SPLIT', 60, 850, 3, white);
  const subs = (r.subjects || []).slice(0, 5); if (!subs.length) c.text('NO STUDY TIME IN THIS PERIOD YET', 60, 910, 3, white); else { const top = Math.max(1, subs[0].seconds); subs.forEach((s, i) => { const y = 905 + i * 46; c.text(s.name, 60, y, 3, white, 'left', 330); c.rrect(400, y + 2, 330, 18, 9, soft, 0.25); c.rrect(400, y + 2, Math.max(18, Math.round(330 * s.seconds / top)), 18, 9, hex(PAL[i % PAL.length])); c.text(hm(s.seconds), 840, y, 3, white, 'right'); }); }
  c.text(brand, W / 2, H - 56, 3, white, 'center', 600);
  return png(W, H, c.px);
}
module.exports = { renderRecap, png, canvas };
