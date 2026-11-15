/* 做法选择弹窗（一菜多做）：每种做法单独计数 */
import { $, esc, toast } from '../common.js';
import * as overlay from '../overlay.js';
import { S, dishHasMethods, keyOf, addItem, onChange } from './store.js';

const modal = $('#cookModal');
const list = $('#cookList');
let dish = null;

export function openCook(id) {
  const d = S.byId[id];
  if (!dishHasMethods(d)) return;
  dish = d;
  $('#cookTitle').textContent = d.name;
  render();
  overlay.open(modal, { onClose: () => { dish = null; } });
}

function render() {
  if (!dish) return;
  list.innerHTML = dish.cookMethods.map((m) => {
    const q = S.cart[keyOf(dish.id, m)] || 0;
    return '<div class="cook-line"><span class="nm">' + esc(m) + '</span><span class="dots"></span>' +
      (q > 0
        ? '<div class="stepper"><button data-cm="' + esc(m) + '" data-n="-1" aria-label="减少">−</button>' +
            '<span class="v">' + q + '</span><button data-cm="' + esc(m) + '" data-n="1" aria-label="增加">+</button></div>'
        : '<button class="cook-add" data-cm="' + esc(m) + '" data-n="1" aria-label="加入预选">+</button>') +
    '</div>';
  }).join('');
}

list.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cm]');
  if (!b || !dish) return;
  const m = b.dataset.cm, n = parseInt(b.dataset.n, 10);
  const before = S.cart[keyOf(dish.id, m)] || 0;
  addItem(keyOf(dish.id, m), n);
  if (n > 0 && before === 0) toast('已加入「' + dish.name + ' · ' + m + '」');
});

$('#cookClose').addEventListener('click', () => overlay.close(modal));
$('#cookDone').addEventListener('click', () => overlay.close(modal));
onChange(() => { if (overlay.isOpen(modal)) render(); });
