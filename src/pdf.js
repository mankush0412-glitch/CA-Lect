'use strict';
/** Tiny dependency-free PDF writer (A4, Helvetica) used for the study-plan PDF. */
const W = 595, H = 842;
const win = (s) => String(s == null ? '' : s).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/[^\x20-\x7e\u00b7]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
class Page {
  constructor() { this.c = []; }
  rect(x, y, w, h, rgb, fill = true) { this.c.push(`${rgb.join(' ')} ${fill ? 'rg' : 'RG'} ${x} ${H - y - h} ${w} ${h} re ${fill ? 'f' : 'S'}`); }
  text(x, y, size, s, { bold = false, rgb = [0.1, 0.1, 0.15] } = {}) { this.c.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb.join(' ')} rg ${x} ${H - y - size} Td (${win(s)}) Tj ET`); }
  box(x, y, s, rgb = [0.4, 0.4, 0.45]) { this.c.push(`${rgb.join(' ')} RG 0.8 w ${x} ${H - y - s} ${s} ${s} re S`); }
  line(x1, y, x2, rgb = [0.85, 0.85, 0.9]) { this.c.push(`${rgb.join(' ')} RG 0.6 w ${x1} ${H - y} m ${x2} ${H - y} l S`); }
}
function build(pages) {
  const objs = []; const add = (s) => { objs.push(s); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>'); add(''); const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const p of pages) { const body = p.c.join('\n'); const cid = add(`<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`); kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cid} 0 R >>`)); }
  objs[1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] >>`;
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xr = Buffer.byteLength(out, 'latin1'); out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
module.exports = { Page, build, W, H };
