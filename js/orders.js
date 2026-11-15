/* 桂亭 · 订单看板 */
import { $, $$, esc, api, toast, fmtTime, localDate, logout, STATUS_TEXT } from './common.js';

const POLL_MS = 3000;
const board = $('#board');

const st = {
  date: localDate(),
  followToday: true,     // 停留在“今天”时，过了零点自动切到新的一天
  orders: {},            // id -> order
  since: 0,
  loaded: false,
  status: 'active',
  table: '',
  view: 'orders',
  fresh: new Set(),
  tables: [],
};

/* ---------- 提示音 ---------- */
const SOUND_KEY = 'mo_sound';
let audioCtx = null;
let soundOn = localStorage.getItem(SOUND_KEY) === '1';

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function beep() {
  if (!soundOn) return;
  const ctx = ensureAudio();
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  [[880, 0], [1175, 0.18], [880, 0.5], [1175, 0.68]].forEach(([f, dt]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + dt);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + dt);
    o.stop(t0 + dt + 0.18);
  });
}

function syncSoundBtn() {
  const running = audioCtx && audioCtx.state === 'running';
  const b = $('#soundBtn');
  b.classList.toggle('on', soundOn && !!running);
  b.textContent = soundOn ? (running ? '提醒已开启' : '点此激活提醒') : '开启提醒';
}

$('#soundBtn').addEventListener('click', () => {
  const running = audioCtx && audioCtx.state === 'running';
  if (soundOn && running) {
    soundOn = false;
  } else {
    soundOn = true;
    ensureAudio();
    setTimeout(() => { beep(); syncSoundBtn(); }, 120);
  }
  localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0');
  syncSoundBtn();
});
/* 浏览器要求先有一次点击才允许出声 */
document.addEventListener('pointerdown', () => {
  if (soundOn && (!audioCtx || audioCtx.state !== 'running')) { ensureAudio(); setTimeout(syncSoundBtn, 150); }
}, { capture: true });

/* ---------- 数据 ---------- */
let gen = 0;   // 切换日期后丢弃旧请求的结果

async function poll() {
  const g = gen;
  try {
    const url = '/api/orders?date=' + st.date + (st.loaded ? '&since=' + st.since : '');
    const res = await api(url, { auth: true });
    if (g !== gen) return;
    $('#conn').hidden = true;
    if (st.followToday && res.today !== st.date) {
      switchDate(res.today, true);
      return;
    }
    let hasNew = false;
    res.orders.forEach((o) => {
      const isNew = !st.orders[o.id];
      st.orders[o.id] = o;
      if (st.loaded && isNew && o.status === 'new') {
        st.fresh.add(o.id);
        hasNew = true;
      }
    });
    st.since = res.now;
    const first = !st.loaded;
    st.loaded = true;
    if (first || res.orders.length) render();
    if (hasNew) {
      beep();
      toast('有新订单');
    }
  } catch (e) {
    if (e.status !== 401) $('#conn').hidden = false;
  }
}

let timer = null;
function loop() {
  clearTimeout(timer);
  const g = gen;
  poll().finally(() => { if (g === gen) timer = setTimeout(loop, POLL_MS); });
}

function switchDate(date, follow) {
  gen++;
  st.date = date;
  st.followToday = follow;
  st.orders = {};
  st.since = 0;
  st.loaded = false;
  st.fresh.clear();
  $('#dateInput').value = date;
  board.innerHTML = '<div class="empty"><p>载入中…</p></div>';
  loop();
}

async function setStatus(id, status, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await api('/api/orders/' + encodeURIComponent(id), { method: 'PATCH', body: { status }, auth: true });
    st.orders[id] = res.order;
    st.fresh.delete(id);
    render();
    toast('单号 ' + res.order.no + ' ' + STATUS_TEXT[status]);
  } catch (e) {
    toast(e.message, true);
    if (btn) btn.disabled = false;
  }
}

/* ---------- 渲染 ---------- */
function matchStatus(o) {
  if (st.status === 'all') return true;
  if (st.status === 'active') return o.status === 'new' || o.status === 'confirmed';
  return o.status === st.status;
}

function itemsHTML(items) {
  let html = '', last = null;
  items.forEach((it) => {
    if (it.catName !== last) {
      last = it.catName;
      html += '<div class="c-cat">' + esc(it.catName || '其他') + '</div>';
    }
    html += '<div class="c-it"><span class="nm">' + esc(it.name) +
      (it.method ? '<span class="cm">' + esc(it.method) + '</span>' : '') + '</span>' +
      '<span class="q">× ' + it.qty + '</span></div>';
  });
  return html;
}

function actionsHTML(o) {
  const id = esc(o.id);
  const pr = '<button class="mini" data-print="' + id + '">打印</button>';
  if (o.status === 'new') {
    return '<button class="pri" data-act="confirmed" data-id="' + id + '">确认</button>' + pr +
      '<button class="warn" data-act="cancelled" data-id="' + id + '">取消</button>';
  }
  if (o.status === 'confirmed') {
    return '<button class="pri" data-act="done" data-id="' + id + '">完成</button>' + pr +
      '<button class="warn" data-act="cancelled" data-id="' + id + '">取消</button>';
  }
  if (o.status === 'cancelled') {
    return '<button data-act="new" data-id="' + id + '">恢复为新单</button>';
  }
  return pr + '<button data-act="confirmed" data-id="' + id + '">退回已确认</button>';
}

function orderCard(o) {
  const qty = o.items.reduce((s, it) => s + it.qty, 0);
  return '<article class="card s-' + o.status + (st.fresh.has(o.id) ? ' fresh' : '') + '" data-card="' + esc(o.id) + '">' +
    '<div class="c-head"><span class="c-table">' + esc(o.tableName) + '</span>' +
      (o.area ? '<span class="c-area">' + esc(o.area) + '</span>' : '') +
      '<span class="st st-' + o.status + '">' + STATUS_TEXT[o.status] + '</span></div>' +
    '<div class="c-meta"><span>单号 <b>' + esc(o.no) + '</b></span><span>' + fmtTime(o.createdAt) + '</span>' +
      (o.guests ? '<span>' + o.guests + ' 位</span>' : '') +
      '<span>' + o.items.length + ' 道 · ' + qty + ' 份</span></div>' +
    '<div class="c-items">' + itemsHTML(o.items) + '</div>' +
    (o.note ? '<div class="c-note">备注：' + esc(o.note) + '</div>' : '') +
    '<div class="c-foot">' + actionsHTML(o) + '</div>' +
  '</article>';
}

function tableCard(t) {
  const merged = {};
  const order = [];
  t.orders.forEach((o) => o.items.forEach((it) => {
    const k = it.id + '::' + it.method;
    if (!merged[k]) { merged[k] = Object.assign({}, it, { qty: 0 }); order.push(k); }
    merged[k].qty += it.qty;
  }));
  const items = order.map((k) => merged[k]);
  const catOrder = {};
  items.forEach((it) => { if (!(it.catName in catOrder)) catOrder[it.catName] = Object.keys(catOrder).length; });
  items.sort((a, b) => catOrder[a.catName] - catOrder[b.catName]);
  const qty = items.reduce((s, it) => s + it.qty, 0);
  const cnt = {};
  t.orders.forEach((o) => { cnt[o.status] = (cnt[o.status] || 0) + 1; });
  const latest = Math.max.apply(null, t.orders.map((o) => o.createdAt));
  const notes = t.orders.filter((o) => o.note).map((o) => o.no + '：' + o.note);
  return '<article class="card' + (cnt.new ? ' s-new' : '') + '">' +
    '<div class="c-head"><span class="c-table">' + esc(t.name) + '</span>' +
      (t.area ? '<span class="c-area">' + esc(t.area) + '</span>' : '') +
      (cnt.new ? '<span class="st st-new">' + cnt.new + ' 张新单</span>' : '') + '</div>' +
    '<div class="c-meta"><span><b>' + t.orders.length + '</b> 次提交</span><span>最近 ' + fmtTime(latest) + '</span>' +
      '<span>' + items.length + ' 道 · ' + qty + ' 份</span></div>' +
    '<div class="c-sum">单号 ' + t.orders.map((o) => esc(o.no) + '（' + STATUS_TEXT[o.status] + '）').join('、') + '</div>' +
    '<div class="c-items">' + itemsHTML(items) + '</div>' +
    (notes.length ? '<div class="c-note">' + notes.map(esc).join('<br>') + '</div>' : '') +
  '</article>';
}

function render() {
  const all = Object.values(st.orders).sort((a, b) => b.createdAt - a.createdAt);

  const count = { active: 0, new: 0, confirmed: 0, done: 0, cancelled: 0, all: all.length };
  all.forEach((o) => {
    count[o.status]++;
    if (o.status === 'new' || o.status === 'confirmed') count.active++;
  });
  $$('#statusTabs button').forEach((b) => {
    const em = b.querySelector('em');
    em.textContent = count[b.dataset.st] || '';
    em.classList.toggle('hot', b.dataset.st === 'new' && count.new > 0);
  });
  document.title = (count.new ? '(' + count.new + ') ' : '') + '订单看板 · ' + (st.storeName || '桂亭');

  /* 桌号筛选：门店设置的桌号 + 订单里出现过的桌号 */
  const sel = $('#tableFilter');
  const known = new Map(st.tables.map((t) => [t.id, t.name]));
  all.forEach((o) => { if (!known.has(o.table)) known.set(o.table, o.tableName); });
  const opts = '<option value="">全部桌号</option>' +
    Array.from(known).map(([id, name]) => '<option value="' + esc(id) + '"' + (id === st.table ? ' selected' : '') + '>' + esc(name) + '</option>').join('');
  if (sel.dataset.sig !== opts) { sel.innerHTML = opts; sel.dataset.sig = opts; }

  const list = all.filter((o) => matchStatus(o) && (!st.table || o.table === st.table));
  if (!list.length) {
    const isToday = st.date === localDate();
    board.innerHTML = '<div class="empty"><img class="mk" src="images/emblem-gold.png" alt="">' +
      '<p>' + (all.length ? '没有符合条件的订单' : (isToday ? '今天还没有订单<br>新订单会自动出现并响铃提醒' : '这一天没有订单')) + '</p></div>';
    return;
  }
  if (st.view === 'tables') {
    const groups = new Map();
    list.filter((o) => o.status !== 'cancelled').forEach((o) => {
      if (!groups.has(o.table)) groups.set(o.table, { name: o.tableName, area: o.area, orders: [] });
      groups.get(o.table).orders.push(o);
    });
    board.innerHTML = groups.size ? Array.from(groups.values()).map(tableCard).join('')
      : '<div class="empty"><p>没有符合条件的订单</p></div>';
  } else {
    board.innerHTML = list.map(orderCard).join('');
  }
}

/* ---------- 打印 ---------- */
function printOrder(o) {
  const pa = $('#printArea');
  pa.innerHTML = '<h1>' + esc(o.tableName) + ' · 单号 ' + esc(o.no) + '</h1>' +
    '<div class="pm">' + esc(st.storeName || '') + ' · ' + fmtTime(o.createdAt, true) + (o.guests ? ' · ' + o.guests + ' 位' : '') + '</div>' +
    '<table>' + o.items.map((it) => '<tr><td>' + esc(it.name) + (it.method ? '（' + esc(it.method) + '）' : '') +
      '</td><td class="q">× ' + it.qty + '</td></tr>').join('') + '</table>' +
    (o.note ? '<div class="pn">备注：' + esc(o.note) + '</div>' : '');
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1000);
}

/* ---------- 交互 ---------- */
board.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act) {
    const o = st.orders[act.dataset.id];
    if (act.dataset.act === 'cancelled' && !confirm('确定取消 ' + o.tableName + ' 的单号 ' + o.no + '？')) return;
    setStatus(act.dataset.id, act.dataset.act, act);
    return;
  }
  const pr = e.target.closest('[data-print]');
  if (pr) { printOrder(st.orders[pr.dataset.print]); return; }
  const card = e.target.closest('[data-card]');
  if (card && st.fresh.delete(card.dataset.card)) card.classList.remove('fresh');
});

$('#statusTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-st]');
  if (!b) return;
  st.status = b.dataset.st;
  $$('#statusTabs button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});
$('#viewSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  st.view = b.dataset.view;
  $$('#viewSeg button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});
$('#tableFilter').addEventListener('change', (e) => { st.table = e.target.value; render(); });
$('#dateInput').addEventListener('change', (e) => {
  const d = e.target.value || localDate();
  switchDate(d, d === localDate());
});
$('#logoutBtn').addEventListener('click', logout);

async function init() {
  $('#dateInput').value = st.date;
  $('#dateInput').max = localDate();
  syncSoundBtn();
  try {
    const me = await api('/api/me');
    $('#adminLink').hidden = me.role !== 'admin';
  } catch (e) { /* 忽略 */ }
  try {
    const m = await api('/api/menu');
    st.tables = (m.meta && m.meta.tables) || [];
    st.storeName = (m.meta && (m.meta.store || m.meta.brand)) || '桂亭';
    $('#storeName').textContent = st.storeName;
  } catch (e) { /* 忽略 */ }
  loop();
}
init();
