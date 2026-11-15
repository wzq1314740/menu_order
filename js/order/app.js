/* 点餐页入口 */
import { $, esc, toast } from '../common.js';
import * as overlay from '../overlay.js';
import { S, fetchMenu, applyMenu, findTable, savedTableId, setTable, dishHasMethods, addItem, refresh, onChange } from './store.js';
import { renderBrand, renderMenu, syncDishCounts } from './menu.js';
import { openDish } from './dish.js';
import { openCook } from './cook.js';
import { openCart, syncBadges } from './cart.js';
import { buildIndex } from './search.js';
import { openSheet, openMine } from './submit.js';
import { renderTableChip, openTablePage } from './table.js';

function showLoadError(msg) {
  $('#scroll').innerHTML = '<div class="loading">菜单载入失败<br>' + esc(msg) +
    '<br><button class="btn-ghost" id="retryBtn">重新载入</button></div>';
  $('#retryBtn').addEventListener('click', () => location.reload());
}

function renderAll() {
  renderBrand();
  renderMenu();
  buildIndex();
  renderTableChip();
  syncBadges();
}

async function init() {
  let menu;
  try {
    menu = await fetchMenu();
  } catch (e) {
    showLoadError(e.message);
    return;
  }
  applyMenu(menu);

  /* 链接带 ?table=xxx 时直接选定该桌（可做成每桌二维码） */
  const qs = new URLSearchParams(location.search);
  const t = findTable(qs.get('table') || '') || findTable(savedTableId());
  if (t) setTable(t);
  if (qs.has('table')) history.replaceState(null, '', location.pathname);

  renderAll();
  if (!S.table) openTablePage();
}

onChange(syncDishCounts);

/* ---------- 全局点击：加菜、打开详情、打开清单 ---------- */
document.addEventListener('click', (e) => {
  const mBtn = e.target.closest('[data-method]');
  if (mBtn) { openCook(mBtn.dataset.method); return; }

  const add = e.target.closest('[data-add]');
  if (add) {
    const d = S.byId[add.dataset.add];
    if (!d) return;
    if (dishHasMethods(d)) { openCook(d.id); return; }
    addItem(d.id, 1);
    toast('已加入「' + d.name + '」');
    return;
  }
  if (e.target.closest('[data-open-cart]')) { openCart(); return; }
  if (e.target.closest('[data-open-mine]')) { openMine(); return; }

  const opener = e.target.closest('.dish, .tl-row, [data-open]');
  if (opener) openDish(opener.dataset.id || opener.dataset.open);
});

$('#confirmBtn').addEventListener('click', openSheet);

/* ---------- 菜单更新：回到页面时检查，有变化就重新渲染 ---------- */
let checking = false;
async function checkUpdate() {
  if (checking || !S.version) return;
  checking = true;
  try {
    const m = await fetchMenu();
    if (m.version !== S.version) {
      applyMenu(m);
      renderAll();
      refresh();
      if (!S.table) openTablePage();
      toast('菜单已更新');
    }
  } catch (e) { /* 网络暂不可用，下次再试 */ }
  checking = false;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
setInterval(() => { if (!document.hidden && !overlay.hasOpen()) checkUpdate(); }, 5 * 60 * 1000);

init();
