/* 菜单渲染：侧栏分类、手机顶部分类标签、菜品卡片、滚动联动 */
import { $, $$, esc, imgSrc, priceHTML, pad2 } from '../common.js';
import { S, dishHasMethods, dishRealImg, perDish } from './store.js';

const scrollEl = $('#scroll');
let sections = [];
let activeId = '';

export function renderBrand() {
  const m = S.meta;
  $('#brandName').textContent = m.brand || '桂亭';
  $('#brandEn').textContent = m.brandEn || '';
  $('#brandSub').textContent = m.brandSub || '';
  $('#roomName').textContent = m.room || '包厢预选菜单';
  $('#storeName').textContent = m.store || m.brand || '';
  $('#noteText').textContent = m.note || '本菜单仅作预选，最终以服务员确认为准';
  $('#tpBrand').textContent = m.brand || '桂亭';
  $('#tpBrandEn').textContent = m.brandEn || '';
  document.title = (m.brand || '桂亭') + ' · ' + (m.room || '点餐');
}

function dishesOf(catId) {
  return S.dishes.filter((d) => d.cat === catId);
}

function cardHTML(d) {
  const hasM = dishHasMethods(d);
  return '<div class="dish' + (hasM ? ' has-method' : '') + '" data-id="' + esc(d.id) + '">' +
    '<div class="thumb"><img src="' + esc(imgSrc(dishRealImg(d))) + '" alt="' + esc(d.name) + '" loading="lazy" decoding="async"></div>' +
    '<div class="info">' +
      '<div class="row1"><span class="nm">' + esc(d.name) + '</span><span class="pr">' + priceHTML(d) + '</span></div>' +
      (d.en ? '<div class="en">' + esc(d.en) + '</div>' : '') +
      (d.desc ? '<div class="ds">' + esc(d.desc) + '</div>' : '') +
    '</div>' +
    (hasM
      ? '<button class="method-btn" data-method="' + esc(d.id) + '" aria-label="选择做法">' +
          '<span class="cm-t">做法选择</span><span class="cm-n"></span></button>'
      : '<span class="qty-pill"></span>' +
        '<button class="add" data-add="' + esc(d.id) + '" aria-label="加入预选">+</button>') +
  '</div>';
}

function rowHTML(d) {
  const hasM = dishHasMethods(d);
  return '<div class="tl-row" data-id="' + esc(d.id) + '">' +
    '<div class="tl-main"><div class="nm">' + esc(d.name) +
      (hasM ? '<span class="tag-m">做法可选</span>' : '') + '</div></div>' +
    '<span class="pr">' + priceHTML(d) + '</span>' +
    '<span class="tl-q"></span>' +
    '<button class="tl-add" data-add="' + esc(d.id) + '" aria-label="加入预选">+</button>' +
  '</div>';
}

export function renderMenu() {
  const cats = S.cats.filter((c) => dishesOf(c.id).length);

  $('#nav').innerHTML = cats.map((c, i) =>
    '<button class="nav-item" data-target="cat-' + esc(c.id) + '">' +
      '<span class="idx">' + pad2(i + 1) + '</span>' +
      '<span class="nm">' + esc(c.name) + '</span>' +
      '<span class="cnt">' + dishesOf(c.id).length + '</span></button>'
  ).join('');
  $('#catTabs').innerHTML = cats.map((c) =>
    '<button class="cat-tab" data-target="cat-' + esc(c.id) + '">' + esc(c.name) + '</button>'
  ).join('');

  let html = '';
  cats.forEach((c, ci) => {
    const list = dishesOf(c.id);
    /* 有实拍图 → 卡片，排在前面；无实拍图 → 下方纯文字清单 */
    const cards = list.filter((d) => !!dishRealImg(d));
    const texts = list.filter((d) => !dishRealImg(d));
    html += '<section class="cat-sec" id="cat-' + esc(c.id) + '">' +
      '<div class="cat-head"><span class="num">' + pad2(ci + 1) + '</span>' +
      '<h2>' + esc(c.name) + '</h2><span class="en">' + esc(c.en || '') + '</span></div>';
    if (cards.length) html += '<div class="grid">' + cards.map(cardHTML).join('') + '</div>';
    if (texts.length) {
      html += '<div class="tlist">' +
        (cards.length ? '<div class="tl-head"><span class="t">其他菜品</span><span class="e">More</span></div>' : '') +
        texts.map(rowHTML).join('') + '</div>';
    }
    html += '</section>';
  });
  if (!cats.length) {
    html = '<div class="empty"><img class="mk" src="images/emblem-gold.png" alt=""><p>菜单暂无菜品</p></div>';
  }
  const top = scrollEl.scrollTop;
  scrollEl.innerHTML = html;
  scrollEl.scrollTop = top;
  sections = $$('.cat-sec', scrollEl);
  activeId = '';
  syncDishCounts();
  onScroll();
}

/* 卡片、清单上的“已选 N” */
export function syncDishCounts() {
  const per = perDish();
  $$('.dish', scrollEl).forEach((el) => {
    const q = per[el.dataset.id] || 0;
    el.classList.toggle('in-cart', q > 0);
    const pill = el.querySelector('.qty-pill');
    if (pill) pill.textContent = q > 0 ? '已选 ' + q : '';
    const cn = el.querySelector('.cm-n');
    if (cn) cn.textContent = q > 0 ? '· 已选 ' + q : '';
  });
  $$('.tl-row', scrollEl).forEach((el) => {
    const q = per[el.dataset.id] || 0;
    el.classList.toggle('in-cart', q > 0);
    el.querySelector('.tl-q').textContent = q > 0 ? '已选 ' + q : '';
  });
}

/* ---------- 分类跳转和滚动联动 ---------- */
function jumpTo(target) {
  const sec = document.getElementById(target);
  if (sec) scrollEl.scrollTo({ top: sec.offsetTop, behavior: 'smooth' });
}
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-target]');
  if (b) jumpTo(b.dataset.target);
});
$('#catTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-target]');
  if (b) jumpTo(b.dataset.target);
});

function setActive(id) {
  if (id === activeId) return;
  activeId = id;
  $$('.nav-item, .cat-tab').forEach((it) => it.classList.toggle('active', it.dataset.target === id));
  const tabs = $('#catTabs');
  const tab = tabs.querySelector('.cat-tab.active');
  if (tab && tabs.offsetParent) {
    tabs.scrollTo({ left: tab.offsetLeft - (tabs.clientWidth - tab.offsetWidth) / 2, behavior: 'smooth' });
  }
  const nav = $('#nav');
  const it = nav.querySelector('.nav-item.active');
  if (it && nav.offsetParent) {
    const r = it.offsetTop - nav.scrollTop;
    if (r < 0 || r + it.offsetHeight > nav.clientHeight) {
      nav.scrollTo({ top: it.offsetTop - nav.clientHeight / 2, behavior: 'smooth' });
    }
  }
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    if (!sections.length) return;
    const top = scrollEl.scrollTop + 80;
    let active = sections[0];
    sections.forEach((s) => { if (s.offsetTop <= top) active = s; });
    if (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 8) {
      active = sections[sections.length - 1];
    }
    setActive(active.id);
  });
}
scrollEl.addEventListener('scroll', onScroll, { passive: true });
