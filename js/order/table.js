/* 选择包厢 / 桌号 */
import { $, esc, toast } from '../common.js';
import { S, tables, findTable, setTable } from './store.js';

const page = $('#tablePage');
const listEl = $('#tableList');
const closeBtn = $('#tableClose');

export function renderTableChip() {
  const chip = $('#tableChip');
  chip.classList.toggle('empty', !S.table);
  $('#tableName').textContent = S.table ? S.table.name : '请选择';
}

export function openTablePage() {
  const ts = tables();
  if (!ts.length) {
    listEl.innerHTML = '<div class="tp-empty">尚未设置包厢和桌号<br>请联系店长在菜单后台的「门店设置」中添加</div>';
  } else {
    const areas = [];
    const byArea = {};
    ts.forEach((t) => {
      const a = t.area || '其他';
      if (!byArea[a]) { byArea[a] = []; areas.push(a); }
      byArea[a].push(t);
    });
    listEl.innerHTML = areas.map((a) =>
      '<div class="tp-area"><h3>' + esc(a) + '</h3><div class="tp-grid">' +
        byArea[a].map((t) => '<button class="tp-btn' + (S.table && S.table.id === t.id ? ' cur' : '') +
          '" data-table="' + esc(t.id) + '">' + esc(t.name) + '</button>').join('') +
      '</div></div>'
    ).join('');
  }
  closeBtn.hidden = !S.table;
  page.hidden = false;
  page.scrollTop = 0;
}

export function closeTablePage() {
  if (!S.table) return;
  page.hidden = true;
}

listEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-table]');
  if (!b) return;
  const t = findTable(b.dataset.table);
  if (!t) return;
  const changed = !S.table || S.table.id !== t.id;
  setTable(t);
  renderTableChip();
  page.hidden = true;
  if (changed) toast('当前桌号：' + t.name);
});
closeBtn.addEventListener('click', closeTablePage);
$('#tableChip').addEventListener('click', openTablePage);
