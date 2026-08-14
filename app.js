/* ─────────────────────────────────────────────
   결석 보강 관리 — 앱 로직
   저장소: 이 브라우저의 localStorage 한 곳
   ───────────────────────────────────────────── */

'use strict';

const KEY = 'attendance.v1';
const WD = ['일', '월', '화', '수', '목', '금', '토'];

/* ── 저장소 (localStorage를 못 쓰는 환경이면 메모리로 대체) ── */
const store = (() => {
  let ok = true;
  try {
    localStorage.setItem('__t', '1');
    localStorage.removeItem('__t');
  } catch (e) { ok = false; }
  let mem = null;
  return {
    persistent: ok,
    read() {
      if (!ok) return mem;
      try { return localStorage.getItem(KEY); } catch (e) { return null; }
    },
    write(v) {
      if (!ok) { mem = v; return; }
      try { localStorage.setItem(KEY, v); }
      catch (e) { toast('저장 공간이 가득 찼습니다. 백업 후 정리해 주세요.'); }
    }
  };
})();

/* ── 데이터 ── */
let db = { v: 1, students: [], absences: [], calView: 'both' };  // calView: stamp | name | both

function load() {
  const raw = store.read();
  if (!raw) return;
  try {
    const p = JSON.parse(raw);
    if (p && Array.isArray(p.students) && Array.isArray(p.absences)) {
      db = p;
      // 예전 백업에는 표시 설정이 없으므로 기본값을 채운다
      if (!db.calView) db.calView = 'both';
    }
  } catch (e) { console.warn('저장된 기록을 읽지 못했습니다', e); }
}
function save() { store.write(JSON.stringify(db)); }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ── 날짜 ── */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const md = s => s ? s.slice(5).replace('-', '/') : '';
const wd = s => WD[parse(s).getDay()];
const todayStr = () => ymd(new Date());

/* 24시간제 'HH:MM' → '오후 4:30' */
function ampmLabel(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? '오후' : '오전';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${h12}:${pad(m)}`;
}

/* ── 화면 상태 ── */
const ui = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  sid: null,          // null이면 전체 보기
  view: 'calendar',
  bulk: false,        // 결석 여러 날 등록 모드
  bulkCount: 0,
  pickFor: null,      // 보강일 지정 대기 중인 결석 id
  selected: null
};

/* ── 조회 도우미 ── */
const students = () => db.students.slice().sort((a, b) => a.order - b.order);
const student = id => db.students.find(s => s.id === id);
const monthPrefix = () => `${ui.year}-${pad(ui.month)}`;

function absencesOf(sid) {
  return db.absences.filter(a => a.sid === sid).sort((a, b) => a.date < b.date ? -1 : 1);
}
function pendingOf(sid) {
  return db.absences
    .filter(a => (sid == null || a.sid === sid) && !a.makeup && !a.deducted)
    .sort((a, b) => a.date < b.date ? -1 : 1);
}
function absenceOn(sid, date) {
  return db.absences.find(a => a.sid === sid && a.date === date);
}
function statusOf(a) {
  if (a.deducted) return 'deduct';
  return a.makeup ? 'done' : 'pending';
}

/* 날짜별 표시 항목 */
function dayMap() {
  const m = {};
  const push = (date, item) => { (m[date] = m[date] || []).push(item); };
  for (const a of db.absences) {
    if (ui.sid != null && a.sid !== ui.sid) continue;
    push(a.date, { kind: 'absence', st: statusOf(a), a });
    if (a.makeup) push(a.makeup, { kind: 'makeup', st: 'done', a });
  }
  return m;
}

/* ─────────────── 렌더 ─────────────── */

const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

function renderAll() {
  renderStudents();
  renderCalendar();
  renderList();
  renderSummary();
  renderManage();
  renderCalViewSeg();
}

/* 학생 칩 */
function renderStudents() {
  const bar = $('#studentBar');
  bar.innerHTML = '';

  const all = el('button', 'chip' + (ui.sid == null ? ' is-on' : ''));
  all.append(el('span', null, '전체'));
  const totalPending = pendingOf(null).length;
  if (totalPending) all.append(el('span', 'badge', String(totalPending)));
  all.onclick = () => { ui.sid = null; cancelModes(true); renderAll(); };
  bar.append(all);

  for (const s of students()) {
    const c = el('button', 'chip' + (ui.sid === s.id ? ' is-on' : ''));
    c.append(el('span', null, s.name));
    const n = pendingOf(s.id).length;
    if (n) c.append(el('span', 'badge', String(n)));
    c.onclick = () => { ui.sid = s.id; cancelModes(true); renderAll(); };
    bar.append(c);
  }

  const add = el('button', 'chip add', '＋ 학생');
  add.onclick = () => studentSheet(null);
  bar.append(add);
}

/* 달력 */
/* 표시 방식에 맞춰 범례를 다시 그린다 */
function renderLegend() {
  const box = $('#legend');
  if (!box) return;
  box.innerHTML = '';
  const mode = db.calView || 'both';

  const add = (label, cls, mark, stampCls) => {
    const w = el('span', 'lg');
    if (mode === 'name') {
      w.append(el('b', 'sw ' + cls, '이름'));
    } else {
      const i = el('i', 'stamp sm ' + stampCls);
      i.textContent = mark;
      w.append(i);
    }
    w.append(el('span', null, label));
    box.append(w);
  };

  add('보강 미정', 'c-red', '결', 'stamp-red');
  add('보강 잡힌 결석', 'c-done', '결', 'stamp-done');
  add('보강일', 'c-blue', '보', 'stamp-blue');
}

function renderCalendar() {
  renderLegend();
  $('#monthLabel').textContent = `${ui.year}.${pad(ui.month)}`;

  const grid = $('#calGrid');
  grid.innerHTML = '';

  const first = new Date(ui.year, ui.month - 1, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());

  const map = dayMap();
  const today = todayStr();

  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (i >= 35 && d.getMonth() !== ui.month - 1) break;

    const ds = ymd(d);
    const inMonth = d.getMonth() === ui.month - 1;
    const items = inMonth ? (map[ds] || []) : [];

    const cell = el('button', 'day');
    if (!inMonth) cell.classList.add('out');
    if (d.getDay() === 0) cell.classList.add('sun');
    if (d.getDay() === 6) cell.classList.add('sat');
    if (ds === today) cell.classList.add('today');
    if (ds === ui.selected) cell.classList.add('sel');

    /* 배경 우선순위: 미보강(빨강) > 보강일(파랑) > 보강 잡힌 결석(중립) > 차감(회색) */
    const kinds = new Set(items.map(x => x.kind));
    const sts = new Set(items.map(x => x.st));
    if (sts.has('pending')) cell.classList.add('has-red');
    else if (kinds.has('makeup')) cell.classList.add('has-blue');
    else if (sts.has('done')) cell.classList.add('has-done');
    else if (sts.has('deduct')) cell.classList.add('has-gray');

    cell.append(el('span', 'dnum', String(d.getDate())));

    if (items.length) fillCell(cell, items);

    cell.onclick = () => onDayTap(ds, inMonth);
    grid.append(cell);
  }
}


/* 달력 한 칸의 내용. 표시 방식(db.calView)에 따라 달라진다. */
function fillCell(cell, items) {
  const mode = db.calView || 'both';

  // 도장만 — 한 줄에 여러 개, 3개까지
  if (mode === 'stamp') {
    const wrap = el('span', 'stamps');
    for (const it of items.slice(0, 3)) wrap.append(stampFor(it));
    cell.append(wrap);
    if (items.length > 3) cell.append(el('span', 'more', `+${items.length - 3}`));
    return;
  }

  // 이름 표시 — 세로로 2명까지, 나머지는 접는다
  const LIMIT = 2;
  const list = el('span', 'names');

  for (const it of items.slice(0, LIMIT)) {
    const row = el('span', 'nm ' + colorOf(it));
    if (mode === 'both') row.append(stampFor(it, true));

    // 학생 한 명만 보는 중이면 이름이 뻔하므로 시간을 대신 보여준다
    let text;
    if (ui.sid != null) {
      if (it.kind === 'makeup') text = it.a.time ? ampmLabel(it.a.time) : '보강';
      else text = it.st === 'deduct' ? '차감' : '결석';
    } else {
      text = student(it.a.sid) ? student(it.a.sid).name : '';
    }
    row.append(el('span', 'tx', text));
    list.append(row);
  }

  cell.append(list);
  if (items.length > LIMIT) cell.append(el('span', 'more', `+${items.length - LIMIT}`));
}

function colorOf(it) {
  if (it.kind === 'makeup') return 'c-blue';       // 보강하는 날
  if (it.st === 'pending') return 'c-red';         // 아직 보강일이 없음
  if (it.st === 'done') return 'c-done';           // 보강이 잡힌 결석일
  return 'c-gray';                                 // 차감
}

function stampFor(it, mini) {
  const s = el('i', 'stamp' + (mini ? ' mini' : ''));
  if (it.kind === 'makeup') { s.classList.add('stamp-blue'); s.textContent = '보'; }
  else if (it.st === 'pending') { s.classList.add('stamp-red'); s.textContent = '결'; }
  else if (it.st === 'done') { s.classList.add('stamp-done'); s.textContent = '결'; }
  else { s.classList.add('stamp-gray'); s.textContent = '차'; }
  s.title = student(it.a.sid) ? student(it.a.sid).name : '';
  return s;
}

/* 아래 목록 */
function renderList() {
  const box = $('#absList');
  box.innerHTML = '';

  const pre = monthPrefix();
  let rows = db.absences.filter(a =>
    (a.date.startsWith(pre) || (a.makeup && a.makeup.startsWith(pre))) &&
    (ui.sid == null || a.sid === ui.sid));
  rows.sort((a, b) => a.date < b.date ? -1 : 1);

  $('#listTitle').textContent = ui.sid == null
    ? '이번 달 결석' : `${student(ui.sid) ? student(ui.sid).name : ''} 결석`;
  $('#listCount').textContent = rows.length ? `${rows.length}건` : '';

  if (!rows.length) {
    const e = el('div', 'empty');
    e.append(el('b', null, db.students.length ? '이번 달은 결석이 없습니다' : '학생을 먼저 추가하세요'));
    e.append(el('span', null, db.students.length
      ? '달력에서 결석한 날짜를 눌러 등록하세요.'
      : '위쪽 ＋ 학생 버튼으로 시작합니다.'));
    box.append(e);
    return;
  }

  for (const a of rows) box.append(recordRow(a));
}

function recordRow(a) {
  const st = statusOf(a);
  const row = el('button', 'rec');

  const stamp = el('i', 'stamp ' + (st === 'pending' ? 'stamp-red' : st === 'done' ? 'stamp-done' : 'stamp-gray'));
  stamp.textContent = st === 'deduct' ? '차' : '결';
  row.append(stamp);

  const main = el('div', 'main');
  main.append(el('div', 'd1', `${md(a.date)} (${wd(a.date)}) 결석`));
  const s = student(a.sid);
  const sub = st === 'done'
    ? `보강 ${md(a.makeup)} (${wd(a.makeup)})${a.time ? ' ' + a.time : ''}`
    : st === 'deduct' ? '차감 처리' : '보강일 미정';
  main.append(el('div', 'd2', (ui.sid == null && s ? s.name + ' · ' : '') + sub + (a.memo ? ' · ' + a.memo : '')));
  row.append(main);

  row.append(el('span', 'tag ' + (st === 'pending' ? 'tag-red' : st === 'done' ? 'tag-blue' : 'tag-gray'),
    st === 'pending' ? '보강/차감' : st === 'done' ? '완료' : '차감'));
  row.append(el('span', 'go', '›'));

  row.onclick = () => recordSheet(a.id);
  return row;
}

/* 월간 요약 */
function renderSummary() {
  const pre = monthPrefix();
  const list = students().map(s => {
    const rows = db.absences.filter(a => a.sid === s.id);
    const abs = rows.filter(a => a.date.startsWith(pre)).sort((a, b) => a.date < b.date ? -1 : 1);
    const mk = rows.filter(a => a.makeup && a.makeup.startsWith(pre)).sort((a, b) => a.makeup < b.makeup ? -1 : 1);
    return { s, abs, mk, pending: abs.filter(a => !a.makeup && !a.deducted).length };
  });

  const totAbs = list.reduce((n, r) => n + r.abs.length, 0);
  const totMk = list.reduce((n, r) => n + r.mk.length, 0);
  const totPen = list.reduce((n, r) => n + r.pending, 0);

  const strip = $('#statStrip');
  strip.innerHTML = '';
  const stat = (n, l, warn) => {
    const b = el('div', 'stat' + (warn ? ' warn' : ''));
    b.append(el('div', 'n', String(n)));
    b.append(el('div', 'l', l));
    return b;
  };
  strip.append(stat(totAbs, '결석'), stat(totMk, '보강'), stat(totPen, '미보강', totPen > 0));

  const t = $('#sumTable');
  t.innerHTML = '';
  const head = el('tr');
  ['이름', '결석', '보강', '미보강', '결석일', '보강일'].forEach((h, i) => {
    const th = el('th', null, h);
    if (i > 0 && i < 4) th.style.textAlign = 'center';
    head.append(th);
  });
  const thead = el('thead');
  thead.append(head);
  t.append(thead);

  const body = el('tbody');
  if (!list.length) {
    const tr = el('tr');
    const td = el('td', null, '등록된 학생이 없습니다.');
    td.colSpan = 6; td.style.color = 'var(--muted)'; td.style.padding = '24px 10px';
    tr.append(td); body.append(tr);
  }

  for (const r of list) {
    const tr = el('tr');
    if (r.pending) tr.className = 'warn';
    tr.append(el('td', 'name', r.s.name));
    const num = (v, label) => {
      const td = el('td', 'num', v || '·');
      td.dataset.l = label;
      return td;
    };
    const pendTd = num(r.pending, '미보강');
    if (r.pending) pendTd.classList.add('warn');
    tr.append(num(r.abs.length, '결석'), num(r.mk.length, '보강'), pendTd);

    const c1 = el('td', 'dates');
    c1.dataset.l = '결석일';
    if (!r.abs.length) c1.append(el('span', 'd-none', '—'));
    r.abs.forEach((a, i) => {
      const st = statusOf(a);
      c1.append(el('span', st === 'pending' ? 'd-red' : st === 'done' ? 'd-done' : 'd-gray', md(a.date)));
      if (i < r.abs.length - 1) c1.append(document.createTextNode('  '));
    });
    tr.append(c1);

    const c2 = el('td', 'dates');
    c2.dataset.l = '보강일';
    if (!r.mk.length) c2.append(el('span', 'd-none', '—'));
    r.mk.forEach((a, i) => {
      c2.append(el('span', 'd-blue', md(a.makeup)));
      if (i < r.mk.length - 1) c2.append(document.createTextNode('  '));
    });
    tr.append(c2);

    tr.onclick = () => { ui.sid = r.s.id; switchView('calendar'); renderAll(); };
    body.append(tr);
  }
  t.append(body);
}

/* 학생 관리 */
function renderCalViewSeg() {
  const seg = $('#calViewSeg');
  if (!seg) return;
  for (const b of seg.children) {
    b.classList.toggle('is-on', b.dataset.v === (db.calView || 'both'));
  }
}

function renderManage() {
  const box = $('#studentList');
  box.innerHTML = '';
  const list = students();

  if (!list.length) {
    const e = el('div', 'empty');
    e.append(el('b', null, '아직 학생이 없습니다'));
    e.append(el('span', null, '학생 추가를 눌러 이름을 등록하세요.'));
    box.append(e);
    return;
  }

  for (const s of list) {
    const row = el('button', 'rec');
    const main = el('div', 'main');
    main.append(el('div', 'd1', s.name));
    const n = pendingOf(s.id).length;
    const total = absencesOf(s.id).length;
    main.append(el('div', 'd2',
      `결석 ${total}건${n ? ` · 미보강 ${n}건` : ''}`));
    row.append(main);
    row.append(el('span', 'go', '›'));
    row.onclick = () => studentSheet(s);
    box.append(row);
  }
}

/* ─────────────── 바텀시트 ─────────────── */

function openSheet(title, build) {
  $('#sheetTitle').textContent = title;
  const body = $('#sheetBody');
  body.innerHTML = '';
  build(body);
  $('#scrim').hidden = false;
  $('#sheet').hidden = false;
}
function closeSheet() {
  $('#scrim').hidden = true;
  $('#sheet').hidden = true;
}
function option(label, sub, cls, fn) {
  const b = el('button', 'opt' + (cls ? ' ' + cls : ''));
  const body = el('div', 'body');
  body.append(el('div', null, label));
  if (sub) body.append(el('div', 'sub', sub));
  b.append(body);
  b.onclick = fn;
  return b;
}
function section(text) { return el('div', 'sheet-sec', text); }

/* 날짜 탭 */
function onDayTap(ds, inMonth) {
  if (!inMonth) {
    const d = parse(ds);
    ui.year = d.getFullYear(); ui.month = d.getMonth() + 1;
    renderAll();
    return;
  }
  ui.selected = ds;

  // 보강일 지정 대기 중
  if (ui.pickFor) { chooseMakeup(ui.pickFor, ds); return; }

  // 여러 날 등록 모드
  if (ui.bulk && ui.sid != null) {
    if (absenceOn(ui.sid, ds)) { toast(`${md(ds)}은 이미 등록되어 있습니다`); return; }
    addAbsence(ui.sid, ds);
    ui.bulkCount++;
    $('#modeText').textContent = `${student(ui.sid).name} · ${ui.bulkCount}일 등록됨`;
    renderCalendar(); renderList(); renderStudents();
    return;
  }

  renderCalendar();
  daySheet(ds);
}

function daySheet(ds) {
  const title = `${ui.month}월 ${parse(ds).getDate()}일 (${wd(ds)})`;

  openSheet(title, body => {
    const onDay = db.absences.filter(a =>
      (a.date === ds || a.makeup === ds) && (ui.sid == null || a.sid === ui.sid));

    /* 이미 이 날에 기록이 있으면 먼저 보여준다 */
    if (onDay.length) {
      body.append(section('이 날의 기록'));
      for (const a of onDay) {
        const s = student(a.sid);
        const isMakeup = a.makeup === ds && a.date !== ds;
        const st = statusOf(a);
        const label = isMakeup
          ? `${s.name} 보강${a.time ? ' ' + ampmLabel(a.time) : ''}`
          : `${s.name} 결석`;
        const sub = isMakeup
          ? `${md(a.date)} 결석분`
          : st === 'done' ? `보강 ${md(a.makeup)}` : st === 'deduct' ? '차감 처리' : '보강일 미정';
        body.append(option(label, sub, st === 'pending' ? 'red' : st === 'done' ? 'blue' : '',
          () => recordSheet(a.id)));
      }
    }

    /* 결석 등록 */
    const targets = ui.sid != null
      ? (absenceOn(ui.sid, ds) ? [] : [student(ui.sid)])
      : students().filter(s => !absenceOn(s.id, ds));

    if (targets.length) {
      body.append(section('결석으로 등록'));
      if (ui.sid != null) {
        body.append(option(`${targets[0].name} 결석`, '보강일은 나중에 정해도 됩니다', 'red', () => {
          addAbsence(targets[0].id, ds); closeSheet(); renderAll();
          toast(`${md(ds)} 결석 등록`);
        }));
      } else {
        for (const s of targets) {
          body.append(option(s.name, null, null, () => {
            addAbsence(s.id, ds); closeSheet(); renderAll();
            toast(`${s.name} · ${md(ds)} 결석 등록`);
          }));
        }
      }
    }

    /* 이 날을 보강일로 */
    const pend = pendingOf(ui.sid).filter(a => a.date !== ds);
    if (pend.length) {
      body.append(section('이 날을 보강일로'));
      for (const a of pend) {
        const s = student(a.sid);
        body.append(option(
          `${ui.sid == null ? s.name + ' · ' : ''}${md(a.date)} (${wd(a.date)}) 결석분`,
          '이 날 보강으로 연결합니다', 'blue',
          () => chooseMakeup(a.id, ds)));
      }
    }

    if (!body.children.length) {
      body.append(el('p', 'note', '표시할 항목이 없습니다. 학생을 먼저 추가하세요.'));
    }
  });
}

/* 결석 1건 상세 */
function recordSheet(id) {
  const a = db.absences.find(x => x.id === id);
  if (!a) return closeSheet();
  const s = student(a.sid);
  const st = statusOf(a);

  openSheet(`${s.name} · ${md(a.date)} 결석`, body => {
    const info = el('p', 'note');
    info.textContent = st === 'done'
      ? `보강 ${md(a.makeup)} (${wd(a.makeup)})${a.time ? ' ' + ampmLabel(a.time) : ''}로 잡혀 있습니다.`
      : st === 'deduct' ? '보강 없이 차감 처리한 결석입니다.'
      : '아직 보강일이 정해지지 않았습니다.';
    body.append(info);

    if (st !== 'deduct') {
      body.append(option(st === 'done' ? '보강일 바꾸기' : '보강일 정하기',
        '달력에서 날짜를 누르면 연결됩니다', 'blue', () => startPick(a.id)));
    }
    if (st === 'done') {
      body.append(option('보강 취소', '보강일만 지웁니다', null, () => {
        a.makeup = null; a.time = ''; save(); closeSheet(); renderAll();
        toast('보강일을 지웠습니다');
      }));
    }
    body.append(option(st === 'deduct' ? '차감 해제' : '차감 처리',
      st === 'deduct' ? '다시 보강 대상으로 돌립니다' : '보강 없이 마무리합니다', null, () => {
        if (!a.deducted) { a.makeup = null; a.time = ''; }
        a.deducted = !a.deducted;
        save(); closeSheet(); renderAll();
        toast(a.deducted ? '차감 처리했습니다' : '차감을 해제했습니다');
      }));

    body.append(option('메모', a.memo || '없음', null, () => memoSheet(a.id)));

    body.append(option('결석 기록 삭제', null, 'red', () => {
      if (!confirm(`${s.name} · ${md(a.date)} 결석 기록을 지웁니다.`)) return;
      db.absences = db.absences.filter(x => x.id !== a.id);
      save(); closeSheet(); renderAll();
      toast('삭제했습니다');
    }));
  });
}

function memoSheet(id) {
  const a = db.absences.find(x => x.id === id);
  openSheet('메모', body => {
    const f = el('div', 'field');
    const lb = el('label', null, '이 결석에 남길 메모');
    const inp = el('input');
    inp.value = a.memo || '';
    inp.placeholder = '예: 학교 행사';
    f.append(lb, inp);
    body.append(f);
    const btn = el('button', 'primary-btn', '저장');
    btn.onclick = () => {
      a.memo = inp.value.trim(); save(); closeSheet(); renderAll(); toast('메모를 저장했습니다');
    };
    body.append(btn);
    setTimeout(() => inp.focus(), 120);
  });
}

/* 보강일 지정 모드 */
function startPick(id) {
  stopBulk(true);
  ui.pickFor = id;
  closeSheet();
  switchView('calendar');
  const a = db.absences.find(x => x.id === id);
  $('#modeText').textContent = `${md(a.date)} 결석 → 보강할 날짜를 누르세요`;
  $('#modeBar').hidden = false;
  renderCalendar();
}

function chooseMakeup(absId, ds) {
  const a = db.absences.find(x => x.id === absId);
  if (!a) return;
  if (a.date === ds) { toast('결석일과 같은 날은 안 됩니다'); return; }
  timeSheet(a, ds);
}

function timeSheet(a, ds) {
  const s = student(a.sid);
  openSheet('보강 시간', body => {
    const p = el('p', 'note');
    p.textContent = `${s.name} · ${md(a.date)} 결석분을 ${ui.month === parse(ds).getMonth() + 1 ? '' : ''}${md(ds)} (${wd(ds)})에 보강합니다.`;
    body.append(p);

    const commit = time => {
      a.makeup = ds; a.time = time; a.deducted = false;
      save();
      ui.pickFor = null;
      $('#modeBar').hidden = true;
      closeSheet(); renderAll();
      toast(`${md(a.date)} → ${md(ds)} 보강 연결`);
    };

    const allDay = el('button', 'primary-btn', '시간 없이 저장');
    allDay.onclick = () => commit('');
    body.append(allDay);

    body.append(section('자주 쓰는 시간'));
    const pre = el('div', 'time-grid');
    ['14:00', '15:00', '16:00', '16:30', '17:00', '18:00', '19:00', '20:00'].forEach(t => {
      const b = el('button', null, ampmLabel(t));
      b.onclick = () => commit(t);
      pre.append(b);
    });
    body.append(pre);

    body.append(section('직접 고르기'));

    const wheel = timeWheel(16, 30);   // 기본값 오후 4:30
    body.append(wheel.node);

    const done = el('button', 'primary-btn blue', '');
    const label = () => { done.textContent = `${wheel.text()} 로 저장`; };
    wheel.onChange = label;
    label();
    done.onclick = () => commit(wheel.value());
    body.append(done);
  });
}


/* ─────────────── 시간 휠 (오전·오후 / 시 / 10분) ─────────────── */

function timeWheel(initH24, initMin) {
  const node = el('div', 'wheel');
  const ampmList = ['오전', '오후'];
  const hourList = Array.from({ length: 12 }, (_, i) => i + 1);
  const minList = ['00', '10', '20', '30', '40', '50'];

  let ampm = initH24 >= 12 ? '오후' : '오전';
  let hour = initH24 % 12 === 0 ? 12 : initH24 % 12;
  let min = minList.includes(pad(initMin)) ? pad(initMin) : '00';

  const api = { node, onChange: null };

  /* 한 열을 만든다. 스크롤이 멈추면 가운데 항목이 선택된다. */
  function column(items, current, onPick, cls) {
    const col = el('div', 'wheel-col' + (cls ? ' ' + cls : ''));
    const inner = el('div', 'wheel-inner');
    col.append(inner);

    inner.append(el('div', 'wheel-pad'));
    const cells = items.map(v => {
      const c = el('div', 'wheel-cell', String(v));
      c.dataset.v = String(v);
      c.onclick = () => scrollTo(items.indexOf(v), true);
      inner.append(c);
      return c;
    });
    inner.append(el('div', 'wheel-pad'));

    const H = 40;   // .wheel-cell 높이와 반드시 같아야 한다
    const mark = idx => cells.forEach((c, i) => c.classList.toggle('is-on', i === idx));

    function scrollTo(idx, smooth) {
      col.scrollTo({ top: idx * H, behavior: smooth ? 'smooth' : 'auto' });
      mark(idx);
      onPick(items[idx]);
      if (api.onChange) api.onChange();
    }

    let t;
    col.addEventListener('scroll', () => {
      clearTimeout(t);
      const idx = Math.max(0, Math.min(items.length - 1, Math.round(col.scrollTop / H)));
      mark(idx);
      t = setTimeout(() => {
        col.scrollTo({ top: idx * H, behavior: 'smooth' });
        onPick(items[idx]);
        if (api.onChange) api.onChange();
      }, 90);
    }, { passive: true });

    requestAnimationFrame(() => scrollTo(items.indexOf(current), false));
    return col;
  }

  node.append(el('div', 'wheel-band'));
  node.append(column(ampmList, ampm, v => { ampm = v; }));
  node.append(column(hourList, hour, v => { hour = v; }, 'num'));
  node.append(column(minList, min, v => { min = v; }, 'num'));

  api.text = () => `${ampm} ${hour}:${min}`;
  api.value = () => {
    let h = hour % 12;
    if (ampm === '오후') h += 12;
    return `${pad(h)}:${min}`;
  };
  return api;
}

/* 학생 추가 / 수정 */
function studentSheet(s) {
  openSheet(s ? '학생 수정' : '학생 추가', body => {
    const f = el('div', 'field');
    f.append(el('label', null, '이름'));
    const name = el('input');
    name.value = s ? s.name : '';
    name.placeholder = '예: 홍길동';
    f.append(name);
    body.append(f);

    const btn = el('button', 'primary-btn', s ? '저장' : '추가');
    const submit = () => {
      const nm = name.value.trim();
      if (!nm) { toast('이름을 입력하세요'); name.focus(); return; }
      if (s) { s.name = nm; }
      else {
        const order = db.students.length ? Math.max(...db.students.map(x => x.order)) + 1 : 0;
        db.students.push({ id: uid(), name: nm, order });
      }
      save(); closeSheet(); renderAll();
      toast(s ? '저장했습니다' : `${nm} 학생을 추가했습니다`);
    };
    btn.onclick = submit;
    name.onkeydown = e => { if (e.key === 'Enter') submit(); };
    body.append(btn);

    if (s) {
      const del = el('button', 'danger-btn', '학생 삭제');
      del.onclick = () => {
        const n = absencesOf(s.id).length;
        if (!confirm(`${s.name} 학생과 결석 기록 ${n}건을 모두 지웁니다.`)) return;
        db.students = db.students.filter(x => x.id !== s.id);
        db.absences = db.absences.filter(a => a.sid !== s.id);
        if (ui.sid === s.id) ui.sid = null;
        save(); closeSheet(); renderAll();
        toast('삭제했습니다');
      };
      body.append(del);
    }
    setTimeout(() => name.focus(), 120);
  });
}


/* ─────────────── 사용법 안내 ─────────────── */

function guideSheet() {
  openSheet('사용법', body => {
    const step = (n, title, desc) => {
      const w = el('div', 'guide-step');
      w.append(el('span', 'gs-n', String(n)));
      const b = el('div', 'gs-b');
      b.append(el('div', 'gs-t', title));
      b.append(el('div', 'gs-d', desc));
      w.append(b);
      body.append(w);
    };

    step(1, '학생 등록',
      '위쪽 ＋ 학생 을 눌러 이름을 넣습니다.');
    step(2, '결석 등록',
      '학생을 고른 뒤 달력에서 결석한 날짜를 누릅니다. ' +
      '여러 날은 결석 여러 날 등록 을 켜고 이어서 누르면 됩니다.');
    step(3, '보강일 정하기',
      '아래 목록에서 결석을 누르고 보강일 정하기 → 달력에서 보강할 날짜를 누릅니다. ' +
      '보강 없이 끝낼 결석은 차감 처리 를 누르세요.');
    step(4, '한눈에 보기',
      '요약 탭에서 학생별 결석일과 보강일을 한 줄로 확인합니다. CSV로 내보내면 엑셀에서 열립니다.');

    body.append(el('div', 'sheet-sec', '색이 뜻하는 것'));

    const color = (cls, label, desc) => {
      const w = el('div', 'guide-color');
      w.append(el('b', 'gc-s ' + cls, '이름'));
      const b = el('div', 'gs-b');
      b.append(el('div', 'gs-t', label));
      b.append(el('div', 'gs-d', desc));
      w.append(b);
      body.append(w);
    };
    color('c-red', '빨강', '결석했는데 보강일이 아직 없습니다.');
    color('c-done', '검정 + 취소선', '보강일이 잡힌 결석입니다. 처리가 끝났습니다.');
    color('c-blue', '파랑', '보강하는 날입니다.');
    color('c-gray', '회색 + 취소선', '보강 없이 차감 처리했습니다.');

    body.append(el('p', 'note',
      '달력에서 빨간 것만 없애면 그 달 정리가 끝납니다.'));

    body.append(el('div', 'sheet-sec', '기록 보관'));
    body.append(el('p', 'note',
      '기록은 이 브라우저 안에만 저장됩니다. 브라우저 데이터를 지우거나 기기를 바꾸면 사라지니, ' +
      '설정 탭에서 가끔 백업해 두세요.'));

    const ok = el('button', 'primary-btn', '알겠습니다');
    ok.onclick = () => { markGuideSeen(); closeSheet(); };
    body.append(ok);
  });
}

function markGuideSeen() {
  try { localStorage.setItem('attendance.guide', '1'); } catch (e) { /* 무시 */ }
}

function guideSeen() {
  try { return localStorage.getItem('attendance.guide') === '1'; } catch (e) { return true; }
}

/* ─────────────── 동작 ─────────────── */

function addAbsence(sid, date) {
  if (absenceOn(sid, date)) return;
  db.absences.push({ id: uid(), sid, date, makeup: null, time: '', deducted: false, memo: '' });
  save();
}

function startBulk() {
  if (ui.sid == null) {
    if (!db.students.length) { toast('학생을 먼저 추가하세요'); return; }
    openSheet('누구의 결석인가요?', body => {
      for (const s of students()) {
        body.append(option(s.name, null, null, () => {
          ui.sid = s.id; closeSheet(); renderStudents(); startBulk();
        }));
      }
    });
    return;
  }
  ui.pickFor = null;
  ui.bulk = true;
  ui.bulkCount = 0;
  $('#modeText').textContent = `${student(ui.sid).name} · 결석한 날짜를 누르세요`;
  $('#modeBar').hidden = false;
  switchView('calendar');
  renderCalendar();
}

/* 여러 날 등록 모드만 끈다 */
function stopBulk(silent) {
  const had = ui.bulk;
  ui.bulk = false;
  if (had) $('#modeBar').hidden = true;
  if (had && !silent) {
    toast(ui.bulkCount ? `${ui.bulkCount}일 등록했습니다` : '등록을 그만두었습니다');
  }
  ui.bulkCount = 0;
  if (had) renderCalendar();
}

/* 두 모드를 모두 끈다 (그만하기 버튼 · Esc) */
function cancelModes(silent) {
  const hadPick = !!ui.pickFor;
  ui.pickFor = null;
  stopBulk(silent);
  if (hadPick) {
    $('#modeBar').hidden = true;
    if (!silent) toast('보강일 지정을 그만두었습니다');
    renderCalendar();
  }
}

function shiftMonth(n) {
  let m = ui.month + n, y = ui.year;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  ui.month = m; ui.year = y;
  renderAll();
}

const VIEWS = ['calendar', 'summary', 'manage', 'settings'];

function switchView(v) {
  ui.view = v;
  for (const b of document.querySelectorAll('.tab')) {
    b.classList.toggle('is-on', b.dataset.view === v);
  }
  for (const name of VIEWS) {
    $('#view-' + name).hidden = name !== v;
  }

  /* 달·범례·학생 칩은 달력과 요약에서만 의미가 있다 */
  const dated = (v === 'calendar' || v === 'summary');
  document.body.classList.toggle('no-header', !dated);

  window.scrollTo(0, 0);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}


/* ─────────────── 인앱 브라우저 ─────────────── */

/* 카카오톡·라인·인스타 등의 앱 안 브라우저는 파일 내려받기를 제대로 처리하지 못한다.
   내려받은 것처럼 보여도 실제로는 저장되지 않아, 불러오기 목록에도 뜨지 않는다. */
function inAppBrowser() {
  const ua = navigator.userAgent || '';
  if (/KAKAOTALK/i.test(ua)) return '카카오톡';
  if (/NAVER\(inapp/i.test(ua) || /NAVER/i.test(ua) && /inapp/i.test(ua)) return '네이버';
  if (/Line\//i.test(ua)) return '라인';
  if (/Instagram/i.test(ua)) return '인스타그램';
  if (/FBAN|FBAV/i.test(ua)) return '페이스북';
  if (/DaumApps/i.test(ua)) return '다음';
  return null;
}


/* 클립보드 복사. 인앱 브라우저는 navigator.clipboard가 막혀 있어 대체 경로를 둔다. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) { /* 아래 대체 경로로 */ }

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

/* 내보내기 */
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  const pre = monthPrefix();
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [['이름', '결석수', '보강수', '미보강', '결석일', '보강일'].map(esc).join(',')];
  for (const s of students()) {
    const rows = db.absences.filter(a => a.sid === s.id);
    const abs = rows.filter(a => a.date.startsWith(pre)).sort((a, b) => a.date < b.date ? -1 : 1);
    const mk = rows.filter(a => a.makeup && a.makeup.startsWith(pre)).sort((a, b) => a.makeup < b.makeup ? -1 : 1);
    lines.push([
      s.name, abs.length, mk.length,
      abs.filter(a => !a.makeup && !a.deducted).length,
      abs.map(a => md(a.date)).join(' '),
      mk.map(a => md(a.makeup)).join(' ')
    ].map(esc).join(','));
  }
  download(`${ui.year}-${pad(ui.month)}_결석보강.csv`, '\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  toast('CSV를 저장했습니다');
}


/* 백업을 글자로 주고받는다 — 파일 내려받기가 막힌 환경용 */
function backupCopySheet() {
  const text = JSON.stringify(db);
  openSheet('백업 복사하기', body => {
    body.append(el('p', 'note',
      '아래 내용을 복사해 카카오톡 나에게 보내기나 메모장에 붙여넣어 두세요. ' +
      '복구할 때 이 글자를 그대로 붙여넣으면 됩니다.'));

    const ta = el('textarea', 'code-box');
    ta.value = text;
    ta.readOnly = true;
    body.append(ta);

    const btn = el('button', 'primary-btn', '복사하기');
    btn.onclick = async () => {
      const ok = await copyText(text);
      toast(ok ? '복사했습니다. 안전한 곳에 붙여넣어 두세요'
               : '복사가 막혀 있습니다. 위 내용을 길게 눌러 직접 복사하세요');
    };
    body.append(btn);
  });
}

function backupPasteSheet() {
  openSheet('백업 붙여넣기', body => {
    body.append(el('p', 'note', '복사해 둔 백업 글자를 아래에 붙여넣고 불러오기를 누르세요.'));

    const ta = el('textarea', 'code-box');
    ta.placeholder = '여기에 붙여넣기';
    body.append(ta);

    const btn = el('button', 'primary-btn', '불러오기');
    btn.onclick = () => {
      const raw = ta.value.trim();
      if (!raw) { toast('내용을 붙여넣으세요'); return; }
      applyBackup(raw);
    };
    body.append(btn);
    setTimeout(() => ta.focus(), 120);
  });
}

/* 파일과 붙여넣기가 함께 쓰는 복구 경로 */
function applyBackup(raw) {
  let p;
  try { p = JSON.parse(raw); }
  catch (e) { toast('백업 내용을 읽지 못했습니다'); return; }
  if (!p || !Array.isArray(p.students) || !Array.isArray(p.absences)) {
    toast('백업 형식이 맞지 않습니다'); return;
  }
  if (!confirm(`학생 ${p.students.length}명, 결석 ${p.absences.length}건을 불러옵니다.\n지금 기록은 사라집니다.`)) return;
  db = p;
  if (!db.calView) db.calView = 'both';   // 표시 설정이 없는 예전 백업 대비
  save(); ui.sid = null; closeSheet(); renderAll();
  toast('백업을 불러왔습니다');
}

function exportJson() {
  download(`결석보강_백업_${todayStr()}.json`, JSON.stringify(db, null, 2), 'application/json');
  toast('백업 파일을 저장했습니다');
}

function importJson(file) {
  const r = new FileReader();
  r.onload = () => applyBackup(String(r.result));
  r.onerror = () => toast('파일을 읽지 못했습니다');
  r.readAsText(file);
}

/* ─────────────── 시작 ─────────────── */

function init() {
  load();

  $('#prevMonth').onclick = () => shiftMonth(-1);
  $('#nextMonth').onclick = () => shiftMonth(1);
  $('#todayBtn').onclick = () => {
    const d = new Date();
    ui.year = d.getFullYear(); ui.month = d.getMonth() + 1; ui.selected = todayStr();
    renderAll();
  };
  $('#quickAbsence').onclick = startBulk;
  $('#modeCancel').onclick = () => cancelModes(false);
  $('#addStudent').onclick = () => studentSheet(null);
  $('#exportCsv').onclick = exportCsv;
  $('#exportJson').onclick = exportJson;
  $('#importJson').onclick = () => $('#importFile').click();
  $('#importFile').onchange = e => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; };
  for (const b of document.querySelectorAll('#calViewSeg button')) {
    b.onclick = () => {
      db.calView = b.dataset.v;
      save();
      renderCalViewSeg();
      renderCalendar();
      toast(b.textContent + '으로 표시합니다');
    };
  }
  $('#openGuide').onclick = guideSheet;
  $('#copyBackup').onclick = backupCopySheet;
  $('#pasteBackup').onclick = backupPasteSheet;
  $('#resetAll').onclick = () => {
    if (!confirm('학생과 결석 기록을 전부 지웁니다. 되돌릴 수 없습니다.')) return;
    db = { v: 1, students: [], absences: [] };
    save(); ui.sid = null; renderAll(); toast('전체 삭제했습니다');
  };

  $('#scrim').onclick = closeSheet;
  $('#sheetClose').onclick = closeSheet;
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#sheet').hidden) closeSheet();
    else if (ui.bulk || ui.pickFor) cancelModes(false);
  });

  for (const b of document.querySelectorAll('.tab')) {
    b.onclick = () => switchView(b.dataset.view);
  }

  if (!store.persistent) {
    toast('이 화면에서는 기록이 저장되지 않습니다');
  }

  const app = inAppBrowser();
  if (app) {
    $('#inAppWarn').hidden = false;
    $('#inAppName').textContent = app;

    const url = location.origin + location.pathname.replace(/index\.html$/, '');
    $('#appUrl').textContent = url.replace(/^https?:\/\//, '');
    $('#copyUrl').onclick = async () => {
      const ok = await copyText(url);
      toast(ok ? '주소를 복사했습니다. 크롬이나 사파리에 붙여넣으세요'
               : '복사가 막혀 있습니다. 주소를 길게 눌러 직접 복사하세요');
    };
  }

  renderAll();

  /* 처음 열었다면 사용법을 한 번 보여준다 */
  if (!guideSeen() && !db.students.length) {
    setTimeout(guideSheet, 400);
  }

  /* 홈 화면에 추가 */
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferred = e;
    $('#installPanel').hidden = false;
  });
  $('#installBtn').onclick = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    $('#installPanel').hidden = true;
  };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
