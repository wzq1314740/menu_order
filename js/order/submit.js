/* 确认清单、提交给前台、本桌已点 */
import { $, esc, toast, api, fmtTime, pad2, STATUS_TEXT } from '../common.js';
import * as overlay from '../overlay.js';
import { S, cartLines, counts, clearCart, onChange } from './store.js';
import { closeCart } from './cart.js';

const sheetModal = $('#sheetModal');
const sheetBox = $('#sheetBox');
const mineModal = $('#mineModal');
const mineBox = $('#mineBox');
const CLOSE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 5l14 14M19 5L5 19"/></svg>';

let guests = 0;
let note = '';
let clientId = '';
let sending = false;

/* 购物车变了就换一个提交编号；内容不变时重试沿用原编号，服务端据此去重 */
onChange(() => { if (!sending) clientId = ''; });

function newClientId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function catName(id) { return (S.catById[id] || {}).name || ''; }

function buildCopyText(lines) {
  let t = (S.meta.brand || '桂亭') + ' · ' + (S.table ? S.table.name : '') + '\n';
  t += '时间：' + new Date().toLocaleString('zh-CN', { hour12: false }) + '\n';
  if (guests) t += '人数：' + guests + ' 位\n';
  t += '————————————\n';
  let last = '';
  lines.forEach((l) => {
    const c = catName(l.dish.cat);
    if (c !== last) { t += '【' + c + '】\n'; last = c; }
    t += l.dish.name + (l.method ? '（' + l.method + '）' : '') + '  ×' + l.qty + '\n';
  });
  t += '————————————\n';
  const c = counts();
  t += '共 ' + c.kinds + ' 道，' + c.qty + ' 份\n';
  if (note) t += '备注：' + note + '\n';
  return t;
}

function copyText(text) {
  const done = () => toast('清单已复制，可交予服务员');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请直接向服务员口述', true); }
    ta.remove();
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
}

export function openSheet() {
  const lines = cartLines();
  if (!lines.length) return;
  if (!clientId) clientId = newClientId();
  renderSheet(lines, '');
  overlay.open(sheetModal);
}

function renderSheet(lines, err) {
  const c = counts();
  const rows = lines.map((l, i) =>
    '<div class="sheet-line"><span class="no">' + pad2(i + 1) + '</span>' +
      '<span class="nm">' + esc(l.dish.name) + (l.method ? '<span class="cm">' + esc(l.method) + '</span>' : '') +
        '<span class="rm">' + esc(catName(l.dish.cat)) + '</span></span>' +
      '<span class="q">× ' + l.qty + '</span></div>'
  ).join('');
  sheetBox.innerHTML =
    '<button class="icon-btn x" data-close aria-label="关闭">' + CLOSE_SVG + '</button>' +
    '<div class="cap">Confirm Order</div>' +
    '<h2>确认清单</h2>' +
    '<div class="sub">' + esc(S.table ? S.table.name : '') + ' · ' + c.kinds + ' 道 · ' + c.qty + ' 份</div>' +
    '<div class="list">' + rows + '</div>' +
    '<div class="form-row"><label>人数</label>' +
      '<div class="stepper"><button data-g="-1" aria-label="减少">−</button>' +
        '<span class="v" data-gv>' + (guests ? guests + ' 位' : '未填') + '</span>' +
        '<button data-g="1" aria-label="增加">+</button></div></div>' +
    '<div class="form-row"><label>备注</label>' +
      '<textarea class="inp" data-note maxlength="200" placeholder="忌口、上菜时间等（可不填）">' + esc(note) + '</textarea></div>' +
    (err ? '<div class="err-box">' + esc(err) + '</div>' : '') +
    '<p class="foot-note">提交后前台会收到这份清单，由服务员确认后正式下单。</p>' +
    '<div class="acts"><button class="btn-ghost" data-close>返回修改</button>' +
      '<button class="btn-solid" data-submit>提交给前台</button></div>' +
    '<button class="alt" data-copy>网络不通？复制清单交给服务员</button>';
}

async function submit(btn) {
  if (sending) return;
  const lines = cartLines();
  if (!lines.length || !S.table) return;
  sending = true;
  btn.disabled = true;
  btn.textContent = '提交中…';
  try {
    const res = await api('/api/orders', {
      method: 'POST',
      body: {
        table: S.table.id, guests, note, clientId,
        items: lines.map((l) => ({ id: l.id, name: l.dish.name, method: l.method, qty: l.qty })),
      },
    });
    clientId = '';
    note = '';
    clearCart();
    closeCart();
    renderSuccess(res.order);
  } catch (e) {
    renderSheet(lines, '提交失败：' + e.message);
  } finally {
    sending = false;
  }
}

function renderSuccess(o) {
  const qty = o.items.reduce((s, it) => s + it.qty, 0);
  sheetBox.innerHTML =
    '<button class="icon-btn x" data-close aria-label="关闭">' + CLOSE_SVG + '</button>' +
    '<div class="cap">Order Submitted</div>' +
    '<h2>已提交给前台</h2>' +
    '<div class="ok-no"><small>单号</small>' + esc(o.no) + '</div>' +
    '<div class="sub">' + esc(o.tableName) + ' · ' + o.items.length + ' 道 · ' + qty + ' 份 · ' + fmtTime(o.createdAt) + '</div>' +
    '<p class="foot-note">服务员会尽快与您确认。需要加菜时，继续选菜再提交即可。</p>' +
    '<div class="acts"><button class="btn-ghost" data-mine>本桌已点</button>' +
      '<button class="btn-solid" data-close>继续点菜</button></div>';
}

sheetBox.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { overlay.close(sheetModal); return; }
  const g = e.target.closest('[data-g]');
  if (g) {
    guests = Math.max(0, Math.min(99, guests + parseInt(g.dataset.g, 10)));
    sheetBox.querySelector('[data-gv]').textContent = guests ? guests + ' 位' : '未填';
    return;
  }
  const sb = e.target.closest('[data-submit]');
  if (sb) { submit(sb); return; }
  if (e.target.closest('[data-copy]')) { copyText(buildCopyText(cartLines())); return; }
  if (e.target.closest('[data-mine]')) { overlay.close(sheetModal); openMine(); }
});
sheetBox.addEventListener('input', (e) => {
  if (e.target.matches('[data-note]')) note = e.target.value;
});

/* ---------- 本桌已点 ---------- */
export async function openMine() {
  if (!S.table) return;
  mineBox.innerHTML = '<div class="cap">Ordered</div><h2>本桌已点</h2>' +
    '<div class="sub">' + esc(S.table.name) + ' · 今天</div><div class="empty"><p>载入中…</p></div>';
  overlay.open(mineModal);
  let orders = [];
  try {
    orders = (await api('/api/orders/mine?table=' + encodeURIComponent(S.table.id))).orders || [];
  } catch (e) {
    mineBox.querySelector('.empty').innerHTML = '<p>' + esc(e.message) + '</p>';
    return;
  }
  const valid = orders.filter((o) => o.status !== 'cancelled');
  const total = valid.reduce((s, o) => s + o.items.reduce((a, it) => a + it.qty, 0), 0);
  let html = '<button class="icon-btn x" data-close aria-label="关闭">' + CLOSE_SVG + '</button>' +
    '<div class="cap">Ordered</div><h2>本桌已点</h2>' +
    '<div class="sub">' + esc(S.table.name) + ' · 今天 ' + valid.length + ' 次提交 · 共 ' + total + ' 份</div>';
  if (!orders.length) {
    html += '<div class="empty"><img class="mk" src="images/emblem-gold.png" alt=""><p>今天还没有提交过订单</p></div>';
  } else {
    html += '<div class="list" style="max-height:56dvh;border-top:none">';
    orders.slice().reverse().forEach((o) => {
      html += '<div class="mine-order"><div class="mo-h"><b>单号 ' + esc(o.no) + '</b><span>' + fmtTime(o.createdAt) + '</span>' +
        '<span class="st st-' + o.status + '">' + STATUS_TEXT[o.status] + '</span></div><ul>' +
        o.items.map((it) => '<li><span>' + esc(it.name) + (it.method ? ' <span class="cm">' + esc(it.method) + '</span>' : '') +
          '</span><span class="q">× ' + it.qty + '</span></li>').join('') + '</ul>' +
        (o.note ? '<div class="mo-note">备注：' + esc(o.note) + '</div>' : '') + '</div>';
    });
    html += '</div>';
  }
  html += '<div class="acts"><button class="btn-solid" data-close>知道了</button></div>';
  mineBox.innerHTML = html;
}
mineBox.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) overlay.close(mineModal);
});
