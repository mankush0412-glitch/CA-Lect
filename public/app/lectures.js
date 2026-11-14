/* Lectures tab: Level → Free/Premium → Subjects → Faculty → Batches → Chapters → lecture picker. */
(function () {
  'use strict';
  const { ic, esc, pl, hm } = U;
  const ICON = { accounts: 'book-2', 'adv. accounts': 'book-2', laws: 'scale', law: 'scale', 'corp. laws': 'scale', economics: 'trending-up', quant: 'calculator', costing: 'calculator', auditing: 'book', fm: 'trending-up', sm: 'calculator', 'income tax': 'receipt-tax', gst: 'receipt-tax', taxation: 'receipt-tax' };
  const COL = ['var(--p)', '#2f7cc4', '#3f9b5a', '#e09b2d', '#2f9e8f', '#c4466e', '#d0643a', '#8a5bd0'];
  const LVL = { foundation: ['CA Foundation', 'Accounts, Laws, Economics & Quant', '#2f7cc4', 'book'], intermediate: ['CA Intermediate', 'Group I & Group II subjects', '#4a8a1f', 'school'] };
  /** The level is asked once: it lives on the server and is mirrored in this device's storage as a fallback. */
  const lsLevel = (v) => { try { if (v) { localStorage.setItem('sm_level', v); return v; } const k = localStorage.getItem('sm_level'); return k === 'foundation' || k === 'intermediate' ? k : ''; } catch (e) { return v || ''; } };
  const st = { level: '', tab: 'free', view: 'home', subj: null, fac: null, bid: null, sid: null, type: 'regular', nch: null };
  let nsel = { multi: false, sel: {}, busy: false }; let tree = null, loading = null, host = null, hist = [], backFns = [], bview = null, sheet = null;
  const snap = () => ({ nch: st.nch, view: st.view, subj: st.subj, fac: st.fac, bid: st.bid, sid: st.sid, type: st.type, tab: st.tab });
  function go(next) { hist.push(snap()); Object.assign(st, next); const fn = () => back(); backFns.push(fn); Back.push(fn); draw(); host && host.parentElement && (host.parentElement.scrollTop = 0); }
  function back() { const prev = hist.pop(); const fn = backFns.pop(); if (fn) Back.pop(fn); if (prev) Object.assign(st, prev); draw(); }
  function reset() { hist = []; backFns.forEach((f) => Back.pop(f)); backFns = []; }
  const alwaysAtt = () => !!(tree && tree.config && tree.config.attemptStep === 'always');
  const subjEntry = () => tree && tree.subjects.find((s) => s.name === st.subj);
  const tabBatches = (f) => f.batches.filter((b) => (st.tab === 'premium' ? b.premium : !b.premium)).sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
  const visFacs = (s) => s.faculties.map((f) => ({ ...f, batches: tabBatches(f) })).filter((f) => f.batches.length);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** Attempt shown on a batch: the admin's label (e.g. “May 2027”), else the month of its start date. */
  const att = (b) => { if (b.label) return b.label; const d = b.startDate ? new Date(b.startDate) : null; return d && !isNaN(d) ? MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear() : ''; };
  const pinned = (id) => tree && tree.pins.includes(id);
  const fav = (b) => `<button class="pin ${pinned(b.batchId) ? 'on' : ''}" data-l="pin" data-v="${esc(b.batchId)}" aria-label="Pin">${ic(pinned(b.batchId) ? 'heart-filled' : 'heart')}Pin</button>`;
  const avatar = (f) => `<div class="ci" style="${f.color && !f.pic ? `background:linear-gradient(145deg,${esc(f.color)},#4b3fa8)` : ''}">${f.pic ? `<img src="${esc(f.pic)}" alt="">` : U.ini(f.name)}</div>`;
  const titleRow = (t, sub) => `<div class="trow"><button class="sq" data-l="back" aria-label="Back">${ic('chevron-left')}</button><div><h2>${t}</h2><p>${sub}</p></div></div>`;

  function checkPlan() { U.A('GET', '/plan').then((r) => { const v = !!(r && r.plan); if (v !== !!st.hasPlan) { st.hasPlan = v; if (host && host.isConnected && st.view !== 'batch') { try { draw(); } catch (e) {} } } }).catch(() => {}); }
  async function load(force) { if (loading && !force) return loading; loading = U.A('GET', '/tree?level=' + st.level).then((d) => { tree = d; return d; }).catch((e) => { loading = null; throw e; }); return loading; }
  const tabs = () => `<div class="seg ${st.tab === 'premium' ? 'prem' : ''}"><button class="${st.tab === 'free' ? 'on' : ''}" data-l="tab" data-v="free">${ic('school')}Free Lectures</button><button class="${st.tab === 'premium' ? 'on' : ''}" data-l="tab" data-v="premium">${ic('crown')}Premium ${ic('lock')}</button></div>`;

  function nativeConfirm(msg) { return new Promise((res) => { const t = U.TG; if (t && t.showConfirm) { try { t.showConfirm(msg, (ok) => res(!!ok)); return; } catch (e) {} } U.confirm(msg, '', 'OK').then(res); }); }
  function vPick() { const mk = (k) => { const [n, d, c, i] = LVL[k]; return `<button class="lvc" data-l="level" data-v="${k}" style="border-color:${c}55;background:linear-gradient(135deg,${c}22,transparent)"><div class="ic" style="color:${c}">${ic(i)}</div><div class="m"><b style="color:${c}">${n}</b><span>${d}</span></div><div class="go" style="background:${c}">${ic('chevron-right')}</div></button>`; }; return `<div class="pickl fade"><div class="ic">${ic('school')}</div><h2>Choose your level</h2><p>Pick what you're studying. You can switch any time from the Lectures tab.</p>${mk('foundation')}${mk('intermediate')}</div>`; }
  let ann = null; const annSeen = () => { try { return localStorage.getItem('sm_ann') || ''; } catch (e) { return ''; } };
  function loadAnn() { U.A('GET', '/announcements').then((d) => { ann = (d.items || [])[0] || null; if (ann && ann.id !== annSeen() && st.view === 'home') draw(); }).catch(() => {}); }
  function annBanner() {
    if (!ann || ann.id === annSeen()) return ''; const cfg = (U.me && U.me.config) || {}; const url = ann.btnUrl === '@support' ? cfg.supportLink : ann.btnUrl;
    return `<div class="annc fade"><div class="annh"><span class="ico">${ic('sparkles')}</span><div class="annt"><b>${esc(ann.heading)}</b><p>${esc(ann.body)}</p></div><button class="annx" data-l="annx" aria-label="Dismiss">${ic('x')}</button></div>${ann.btnText && url ? `<button class="btn sm annb" data-l="annb" data-u="${esc(url)}">${ic(ann.btnUrl === '@support' ? 'headset' : 'external')}${esc(ann.btnText)}</button>` : ''}</div>`;
  }
  /** "N new faculty added" card: shows faculties/batches added in the last N days (Admin → Bot configuration → "New faculty card"), until the student dismisses it. */
  function newsList() {
    const days = Number((U.me.config || {}).newFacultyDays == null ? 7 : U.me.config.newFacultyDays); if (!days || !tree) return []; const cut = Date.now() - days * 864e5; let seen = 0; try { seen = +localStorage.getItem('sm_nf_' + st.level) || 0; } catch (e) {}
    const out = []; for (const s of tree.subjects) for (const f of s.faculties) { const nb = f.batches.filter((b) => b.addedAt > cut && b.addedAt > seen && (st.tab === 'premium') === !!b.premium); if (!nb.length) continue; const b = nb.sort((x, y) => y.addedAt - x.addedAt)[0]; out.push({ s, f, b, fresh: (f.createdAt || 0) > cut }); }
    return out.sort((x, y) => y.b.addedAt - x.b.addedAt).slice(0, 3);
  }
  function newsCard() {
    const l = newsList(); if (!l.length) return ''; const allFresh = l.every((x) => x.fresh);
    return `<div class="nfc fade"><div class="nfh"><div class="nfi">${ic('sparkles')}</div><div class="nft"><b>${l.length} new ${allFresh ? 'faculty' : l.length > 1 ? 'batches' : 'batch'} added</b><span>Fresh batches just landed — take a look</span></div><button class="nfx" data-l="nfx" aria-label="Dismiss">${ic('x')}</button></div>${l.map((x, i) => `<button class="nfr" data-l="nf" data-i="${i}"><span class="nfa" style="background:${esc(x.f.color || 'var(--p2)')}">${esc(x.f.initials || '?')}</span><span class="nfm"><b>${esc(x.f.name)}</b><span>${esc(x.s.name)}${x.b.type === 'fastrack' ? ' · Fastrack' : ''}${x.b.label ? ' · ' + esc(x.b.label) : ''}</span></span>${ic('chevron-right')}</button>`).join('')}</div>`;
  }
  function vHome() {
    const subs = tree.subjects; const premAny = subs.some((s) => s.faculties.some((f) => f.batches.some((b) => b.premium)));
    let h = annBanner() + newsCard() + tabs() + `<div class="seg blue lv"><button class="${st.level === 'foundation' ? 'on' : ''}" data-l="switch" data-v="foundation">${ic('book')}Foundation</button><button class="${st.level === 'intermediate' ? 'on' : ''}" data-l="switch" data-v="intermediate">${ic('school')}Intermediate</button></div>`;
    if (st.tab === 'premium' && !premAny) return h + `<div class="card-prem fade"><div class="ic">${ic('crown')}</div><h2 style="margin-bottom:5.5px">Premium Lectures</h2><p style="color:var(--mu);margin-bottom:14.5px">Premium faculty batches unlock with a Premium subscription.</p><button class="btn amber block" data-l="benefits" style="padding:14px">${ic('crown')}Check Premium Benefits</button></div>`;
    h += `<div class="lab">${ic('books')}Subjects</div>`;
    h += subs.length ? `<div class="grid fade">${subs.map((s, i) => { const n = visFacs(s).length; const c = esc(s.color && /^#/.test(s.color) ? s.color : COL[i % COL.length]); return `<button class="sub" data-l="subject" data-v="${esc(s.name)}" style="background:linear-gradient(160deg,${c}22,var(--card))"><div class="go" style="color:${c}">${ic('chevron-right')}</div><div class="ic" style="color:${c}">${ic(ICON[s.name.toLowerCase()] || 'book')}</div><div class="t">${esc(s.name)}</div><span class="chip p" style="color:${c}">${ic('user')}${pl(n, 'teacher')}</span><div class="bar" style="background:${c}"></div></button>`; }).join('')}</div>` : U.empty('books', 'No subjects available yet');
    h += `<button class="big" data-l="planner" style="border-color:rgba(212,87,126,.4);background:linear-gradient(135deg,rgba(168,56,92,.2),var(--card))"><div class="ic" style="color:var(--roseL)">${ic('calendar')}</div><div><b style="color:var(--roseL)">${st.hasPlan ? 'View My Plan' : 'Customised Planner'}</b><span>${st.hasPlan ? 'Continue where you left off' : 'Build your own schedule'}</span></div><div class="go" style="background:var(--gradR)">${ic('chevron-right')}</div></button>`;
    if ((U.me.config || {}).testSeriesEnabled !== false) { const lockT = !(window.Access && Access.state && (Access.state.active || Access.state.staff)); h += `<button class="big" data-l="tests" style="margin-top:9.5px;border-color:${lockT ? 'var(--line)' : 'rgba(47,182,127,.4)'};background:linear-gradient(135deg,rgba(47,182,127,.12),var(--card))"><div class="ic" style="color:var(--g)">${ic('file-text')}</div><div><b>Test Series</b><span>${lockT ? 'Activate free access in the Access tab' : 'Practice tests & mock papers'}</span></div><div class="go" style="background:${lockT ? 'var(--card2)' : 'var(--gradG)'}">${ic(lockT ? 'lock' : 'chevron-right')}</div></button>`; }
    return h;
  }
  function vSubject() {
    const s = subjEntry(); if (!s) return vHome(); const facs = visFacs(s); const cnt = (t) => facs.filter((f) => f.batches.some((b) => b.type === t)).length;
    const list = facs.filter((f) => f.batches.some((b) => b.type === st.type)).map((f) => ({ ...f, batches: f.batches.filter((b) => b.type === st.type) }));
    const h = tabs() + titleRow(esc(s.name), `${pl(facs.length, 'teacher')} · choose one`) + `<div class="seg soft"><button class="${st.type === 'regular' ? 'on' : ''}" data-l="type" data-v="regular">${ic('book')}Regular (${cnt('regular')})</button><button class="${st.type === 'fastrack' ? 'on' : ''}" data-l="type" data-v="fastrack">${ic('bolt')}Fastrack (${cnt('fastrack')})</button></div>`;
    if (!list.length) return h + U.empty('user-off', `No ${st.type} batches yet`);
    return h + `<div class="fade">` + list.map((f) => { const bs = f.batches, one = bs.length === 1 && !alwaysAtt(), b0 = bs[0];
      const meta = one ? `<div class="row">${att(b0) ? `<span class="chip g">${ic('calendar')}${esc(att(b0))}</span>` : ''}${b0.institute ? `<span class="chip d">${ic('building')}${esc(b0.institute)}</span>` : ''}${b0.premium ? `<span class="chip a">${ic('crown')}Premium</span>` : ''}</div><div class="meta"><span>${ic('book')}${pl(b0.chapters, 'chapter')}</span>${b0.seconds ? `<span>${ic('clock')}${hm(b0.seconds)}</span>` : `<span>${ic('player-play')}${pl(b0.lectures, 'lecture')}</span>`}</div>` : `<div class="row"><span class="chip g">${pl(bs.length, 'batch', 'batches')}</span></div><div class="meta" style="gap:5.5px">${att(bs[0]) ? `Latest: <b style="color:var(--tx)">${esc(att(bs[0]))}</b>` : ''}</div>`;
      return `<div class="fc" role="button" tabindex="0" data-l="${one ? 'batch' : 'faculty'}" data-c="${one ? esc(b0.color || f.color || '') : ''}" style="--ac:${one ? esc(b0.color || f.color || '') : esc(f.color || '')}" data-v="${esc(one ? b0.batchId : f.id)}" data-s="${esc(one ? b0.subjectId : '')}">${avatar(f).replace('class="ci"', one ? 'class="ci"' : 'class="ci multi"')}<div class="m"><div class="nm">${esc(f.name)}</div>${meta}</div><div class="chev">${ic('chevron-right')}</div>${one ? fav(b0) : ''}</div>`; }).join('') + '</div>';
  }
  function vFaculty() {
    const s = subjEntry(); const f = s && visFacs(s).find((x) => x.id === st.fac); if (!f) return vSubject(); const bs = f.batches.filter((b) => b.type === st.type);
    return tabs() + titleRow(esc(s.name) + ' › ' + esc(f.name), `Choose your attempt · ${bs.length}`) + '<div class="fade">' + bs.map((b) => `<div class="fc" role="button" tabindex="0" data-l="batch" data-c="${esc(b.color || f.color || '')}" style="--ac:${esc(b.color || f.color || '')}" data-v="${esc(b.batchId)}" data-s="${esc(b.subjectId)}">${avatar(f)}<div class="m"><div class="nm">${esc(f.name)}</div><div class="row">${att(b) ? `<span class="chip g">${ic('calendar')}${esc(att(b))}</span>` : ''}${b.institute ? `<span class="chip d">${ic('building')}${esc(b.institute)}</span>` : ''}${b.premium ? `<span class="chip a">${ic('crown')}Premium</span>` : ''}</div><div class="meta"><span>${ic('book')}${pl(b.chapters, 'chapter')}</span><span>${ic('clock')}${b.seconds ? hm(b.seconds) : pl(b.lectures, 'lecture')}</span></div></div><div class="chev">${ic('chevron-right')}</div>${fav(b)}</div>`).join('') + '</div>';
  }
  function vBatch() {
    const v = bview; if (!v) return `<div class="wrap">${U.sk}</div>`; const f = v.faculty || { name: v.batchName, initials: '', color: '' }; const locked = v.locked;
    let h = `<div class="trow" style="margin-bottom:9.5px"><button class="sq" data-l="back" aria-label="Back">${ic('chevron-left')}</button><div><h2 style="font-size:clamp(14px,5vw,17px)">${esc(st.subj || v.subject)} › ${esc(f.name)}</h2></div></div>`;
    h += `<div class="hero fade">${avatar(f)}<div><h3>${esc(f.name)}</h3><div class="row"><span class="chip">${ic('book')}${esc(st.subj || v.subject)}</span>${v.label ? `<span class="chip">${esc(v.label)}</span>` : ''}${v.institute ? `<span class="chip">${ic('building')}${esc(v.institute)}</span>` : ''}<span class="chip">${pl(v.chapters.length, 'chapter')}</span></div></div></div>`;
    if (locked) h += v.reason === 'premium' ? `<div class="lock prem"><div class="b">${ic('crown')}</div><div>Premium batch — unlock it to open chapters</div></div><div class="acts"><button class="btn amber" data-l="benefits">${ic('crown')}Unlock${v.price ? ' · ₹' + esc(v.price) : ''}</button></div>` : `<div class="lock"><div class="b">${ic('lock')}</div><div>Activate your free access in the Access tab to open chapters</div></div><div class="acts"><button class="btn" data-l="access">${ic('shield-check')}Open Access tab</button></div>`;
    if (!v.chapters.length) return h + U.empty('book-off', 'No chapters yet — check back soon');
    return h + `<div class="fade" style="${st.bcol ? '--ac:' + esc(st.bcol) : ''}">` + v.chapters.slice().sort((a, b) => (a.lectures.length ? 1 : 0) - (b.lectures.length ? 1 : 0)).map((c) => { const hasN = c.notes.length > 0; const hasL = c.lectures.length > 0; const num = String(c.number).padStart(2, '0');
      return `<div class="ch ${locked ? 'lk' : ''}"><div class="num">${num}</div><div style="flex:1;min-width:0"><div class="nm">${esc(c.name)}</div>${hasL ? `<span class="chip">${ic('player-play-filled')}${pl(c.lectures.length, 'lecture')}${c.seconds ? ' · ' + hm(c.seconds) : ''}</span>` : ''}${!locked ? `<div class="btns">${hasL ? `<button class="b1" data-l="lectures" data-v="${esc(c.id)}">${ic('player-play')}Lectures</button>` : ''}${hasN ? `<button class="b2" data-l="notes" data-v="${esc(c.id)}">${ic('file-text')}${hasL ? 'Notes' : 'Get Notes'}</button>` : ''}</div>` : ''}${!hasL && !hasN ? '<span class="chip">Coming soon</span>' : ''}</div>${locked ? ic('lock', 'pl') : ''}</div>`; }).join('') + '</div>';
  }
  /** Notes page: header card, Select Multiple / Select All, one card per file. Tap a file to send it to the bot. */
  const ext = (n) => { const m = /\.([A-Za-z0-9]{2,5})$/.exec(n || ''); return m ? m[1].toUpperCase() : 'PDF'; };
  function vNotes() {
    const v = bview; if (!v) return `<div class="wrap">${U.sk}</div>`; const c = v.chapters.find((x) => x.id === st.nch); if (!c) return vBatch(); const f = v.faculty || { name: v.batchName }; const N = nsel; const n = Object.keys(N.sel).length; const notes = c.notes || [];
    return `${titleRow(esc(v.subject), esc(f.name))}<div class="nt-hero fade"><div class="nt-ic">${ic('file-text')}</div><div><h3>${esc(c.name)}</h3><div class="row"><span class="chip">${esc(f.name)}</span><span class="chip">${pl(notes.length, 'file')}</span></div></div></div>
      <div class="nt-bar"><button class="${N.multi ? 'on' : ''}" data-l="ntmulti">${ic(N.multi ? 'checkbox' : 'square')}${N.multi ? 'Cancel' : 'Select Multiple'}</button><button class="fill" data-l="ntall">${ic('checkbox')}Select All</button></div>
      <div class="fade" style="padding-bottom:${N.multi ? 82 : 0}px">${notes.map((x, i) => `<button class="nt-c ${N.sel[x.id] ? 'sel' : ''}" data-l="nt" data-v="${esc(x.id)}"><span class="nt-i">${N.multi ? ic(N.sel[x.id] ? 'checkbox' : 'square') : ic('file-text')}</span><span class="nt-m"><b>${esc(x.name)}</b><span class="row"><span class="chip g">${ext(x.name)}</span><span class="chip d">#${String(i + 1).padStart(2, '0')}</span></span></span>${N.multi ? '' : `<span class="nt-go">${ic('chevron-right')}</span>`}</button>`).join('') || U.empty('file-text', 'No notes yet')}</div>
      ${N.multi ? `<div class="nt-send"><button class="btn block" data-l="ntsend" ${n && !N.busy ? '' : 'disabled'}>${ic('send')} ${N.busy ? 'Sending…' : n ? `Send ${n} Note${n === 1 ? '' : 's'} to Bot` : 'Select notes to send'}</button></div>` : ''}`;
  }
  async function sendNotes(ids) {
    if (nsel.busy) return; nsel.busy = true; if (nsel.multi) draw();
    try { const r = await U.A('POST', '/notes/send', { chapterId: st.nch, ids }); nsel = { multi: false, sel: {}, busy: false }; if (r.sent) sentToast(r.sent, true, r.via, false); if (r.failed && r.failed.length) showSent(r.sent, r.failed, true, r.via); draw(); }
    catch (e) { nsel.busy = false; draw(); if (e.status === 402) { U.toast(e.message, 'err'); go2('access'); } else if (e.status === 403 && /delivery bot|Start the bot/i.test(e.message)) showSent(0, [{ error: e.message }], true); else U.fail(e); }
  }
  const tsItems = () => (((U.me.config || {}).testSeriesItems) || []).filter((x) => x.level === 'both' || x.level === st.level);
  function vTests() {
    const items = tsItems(); const subs = tree.subjects;
    const h = tabs() + titleRow('Test Series', 'Choose a subject');
    if (!items.length) return h + U.empty('file-text', 'Tests are coming soon');
    return h + '<div class="grid fade">' + items.map((x, i) => { const si = subs.findIndex((s) => s.name.toLowerCase() === x.subject.toLowerCase()); const s = subs[si]; const c = esc(s && s.color && /^#/.test(s.color) ? s.color : COL[(si < 0 ? i : si) % COL.length]);
      return `<button class="sub" data-l="ttest" data-u="${esc(x.url)}" style="background:linear-gradient(160deg,${c}22,var(--card))"><div class="go" style="color:${c}">${ic('external')}</div><div class="ic" style="color:${c}">${ic(ICON[x.subject.toLowerCase()] || 'file-text')}</div><div class="t">${esc(x.subject)}</div>${x.title ? `<span class="chip p" style="color:${c}">${esc(x.title)}</span>` : ''}<div class="bar" style="background:${c}"></div></button>`; }).join('') + '</div>';
  }
  function body() { if (!st.level) return vPick(); if (!tree) return U.sk; return ({ home: vHome, subject: vSubject, faculty: vFaculty, batch: vBatch, tests: vTests, notes: vNotes }[st.view] || vHome)(); }
  function draw() { if (!host) return; host.innerHTML = `<div class="wrap">${body()}</div>`; if (window.Main) Main.afterDraw(host); }

  /* ── lecture picker ── */
  const usable = (x, notes) => !!x;
  function openPicker(chId, mode) {
    const c = bview.chapters.find((x) => x.id === chId); if (!c) return; const notes = mode === 'notes';
    const items = notes ? c.notes.map((n, i) => ({ id: n.id, n: i + 1, label: n.name, sub: '' })) : c.lectures.map((l) => ({ id: l.id, n: l.number, label: l.name, sub: l.duration ? hm(l.duration) : '' }));
    sheet = { chId, mode, multi: false, sel: {}, items, name: c.name, busy: false }; drawSheet();
  }
  function drawSheet() {
    const S = sheet; if (!S) return; let o = document.getElementById('pk'); const selN = Object.keys(S.sel).length; const notes = S.mode === 'notes'; const q = bview.quota;
    if (!o) { o = U.sheet(''); o.id = 'pk'; const oc = o.close; o.close = () => { sheet = null; oc(); }; o.addEventListener('click', onSheet); }
    const inner = `<div class="pk-h"><div class="pl">${ic(notes ? 'file-text' : 'player-play-filled')}</div><div style="min-width:0"><h3>${esc(S.name)}</h3><div class="row" style="margin:0"><span class="chip d">${esc((bview.faculty || {}).name || bview.batchName)}</span><span class="chip p">${pl(S.items.length, notes ? 'note' : 'lecture')}${!notes && bview.chapters.find((x) => x.id === S.chId).seconds ? ' · ' + ic('clock') + hm(bview.chapters.find((x) => x.id === S.chId).seconds) : ''}</span></div></div><button class="x" data-z="close" aria-label="Close">${ic('x')}</button></div>
      <div class="tip">${S.multi ? `Tap ${notes ? 'notes' : 'lectures'} to select, then send them all at once.` : `Tap a ${notes ? 'note' : 'lecture'} number to receive it instantly.`}</div>
      <div class="tiles">${S.items.map((x) => `<button class="tile ${S.sel[x.id] ? 'sel' : ''}" data-z="tile" data-v="${esc(x.id)}" title="${esc(x.label)}">${S.sel[x.id] ? ic('check') : x.n}<small>${S.sel[x.id] ? '' : esc(notes ? 'PDF' : x.sub || '')}</small></button>`).join('')}</div>
      ${!notes && q ? `<div class="ft"><span class="pillb" style="color:var(--mu)">${ic('chart-bar')}${q.left} available quota</span>${q.downloadsLeft > 0 ? `<button class="pillb ${S.save ? 'on' : ''}" data-z="save">${ic('download')}${S.save ? 'Saving allowed' : 'Allow saving'} · ${q.downloadsLeft} left</button>` : ''}</div>` : ''}
      ${S.multi ? `<div class="ft"><span class="pillb"><i style="width:7.5px;height:7.5px;border-radius:50%;background:var(--p)"></i>${selN} selected · ${S.items.length - selN} remaining</span></div><div class="row2"><button class="wide" data-z="cancel">Cancel</button><button class="wide send" data-z="send" ${selN && !S.busy ? '' : 'disabled'}>${ic('send')} ${S.busy ? 'Sending…' : `Send ${selN} ${notes ? 'Note' : 'Lecture'}${selN === 1 ? '' : 's'} to Bot`}</button></div>` : `<div class="ft"><button class="pillb" data-z="multi">${ic('square')}Select Multiple</button><button class="pillb on" data-z="all">${ic('checkbox')}Select All</button></div><button class="wide" data-z="close">Close</button>`}`;
    o.querySelector('.sheet').innerHTML = `<div class="grab"></div>${inner}`;
  }
  async function deliver(ids) {
    const S = sheet; const notes = S.mode === 'notes'; S.busy = true; drawSheet();
    if (!notes && window.Ads) await Ads.lectureTap();
    try { const r = notes ? await U.A('POST', '/notes/send', { chapterId: S.chId, ids }) : await U.A('POST', '/lectures/send', { ids, save: !!S.save }); const o = document.getElementById('pk'); if (r.quota) bview.quota = r.quota; const n = r.sent; const failed = r.failed || [];
      if (o) o.close(); if (n && !failed.length) sentToast(n, notes, r.via, !notes && openBot()); else showSent(n, failed, notes, r.via);
    } catch (e) { S.busy = false; if (document.getElementById('pk')) drawSheet(); if (e.status === 402) { U.toast(e.message, 'err'); const o = document.getElementById('pk'); if (o) o.close(); go2('access'); } else if (e.status === 429) { U.toast(e.message, 'err'); } else U.fail(e); }
  }
  /** Opens the chat with the bot that delivered the files (delivery bot unless the main bot had to step in). */
  const botChat = (via) => { const d = (U.me && U.me.delivery) || {}; const u = d.separate && d.username && via !== 'main' ? d.username : (U.me && U.me.bot); if (u) U.openLink('https://t.me/' + u); };
  const openBot = () => !(tree && tree.config && tree.config.openBotOnSend === false);
  const sentToast = (n, notes, via, auto) => { U.toast(`${n} ${notes ? 'note' : 'lecture'}${n === 1 ? '' : 's'} sent to bot!`, 'ok', { label: 'See bot', fn: () => botChat(via) }); if (auto) botChat(via); };
  function showSent(n, failed, notes, via) {
    const bad = failed.length; const ov = U.modal(`<div style="text-align:center"><div class="em">${bad && !n ? '⚠️' : '✅'}</div><h3>${n ? `${n} ${notes ? 'note' : 'lecture'}${n === 1 ? '' : 's'} sent` : 'Nothing was sent'}</h3><p>${n ? 'Check your chat with the bot — the files are there now.' : ''}${bad ? '\n' + esc(failed[0].error) : ''}</p><button class="btn block" data-m="chat" style="margin-bottom:8.5px">${ic('send')}Open bot chat</button><button class="btn ghost block" data-m="ok">Stay here</button></div>`);
    ov.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; ov.close(); if (b.dataset.m === 'chat') { const d = (U.me && U.me.delivery) || {}; const u = d.separate && d.username && via !== 'main' ? d.username : (U.me && U.me.bot); if (u) U.openLink('https://t.me/' + u); } });
  }
  const go2 = (tab) => { if (window.Main) Main.go(tab); };
  function onSheet(e) {
    const S = sheet; if (!S) return; const z = e.target.closest('[data-z]'); if (!z) return; const k = z.dataset.z; const o = document.getElementById('pk');
    if (k === 'close') return o.close(); if (k === 'multi') { S.multi = true; S.sel = {}; return drawSheet(); } if (k === 'cancel') { S.multi = false; S.sel = {}; return drawSheet(); }
    if (k === 'all') { S.multi = true; S.sel = {}; S.items.forEach((x) => { S.sel[x.id] = 1; }); return drawSheet(); }
    if (k === 'save') { S.save = !S.save; return drawSheet(); }
    if (k === 'tile') { U.tap(); const id = z.dataset.v; if (S.multi) { if (S.sel[id]) delete S.sel[id]; else S.sel[id] = 1; return drawSheet(); } return deliver([id]); }
    if (k === 'send') { const ids = S.items.filter((x) => S.sel[x.id]).map((x) => x.id); if (ids.length) deliver(ids); }
  }
  function benefits() {
    const cfg = (U.me && U.me.config) || {}; const txt = cfg.premiumInfo && cfg.premiumInfo.trim(); const price = bview && bview.price;
    const ov = U.sheet(`<h3>${ic('crown')} Premium benefits</h3><div class="sub2">${txt ? '' : 'Premium batches are unlocked by the admin after enrolment.'}</div>${txt ? `<div class="card" style="white-space:pre-line;line-height:1.55">${esc(txt)}</div>` : ''}${price ? `<div class="kv"><span>Price</span><b>₹${esc(price)}</b></div>` : ''}<div class="foot">${cfg.supportLink ? `<button class="btn amber" data-m="support">${ic('headset')}Contact support</button>` : ''}<button class="btn ghost" data-m="x">Close</button></div>`);
    ov.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; if (b.dataset.m === 'support') U.openLink(cfg.supportLink); ov.close(); });
  }

  async function openBatch(bid, sid) { st.bid = bid; st.sid = sid; bview = null; go({ view: 'batch', bid, sid }); try { bview = await U.A('GET', `/batch/${bid}/${sid}`); } catch (e) { U.fail(e); back(); return; } if (st.view === 'batch') draw(); }
  async function onClick(e) {
    const t = e.target.closest('[data-l]'); if (!t) return; const k = t.dataset.l, v = t.dataset.v; U.tap();
    switch (k) {
      case 'level': st.level = lsLevel(v); try { await U.A('POST', '/level', { level: v }); } catch (x) {} U.me.level = v; if (window.Main) Main.setLevel(v); tree = null; loading = null; draw(); await load(); draw(); break;
      case 'annx': try { localStorage.setItem('sm_ann', ann.id); } catch (x) {} draw(); break;
      case 'annb': U.openLink(t.dataset.u); break;
      case 'switch': if (v !== st.level && await nativeConfirm(`Switch to ${LVL[v][0]}? The app will reload.`)) { st.level = lsLevel(v); try { await U.A('POST', '/level', { level: v }); } catch (x) {} U.me.level = v; if (window.Main) Main.setLevel(v); tree = null; loading = null; reset(); st.view = 'home'; draw(); await load(); draw(); } break;
      case 'tab': st.tab = v; if (st.view === 'batch') { reset(); st.view = 'home'; } draw(); break;
      case 'type': st.type = v; draw(); break;
      case 'subject': st.type = 'regular'; go({ view: 'subject', subj: v }); break;
      case 'faculty': go({ view: 'faculty', fac: v }); break;
      case 'nfx': { let m = 0; newsList().forEach((x) => { m = Math.max(m, x.b.addedAt); }); tree.subjects.forEach((s) => s.faculties.forEach((f) => f.batches.forEach((b) => { if (b.addedAt > m) m = b.addedAt; }))); try { localStorage.setItem('sm_nf_' + st.level, String(m)); } catch (e) {} draw(); break; }
      case 'nf': { const x = newsList()[+t.dataset.i]; if (x) { st.type = x.b.type === 'fastrack' ? 'fastrack' : 'regular'; st.subj = x.s.name; go({ view: 'faculty', fac: x.f.id }); } break; }
      case 'batch': st.bcol = t.dataset.c || ''; openBatch(v, t.dataset.s || (() => { const s = subjEntry(); let sid = ''; s && s.faculties.forEach((f) => f.batches.forEach((b) => { if (b.batchId === v) sid = b.subjectId; })); return sid; })()); break;
      case 'back': if (hist.length) back(); break;
      case 'pin': e.stopPropagation(); try { const r = await U.A('POST', '/pins', { batchId: v }); tree.pins = r.pinned ? tree.pins.concat([v]) : tree.pins.filter((x) => x !== v); U.toast(r.pinned ? 'Pinned to favourites' : 'Removed from favourites', 'ok'); draw(); } catch (x) { U.fail(x); } break;
      case 'lectures': openPicker(v, 'lectures'); break;
      case 'notes': nsel = { multi: false, sel: {}, busy: false }; go({ view: 'notes', nch: v }); break;
      case 'ntmulti': nsel = { multi: !nsel.multi, sel: {}, busy: false }; draw(); break;
      case 'ntall': { const c = bview.chapters.find((x) => x.id === st.nch); nsel = { multi: true, sel: {}, busy: false }; (c.notes || []).forEach((x) => { nsel.sel[x.id] = 1; }); draw(); break; }
      case 'nt': if (nsel.multi) { if (nsel.sel[v]) delete nsel.sel[v]; else nsel.sel[v] = 1; draw(); } else sendNotes([v]); break;
      case 'ntsend': { const ids = Object.keys(nsel.sel); if (ids.length) sendNotes(ids); break; }
      case 'tests': { const on = window.Access && Access.state && (Access.state.active || Access.state.staff); const u = (U.me.config || {}).testSeriesUrl; if (!on) { U.toast('Activate your free access in the Access tab first', 'err'); go2('access'); } else if (tsItems().length) go({ view: 'tests' }); else if (u) U.openLink(u); else U.toast('Test Series is coming soon', 'ok'); break; }
      case 'ttest': U.openLink(t.dataset.u); break;
      case 'benefits': benefits(); break; case 'access': go2('access'); break; case 'planner': if (window.Planner) go2('planner'); break;
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && host && host.isConnected && st.level && st.view !== 'batch') { load(true).then(() => { if (host.isConnected && !sheet) draw(); }).catch(() => {}); } });
  window.Lectures = {
    async render(el) { host = el; reset(); st.view = 'home'; st.level = st.level || (U.me && U.me.level) || lsLevel(); if (st.level) { lsLevel(st.level); if (U.me && !U.me.level) { U.me.level = st.level; U.A('POST', '/level', { level: st.level }).catch(() => {}); } } if (!host.dataset.b) { host.dataset.b = 1; host.addEventListener('click', onClick); host.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.fc')) { e.preventDefault(); onClick(e); } }); }
      draw(); loadAnn(); checkPlan(); if (st.level) { try { await load(true); } catch (e) { host.innerHTML = `<div class="wrap">${U.empty('wifi-off', esc(e.message), '<br><br><button class="btn" data-l="retry">Retry</button>')}</div>`; host.querySelector('[data-l=retry]').onclick = () => { loading = null; Lectures.render(host); }; return; } draw(); } },
    refresh: () => { tree = null; loading = null; },
    async getTree() { if (!st.level) st.level = (U.me && U.me.level) || 'intermediate'; await load(); return tree; },
    st, level: () => st.level,
  };
})();
