/* 预选清单抽屉、侧栏和底部条上的数量 */
import { $, $$, esc, priceHTML, toast } from '../common.js';
import * as overlay from '../overlay.js';
import { S, cartLines, counts, countText, addItem, clearCart, onChange } from './store.js';

const drawer = $('#drawer');
const body = $('#drawerBody');

export function syncBadges() {
  const c = counts();
  const t = countText();
  $$('[data-cart-badge]').forEach((el) => { el.textContent = c.qty; });
  $$('[data-cart-sub]').forEach((el) => { el.textContent = t; });
  $('#drawerSub').textContent = (S.table ? S.table.name + ' · ' : '') + t;
  $('#sumText').textContent = c.kinds === 0 ? '共 0 道' : '共 ' + c.kinds + ' 道 · ' + c.qty + ' 份';
  $('#confirmBtn').disabled = c.kinds === 0;
  $('#clearCart').disabled = c.kinds === 0;
}

export function renderDrawer() {
  const lines = cartLines();
  if (!lines.length) {
    body.innerHTML = '<div class="empty"><img class="mk" src="images/emblem-gold.png" alt="">' +
      '<p>尚未选菜<br>浏览菜单，轻点 ＋ 加入预选</p></div>';
    return;
  }
  let out = '', lastCat = null;
  lines.forEach((l) => {
    if (l.dish.cat !== lastCat) {
      if (lastCat !== null) out += '</div>';
      lastCat = l.dish.cat;
      out += '<div class="grp"><h4>' + esc((S.catById[l.dish.cat] || {}).name || '其他') + '</h4>';
    }
    out += '<div class="line">' +
      '<div><div class="nm">' + esc(l.dish.name) + (l.method ? '<span class="cm">' + esc(l.method) + '</span>' : '') + '</div>' +
        '<div class="mt">' + priceHTML(l.dish) + '</div></div>' +
      '<div class="sp"></div>' +
      '<div class="stepper"><button data-step="-1" data-key="' + esc(l.key) + '" aria-label="减少">−</button>' +
        '<span class="v">' + l.qty + '</span>' +
        '<button data-step="1" data-key="' + esc(l.key) + '" aria-label="增加">+</button></div>' +
    '</div>';
  });
  body.innerHTML = out + '</div>';
}

body.addEventListener('click', (e) => {
  const b = e.target.closest('[data-step]');
  if (b) addItem(b.dataset.key, parseInt(b.dataset.step, 10));
});

export function openCart() {
  renderDrawer();
  overlay.open(drawer);
}
export function closeCart() { overlay.close(drawer); }

$('#drawerClose').addEventListener('click', closeCart);
$('#clearCart').addEventListener('click', () => {
  if (!counts().kinds) return;
  if (!confirm('确定清空预选清单？')) return;
  clearCart();
  toast('清单已清空');
});

onChange(() => {
  syncBadges();
  if (overlay.isOpen(drawer)) renderDrawer();
});
