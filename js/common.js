/* 桂亭 · 公共函数 */

export const $ = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* 数据里可只写文件名，自动补 images/ 前缀 */
export function imgSrc(p) {
  if (!p) return 'images/emblem-gold.png';
  if (/^(https?:|data:|blob:|images\/|\/)/.test(p)) return p;
  return 'images/' + p;
}

export function isMarketPrice(d) {
  return d.price === '时价' || d.price == null || d.price === '';
}

export function priceHTML(d) {
  if (isMarketPrice(d)) return '<span class="mkt">时价</span>';
  let s = '¥' + esc(d.price) + '<span class="u">/ ' + esc(d.unit || '') + '</span>';
  if (d.price2 != null && d.price2 !== '') {
    s += ' <span class="u">· ' + esc(d.unit2 || '') + ' ¥' + esc(d.price2) + '</span>';
  }
  return s;
}

export function priceText(d) {
  if (isMarketPrice(d)) return '时价';
  let s = '¥' + d.price + '/' + (d.unit || '');
  if (d.price2 != null && d.price2 !== '') s += ' · ' + (d.unit2 || '') + ' ¥' + d.price2;
  return s;
}

export function pad2(n) { return String(n).padStart(2, '0'); }

export function fmtTime(ms, withDate) {
  const d = new Date(ms);
  const t = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  return withDate ? (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + t : t;
}

export function localDate(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export const STATUS_TEXT = { new: '新单', confirmed: '已确认', done: '已完成', cancelled: '已取消' };

let toastEl = null, toastTimer = null;
export function toast(msg, isErr) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.toggle('err', !!isErr);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), isErr ? 3200 : 1900);
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* 请求后端接口。需要登录的接口返回 401 时跳到登录页 */
export async function api(path, opts) {
  opts = opts || {};
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin', cache: 'no-store' };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new ApiError(0, '网络连接失败，请确认已连上店内 WiFi');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    if (res.status === 401 && opts.auth) {
      location.href = '/login.html?next=' + encodeURIComponent(location.pathname);
    }
    throw new ApiError(res.status, (data && data.error) || ('请求失败（' + res.status + '）'));
  }
  return data;
}

export async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* 忽略 */ }
  location.href = '/login.html';
}
