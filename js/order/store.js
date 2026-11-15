/* 点餐页数据：菜单、当前桌号、购物车（按桌分开保存在本机） */
import { api } from '../common.js';

export const S = {
  version: 0,
  meta: {},
  cats: [],
  dishes: [],
  byId: {},
  catById: {},
  order: {},      // 菜品 id -> 菜单中的顺序，用于清单排序
  table: null,
  cart: {},       // 购物车键 -> 份数；键 = 菜id 或 菜id::做法
};

const TABLE_KEY = 'mo_table';
const listeners = [];

export function onChange(fn) { listeners.push(fn); }
function emit() { listeners.forEach((fn) => fn()); }

export function dishHasMethods(d) {
  return !!(d && d.cookMethods && d.cookMethods.length);
}

/* 无实拍图（为空或指向占位底图）的菜品归入分类下方的纯文字清单 */
export function dishRealImg(d) {
  if (!d || !d.img) return '';
  const p = String(d.img);
  if (/_green\//.test(p) || /placeholder/i.test(p)) return '';
  return p;
}

export const keyOf = (id, method) => (method ? id + '::' + method : id);
export function splitKey(k) {
  const i = String(k).indexOf('::');
  return i < 0 ? { id: k, method: '' } : { id: k.slice(0, i), method: k.slice(i + 2) };
}

/* ---------- 菜单 ---------- */
export async function fetchMenu() {
  return api('/api/menu');
}

export function applyMenu(m) {
  S.version = m.version || 0;
  S.meta = m.meta || {};
  S.cats = m.categories || [];
  S.dishes = m.dishes || [];
  S.byId = {};
  S.order = {};
  S.dishes.forEach((d, i) => { S.byId[d.id] = d; S.order[d.id] = i; });
  S.catById = {};
  S.cats.forEach((c) => { S.catById[c.id] = c; });
  if (S.table) {
    S.table = findTable(S.table.id);
    pruneCart();
  }
}

/* ---------- 桌号 ---------- */
export function tables() { return S.meta.tables || []; }
export function findTable(id) { return tables().find((t) => t.id === id) || null; }
export function savedTableId() {
  try { return localStorage.getItem(TABLE_KEY) || ''; } catch (e) { return ''; }
}

export function setTable(t) {
  S.table = t;
  try { localStorage.setItem(TABLE_KEY, t.id); } catch (e) { /* 隐私模式 */ }
  S.cart = readCart();
  pruneCart();
  emit();
}

/* ---------- 购物车 ---------- */
function cartStoreKey() { return 'mo_cart_' + (S.table ? S.table.id : 'none'); }

function readCart() {
  try { return JSON.parse(localStorage.getItem(cartStoreKey()) || '{}') || {}; } catch (e) { return {}; }
}
function saveCart() {
  try { localStorage.setItem(cartStoreKey(), JSON.stringify(S.cart)); } catch (e) { /* 隐私模式 */ }
}

/* 菜单变化后，去掉已下架的菜和已取消的做法 */
export function pruneCart() {
  let changed = false;
  Object.keys(S.cart).forEach((k) => {
    const p = splitKey(k), d = S.byId[p.id];
    const bad = !(S.cart[k] > 0) || !d || (p.method && (d.cookMethods || []).indexOf(p.method) < 0);
    if (bad) { delete S.cart[k]; changed = true; }
  });
  if (changed) saveCart();
}

export function addItem(key, n) {
  const q = Math.min(99, (S.cart[key] || 0) + n);
  if (q <= 0) delete S.cart[key]; else S.cart[key] = q;
  saveCart();
  emit();
}

export function clearCart() {
  S.cart = {};
  saveCart();
  emit();
}

export function refresh() { emit(); }

export function cartLines() {
  const lines = [];
  Object.keys(S.cart).forEach((k) => {
    if (!(S.cart[k] > 0)) return;
    const p = splitKey(k), d = S.byId[p.id];
    if (!d) return;
    lines.push({ key: k, id: p.id, method: p.method, dish: d, qty: S.cart[k] });
  });
  const catIdx = {};
  S.cats.forEach((c, i) => { catIdx[c.id] = i; });
  lines.sort((a, b) => {
    const dc = (catIdx[a.dish.cat] ?? 99) - (catIdx[b.dish.cat] ?? 99);
    if (dc) return dc;
    const dd = (S.order[a.id] || 0) - (S.order[b.id] || 0);
    if (dd) return dd;
    const ma = (a.dish.cookMethods || []).indexOf(a.method);
    const mb = (b.dish.cookMethods || []).indexOf(b.method);
    return (ma < 0 ? 99 : ma) - (mb < 0 ? 99 : mb);
  });
  return lines;
}

export function counts() {
  let kinds = 0, qty = 0;
  Object.keys(S.cart).forEach((k) => { if (S.cart[k] > 0) { kinds++; qty += S.cart[k]; } });
  return { kinds, qty };
}

/* 每道菜已选份数（合计所有做法） */
export function perDish() {
  const per = {};
  Object.keys(S.cart).forEach((k) => {
    const p = splitKey(k);
    if (S.cart[k] > 0) per[p.id] = (per[p.id] || 0) + S.cart[k];
  });
  return per;
}

export function countText() {
  const c = counts();
  return c.kinds === 0 ? '尚未选菜' : '共 ' + c.kinds + ' 道 · ' + c.qty + ' 份';
}
