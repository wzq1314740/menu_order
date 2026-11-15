/* 菜品详情弹窗 */
import { $, esc, imgSrc, priceHTML, toast } from '../common.js';
import * as overlay from '../overlay.js';
import { S, dishHasMethods, dishRealImg, perDish, addItem } from './store.js';
import { openCook } from './cook.js';

const modal = $('#dishModal');
const box = $('#dishBox');
let qty = 1;

const CLOSE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 5l14 14M19 5L5 19"/></svg>';

export function openDish(id) {
  const d = S.byId[id];
  if (!d) return;
  const hasM = dishHasMethods(d);
  const realImg = dishRealImg(d);
  const cat = S.catById[d.cat] || { name: '' };
  const inCart = perDish()[d.id] || 0;
  qty = 1;
  box.classList.toggle('no-pic', !realImg);
  box.innerHTML =
    (realImg ? '<div class="pic"><img src="' + esc(imgSrc(realImg)) + '" alt="' + esc(d.name) + '"></div>' : '') +
    '<div class="body">' +
      '<button class="icon-btn x" data-close aria-label="关闭">' + CLOSE_SVG + '</button>' +
      '<div class="cat">' + esc(cat.name) + (cat.en ? ' · ' + esc(cat.en) : '') + '</div>' +
      '<h2>' + esc(d.name) + '</h2>' +
      (d.en ? '<div class="en">' + esc(d.en) + '</div>' : '') +
      (d.desc ? '<p class="desc">' + esc(d.desc) + '</p>' : '') +
      (hasM ? '<p class="methods">可选做法：' + esc(d.cookMethods.join(' / ')) + '</p>' : '') +
      '<div class="price"><span class="pr">' + priceHTML(d) + '</span>' +
        (inCart ? '<div class="in-cart-note">清单中已有 ' + inCart + ' 份</div>' : '') + '</div>' +
      (hasM
        ? '<div class="acts"><button class="btn-solid" data-cook>选择做法</button></div>'
        : '<div class="acts">' +
            '<div class="stepper"><button data-mq="-1" aria-label="减少">−</button>' +
              '<span class="v" data-qv>1</span><button data-mq="1" aria-label="增加">+</button></div>' +
            '<button class="btn-solid" data-madd>加入预选</button>' +
          '</div>') +
    '</div>';
  box.dataset.id = d.id;
  overlay.open(modal);
}

box.addEventListener('click', (e) => {
  const d = S.byId[box.dataset.id];
  if (!d) return;
  if (e.target.closest('[data-close]')) { overlay.close(modal); return; }
  if (e.target.closest('[data-cook]')) { overlay.close(modal); openCook(d.id); return; }
  const mq = e.target.closest('[data-mq]');
  if (mq) {
    qty = Math.max(1, Math.min(99, qty + parseInt(mq.dataset.mq, 10)));
    box.querySelector('[data-qv]').textContent = qty;
    return;
  }
  if (e.target.closest('[data-madd]')) {
    addItem(d.id, qty);
    toast('已加入「' + d.name + '」× ' + qty);
    overlay.close(modal);
  }
});
