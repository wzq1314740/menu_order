/* 桂亭 · 菜单后台 */
import { $, $$, esc, imgSrc, toast, api, logout, pad2 } from './common.js';
import * as overlay from './overlay.js';

const modal = $('#modal');
const panel = $('#panel');

let state = null;        // { version, meta, categories, dishes }
let curCat = 'all';
let editing = null;      // 正在编辑的菜品副本
let editingIsNew = false;
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------------- 读写服务端 ---------------- */
async function loadMenu() {
  state = await api('/api/menu');
  state.meta = state.meta || {};
  state.meta.tables = state.meta.tables || [];
  if (curCat !== 'all' && !state.categories.some((c) => c.id === curCat)) curCat = 'all';
  renderCats();
  renderList();
}

let saveChain = Promise.resolve(true);
/* 按顺序保存，避免连续点击时请求乱序；失败时从服务端重新载入，保证页面和服务端一致 */
function save(okMsg) {
  const snapshot = clone({ meta: state.meta, categories: state.categories, dishes: state.dishes });
  saveChain = saveChain.then(async () => {
    $('#saving').hidden = false;
    try {
      const res = await api('/api/menu', { method: 'PUT', auth: true, body: Object.assign({ version: state.version }, snapshot) });
      state.version = res.version;
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      if (e.status === 409) {
        alert(e.message);
      } else {
        toast('保存失败：' + e.message, true);
      }
      await loadMenu().catch(() => {});
      return false;
    } finally {
      $('#saving').hidden = true;
    }
  });
  return saveChain;
}

/* ---------------- 分类 ---------------- */
function catName(id) {
  const c = state.categories.find((x) => x.id === id);
  return c ? c.name : '未分类';
}

function renderCats() {
  let h = '<h4>菜品分类</h4>';
  h += '<div class="cat-row' + (curCat === 'all' ? ' active' : '') + '"><button class="cat" data-cat="all">' +
    '<span class="nm">全部菜品</span><span class="n">' + state.dishes.length + '</span></button></div>';
  state.categories.forEach((c) => {
    const n = state.dishes.filter((d) => d.cat === c.id).length;
    h += '<div class="cat-row' + (curCat === c.id ? ' active' : '') + '">' +
      '<button class="cat" data-cat="' + esc(c.id) + '"><span class="nm">' + esc(c.name) + '</span><span class="n">' + n + '</span></button>' +
      '<span class="cat-ops">' +
        '<button data-catop="edit" data-id="' + esc(c.id) + '" title="重命名">✎</button>' +
        '<button data-catop="up" data-id="' + esc(c.id) + '" title="上移">↑</button>' +
        '<button data-catop="down" data-id="' + esc(c.id) + '" title="下移">↓</button>' +
        '<button data-catop="del" data-id="' + esc(c.id) + '" title="删除">✕</button>' +
      '</span></div>';
  });
  h += '<button class="addcat" id="addCatBtn">＋ 新增分类</button>';
  $('#catList').innerHTML = h;
}

$('#catList').addEventListener('click', (e) => {
  if (e.target.closest('#addCatBtn')) {
    const name = prompt('新分类名称（例如：时令推荐）');
    if (!name || !name.trim()) return;
    const en = prompt('分类英文（可留空）', '') || '';
    const id = 'c' + Date.now().toString(36);
    state.categories.push({ id, name: name.trim(), en: en.trim() });
    curCat = id;
    renderCats(); renderList();
    save('已新增分类');
    return;
  }
  const op = e.target.closest('[data-catop]');
  if (op) {
    const i = state.categories.findIndex((x) => x.id === op.dataset.id);
    const c = state.categories[i];
    if (op.dataset.catop === 'edit') {
      const name = prompt('分类名称', c.name);
      if (name == null || !name.trim()) return;
      c.name = name.trim();
      const en = prompt('分类英文（可留空）', c.en || '');
      if (en != null) c.en = en.trim();
      renderCats(); renderList();
      save('分类已更新');
    } else if (op.dataset.catop === 'del') {
      const n = state.dishes.filter((d) => d.cat === c.id).length;
      if (n) { alert('「' + c.name + '」下还有 ' + n + ' 道菜，请先移到其他分类或删除。'); return; }
      if (!confirm('确定删除分类「' + c.name + '」？')) return;
      state.categories.splice(i, 1);
      curCat = 'all';
      renderCats(); renderList();
      save('分类已删除');
    } else {
      const j = op.dataset.catop === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= state.categories.length) return;
      [state.categories[i], state.categories[j]] = [state.categories[j], state.categories[i]];
      renderCats();
      save();
    }
    return;
  }
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  curCat = b.dataset.cat;
  renderCats(); renderList();
});

/* ---------------- 菜品列表 ---------------- */
function visibleDishes() {
  return state.dishes.filter((d) => curCat === 'all' || d.cat === curCat);
}

function renderList() {
  const list = visibleDishes();
  $('#catTitle').textContent = curCat === 'all' ? '全部菜品' : catName(curCat);
  $('#catCount').textContent = '共 ' + list.length + ' 道';
  if (!list.length) {
    $('#list').innerHTML = '<div class="empty-note">这个分类还没有菜品<br>点右上角「新增菜品」开始添加</div>';
    return;
  }
  $('#list').innerHTML = list.map((d, i) => {
    const price = (d.price === '时价' || d.price === '' || d.price == null)
      ? '<span style="letter-spacing:.14em">时价</span>'
      : '¥' + esc(d.price) + '<small>/ ' + esc(d.unit || '') + '</small>' +
        (d.price2 != null && d.price2 !== '' ? '<br><small>' + esc(d.unit2 || '') + ' ¥' + esc(d.price2) + '</small>' : '');
    return '<div class="row" data-id="' + esc(d.id) + '">' +
      '<div class="th' + (d.img ? '' : ' empty') + '"><img src="' + esc(imgSrc(d.img)) + '" alt="" loading="lazy"></div>' +
      '<div class="nm"><div class="n1">' + esc(d.name) +
          (curCat === 'all' ? '<span class="tag">' + esc(catName(d.cat)) + '</span>' : '') + '</div>' +
        (d.en ? '<div class="n2">' + esc(d.en) + '</div>' : '') +
        (d.desc ? '<div class="n3">' + esc(d.desc) + '</div>' : '') +
        (d.cookMethods && d.cookMethods.length ? '<div class="n3 cm">做法：' + esc(d.cookMethods.join(' / ')) + '</div>' : '') +
      '</div>' +
      '<div class="pr">' + price + '</div>' +
      '<div class="ops">' +
        '<button data-op="up" title="上移"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button data-op="down" title="下移"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button data-op="edit">编辑</button>' +
        '<button data-op="del">删除</button>' +
      '</div></div>';
  }).join('');
}

$('#list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-op]');
  if (!btn) return;
  const id = btn.closest('[data-id]').dataset.id;
  const all = state.dishes;
  const idx = all.findIndex((d) => d.id === id);
  const d = all[idx];
  const op = btn.dataset.op;

  if (op === 'edit') { openEdit(d, false); return; }
  if (op === 'del') {
    if (!confirm('确定删除「' + d.name + '」？\n误删可在「备份与恢复」里找回。')) return;
    all.splice(idx, 1);
    renderCats(); renderList();
    save('已删除');
    return;
  }
  /* 只和当前列表里相邻的那道菜交换，筛选分类时不会和其他分类的菜互换 */
  const vis = visibleDishes();
  const vi = vis.indexOf(d);
  const other = vis[op === 'up' ? vi - 1 : vi + 1];
  if (!other) return;
  const j = all.indexOf(other);
  [all[idx], all[j]] = [all[j], all[idx]];
  renderList();
  save();
});

/* ---------------- 编辑菜品 ---------------- */
function openEdit(d, isNew) {
  editingIsNew = !!isNew;
  editing = clone(d || {
    id: 'd' + Date.now().toString(36),
    cat: curCat === 'all' ? (state.categories[0] && state.categories[0].id) : curCat,
    name: '', en: '', desc: '', price: '', unit: '例', price2: '', unit2: '', img: null, cookMethods: [],
  });
  renderEdit();
  overlay.open(modal);
}

function picHTML(src) {
  return '<img src="' + esc(imgSrc(src)) + '" alt="">';
}

function renderEdit() {
  const d = editing;
  if (!state.categories.length) {
    panel.innerHTML = '<div class="ph"><h3>新增菜品</h3><button class="x" data-close>×</button></div>' +
      '<div class="pb"><div class="empty-note">请先在左侧新增一个分类</div></div>';
    return;
  }
  const opts = state.categories.map((c) =>
    '<option value="' + esc(c.id) + '"' + (d.cat === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
  panel.innerHTML =
    '<div class="ph"><h3>' + (editingIsNew ? '新增菜品' : '编辑菜品') + '</h3><button class="x" data-close aria-label="关闭">×</button></div>' +
    '<div class="pb">' +
      '<div class="f1 pic-pick">' +
        '<div class="pic-box' + (d.img ? '' : ' empty') + '" id="picBox">' + picHTML(d.img) + '</div>' +
        '<div class="pic-side">' +
          '<div class="pic-btns"><label class="btn sm" for="fileImg" style="margin:0;display:inline-flex;align-items:center">选择图片</label>' +
            '<button class="btn sm" id="clearImg">清除图片</button><span id="upState"></span></div>' +
          '建议 4:3 横图，选图后自动压缩到约 1000px 宽并上传到服务器。<br>' +
          '也可直接填图片地址：<input class="inp" id="fImg" style="margin-top:6px;height:36px" value="' + esc(d.img || '') + '" placeholder="images/xxx.jpg 或留空">' +
          '<div style="margin-top:4px">留空 = 点餐页把这道菜放在分类下方的纯文字清单；有图则显示为带图卡片，排在分类前面。</div>' +
        '</div>' +
      '</div>' +
      '<div class="f2">' +
        '<div><label>菜品名称 *</label><input class="inp" id="fName" value="' + esc(d.name) + '" placeholder="例：黑松露鲍鱼焗鸡"></div>' +
        '<div><label>所属分类</label><select class="inp" id="fCat">' + opts + '</select></div>' +
      '</div>' +
      '<div class="f1" style="margin-top:14px"><label>英文名（可留空）</label>' +
        '<input class="inp" id="fEn" value="' + esc(d.en) + '" placeholder="Braised Chicken with Abalone"></div>' +
      '<div class="f1"><label>一句话介绍（详情弹窗中显示）</label>' +
        '<textarea class="inp" id="fDesc" placeholder="例：砂锅焗香，鲍汁浓郁">' + esc(d.desc) + '</textarea></div>' +
      '<div class="f1"><label>可选做法（用逗号、顿号或斜杠分隔；留空则不显示「做法选择」）</label>' +
        '<input class="inp" id="fCook" value="' + esc((d.cookMethods || []).join('，')) + '" placeholder="例：清蒸，豆豉蒸，榄角蒸，干煎"></div>' +
      '<div class="f2">' +
        '<div><label>价格（留空或填「时价」显示时价）</label><input class="inp" id="fPrice" value="' + esc(d.price) + '" placeholder="168 或 时价" inputmode="decimal"></div>' +
        '<div><label>计价单位</label><input class="inp" id="fUnit" value="' + esc(d.unit) + '" placeholder="例 / 位 / 只 / 份 / 斤 / 打"></div>' +
      '</div>' +
      '<div class="f2" style="margin-top:14px">' +
        '<div><label>第二价格（可留空，如半只价）</label><input class="inp" id="fPrice2" value="' + esc(d.price2 == null ? '' : d.price2) + '" placeholder="768" inputmode="decimal"></div>' +
        '<div><label>第二价格单位</label><input class="inp" id="fUnit2" value="' + esc(d.unit2) + '" placeholder="半只 / 半打 / 碗"></div>' +
      '</div>' +
      '<div class="hint" id="hint"></div>' +
    '</div>' +
    '<div class="pf">' + (editingIsNew ? '' : '<button class="btn danger" id="mDel">删除此菜</button>') +
      '<div class="sp"></div><button class="btn" data-close>取消</button>' +
      '<button class="btn primary" id="mSave">保存</button></div>';

  $('#fImg').oninput = function () {
    editing.img = this.value.trim() || null;
    $('#picBox').className = 'pic-box' + (editing.img ? '' : ' empty');
    $('#picBox').innerHTML = picHTML(editing.img);
  };
  $('#clearImg').onclick = () => {
    editing.img = null;
    $('#fImg').value = '';
    $('#picBox').className = 'pic-box empty';
    $('#picBox').innerHTML = picHTML(null);
  };
  $('#mSave').onclick = saveEdit;
  if (!editingIsNew) {
    $('#mDel').onclick = () => {
      if (!confirm('确定删除「' + editing.name + '」？')) return;
      state.dishes = state.dishes.filter((x) => x.id !== editing.id);
      overlay.close(modal);
      renderCats(); renderList();
      save('已删除');
    };
  }
}

panel.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) overlay.close(modal);
});

function parsePrice(v) {
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : v;
}

function saveEdit() {
  const name = $('#fName').value.trim();
  if (!name) { $('#hint').textContent = '请填写菜品名称'; $('#fName').focus(); return; }
  if (uploading) { $('#hint').textContent = '图片还在上传，请稍等'; return; }
  const price = $('#fPrice').value.trim();
  const p2 = $('#fPrice2').value.trim();
  const cooks = $('#fCook').value.split(/[,，、;；\/|]+/).map((s) => s.trim()).filter(Boolean);
  const uniq = cooks.filter((s, i) => cooks.indexOf(s) === i);
  const o = {
    id: editing.id,
    cat: $('#fCat').value,
    name,
    en: $('#fEn').value.trim(),
    desc: $('#fDesc').value.trim(),
    price: price === '' ? '时价' : parsePrice(price),
    unit: $('#fUnit').value.trim(),
    price2: p2 === '' ? null : parsePrice(p2),
    unit2: $('#fUnit2').value.trim(),
    cookMethods: uniq,
    img: editing.img || null,
  };
  if (editingIsNew) {
    state.dishes.push(o);
  } else {
    const i = state.dishes.findIndex((x) => x.id === o.id);
    if (i < 0) state.dishes.push(o); else state.dishes[i] = o;
  }
  overlay.close(modal);
  renderCats(); renderList();
  save(editingIsNew ? '已新增菜品' : '已保存修改');
}

/* 图片：浏览器内压缩到 1000px 后上传 */
let uploading = false;
$('#fileImg').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f || !editing) return;
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = async () => {
      const MAX = 1000;
      const k = Math.min(1, MAX / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k);
      cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const url = cv.toDataURL('image/jpeg', 0.82);
      $('#picBox').className = 'pic-box';
      $('#picBox').innerHTML = '<img src="' + url + '" alt="">';
      $('#upState').textContent = '上传中…';
      uploading = true;
      try {
        const res = await api('/api/upload', { method: 'POST', auth: true, body: { data: url } });
        editing.img = res.path;
        $('#fImg').value = res.path;
        $('#upState').textContent = '已上传，记得点保存';
      } catch (err) {
        $('#upState').textContent = '';
        toast('图片上传失败：' + err.message, true);
      } finally {
        uploading = false;
      }
    };
    img.onerror = () => toast('无法读取这张图片', true);
    img.src = fr.result;
  };
  fr.readAsDataURL(f);
});

/* ---------------- 门店设置：门店信息、桌号、口令 ---------------- */
let tablesDraft = [];

function nextTableId() {
  const used = new Set(tablesDraft.map((t) => t.id));
  for (let i = 1; ; i++) {
    const id = 'T' + pad2(i);
    if (!used.has(id)) return id;
  }
}

function tableLink(id) {
  return location.origin + '/?table=' + encodeURIComponent(id);
}

function tablesHTML() {
  if (!tablesDraft.length) return '<div class="empty-note" style="padding:20px 0">还没有包厢或桌号</div>';
  return '<div class="t-row t-head"><span>编号</span><span>区域</span><span>名称</span><span></span></div>' +
    tablesDraft.map((t, i) =>
      '<div class="t-row" data-ti="' + i + '">' +
        '<span class="tid">' + esc(t.id) + '</span>' +
        '<input class="inp" data-tf="area" value="' + esc(t.area || '') + '" placeholder="包厢 / 大厅">' +
        '<input class="inp" data-tf="name" value="' + esc(t.name) + '" placeholder="例：01 号包厢">' +
        '<span class="ops"><button data-top="link" title="复制专属点餐链接">链接</button>' +
          '<button data-top="up">↑</button><button data-top="down">↓</button>' +
          '<button class="del" data-top="del">删除</button></span>' +
      '</div>').join('');
}

function openSettings() {
  const m = state.meta;
  tablesDraft = clone(m.tables || []);
  const field = (k, label, ph) => '<div><label>' + label + '</label><input class="inp" data-meta="' + k + '" value="' + esc(m[k] || '') + '" placeholder="' + ph + '"></div>';
  panel.innerHTML =
    '<div class="ph"><h3>门店设置</h3><button class="x" data-close aria-label="关闭">×</button></div>' +
    '<div class="pb">' +
      '<div class="sec-t">门店信息</div>' +
      '<div class="f2">' + field('brand', '品牌名', '桂亭') + field('brandEn', '英文名', 'Laurel Garden') + '</div>' +
      '<div class="f2" style="margin-top:14px">' + field('brandSub', '副标题', '臻品粤菜府') + field('store', '门店名', '桂亭 · 福田店') + '</div>' +
      '<div class="f2" style="margin-top:14px">' + field('room', '菜单标题', '包厢预选菜单') + field('note', '顶部提示语', '本菜单仅作预选，最终以服务员确认为准') + '</div>' +
      '<div class="sec-t">包厢和桌号</div>' +
      '<div id="tableRows">' + tablesHTML() + '</div>' +
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" id="addTable">＋ 新增桌号</button>' +
        '<span style="font-size:11px;color:var(--ink-3);line-height:34px">「链接」可复制该桌的专属点餐地址，打开后自动选好桌号，可做成二维码贴在桌上</span></div>' +
      '<div class="hint" id="setHint"></div>' +
      '<div class="sec-t">修改口令</div>' +
      '<div class="f2"><div><label>新员工口令（查看订单）</label><input class="inp" id="pinStaff" type="password" placeholder="不改请留空" autocomplete="new-password"></div>' +
        '<div><label>新管理口令（管理菜单）</label><input class="inp" id="pinAdmin" type="password" placeholder="不改请留空" autocomplete="new-password"></div></div>' +
      '<div style="margin-top:10px"><button class="btn sm" id="savePins">保存口令</button>' +
        '<span style="font-size:11px;color:var(--ink-3);margin-left:8px">修改员工口令后，已登录的员工设备需要重新登录</span></div>' +
    '</div>' +
    '<div class="pf"><div class="sp"></div><button class="btn" data-close>取消</button><button class="btn primary" id="saveSettings">保存门店信息和桌号</button></div>';
  overlay.open(modal);

  $('#addTable').onclick = () => {
    syncTableInputs();
    const last = tablesDraft[tablesDraft.length - 1];
    tablesDraft.push({ id: nextTableId(), name: '', area: last ? last.area : '包厢' });
    $('#tableRows').innerHTML = tablesHTML();
    const inputs = $$('#tableRows [data-tf="name"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  };
  $('#saveSettings').onclick = saveSettings;
  $('#savePins').onclick = savePins;
}

function syncTableInputs() {
  $$('#tableRows [data-ti]').forEach((row) => {
    const t = tablesDraft[+row.dataset.ti];
    t.area = row.querySelector('[data-tf="area"]').value.trim();
    t.name = row.querySelector('[data-tf="name"]').value.trim();
  });
}

function copyText(text) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制：' + text); } catch (e) { prompt('请手动复制', text); }
    ta.remove();
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => toast('已复制：' + text), fallback);
  } else fallback();
}

panel.addEventListener('click', (e) => {
  const b = e.target.closest('[data-top]');
  if (!b) return;
  syncTableInputs();
  const i = +b.closest('[data-ti]').dataset.ti;
  const op = b.dataset.top;
  if (op === 'link') { copyText(tableLink(tablesDraft[i].id)); return; }
  if (op === 'del') {
    if (!confirm('删除「' + (tablesDraft[i].name || tablesDraft[i].id) + '」？保存后生效。')) return;
    tablesDraft.splice(i, 1);
  } else {
    const j = op === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= tablesDraft.length) return;
    [tablesDraft[i], tablesDraft[j]] = [tablesDraft[j], tablesDraft[i]];
  }
  $('#tableRows').innerHTML = tablesHTML();
});

async function saveSettings() {
  syncTableInputs();
  const empty = tablesDraft.find((t) => !t.name);
  if (empty) { $('#setHint').textContent = '桌号 ' + empty.id + ' 还没有填写名称'; return; }
  const names = tablesDraft.map((t) => t.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) { $('#setHint').textContent = '桌号名称重复：' + dup; return; }
  $$('[data-meta]', panel).forEach((inp) => { state.meta[inp.dataset.meta] = inp.value.trim(); });
  state.meta.tables = clone(tablesDraft);
  overlay.close(modal);
  save('门店设置已保存');
}

async function savePins() {
  const staff = $('#pinStaff').value.trim();
  const admin = $('#pinAdmin').value.trim();
  if (!staff && !admin) { toast('请填写要修改的口令', true); return; }
  if ((staff && staff.length < 4) || (admin && admin.length < 4)) { toast('口令至少 4 位', true); return; }
  try {
    await api('/api/config/pins', { method: 'PUT', auth: true, body: { staff, admin } });
    $('#pinStaff').value = '';
    $('#pinAdmin').value = '';
    toast('口令已修改');
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------------- 备份与恢复 ---------------- */
async function openBackups() {
  panel.innerHTML = '<div class="ph"><h3>备份与恢复</h3><button class="x" data-close aria-label="关闭">×</button></div>' +
    '<div class="pb" id="bkBody"><div class="empty-note">载入中…</div></div>';
  overlay.open(modal);
  let list = [];
  try {
    list = (await api('/api/menu/backups', { auth: true })).backups;
  } catch (e) {
    $('#bkBody').innerHTML = '<div class="empty-note">' + esc(e.message) + '</div>';
    return;
  }
  $('#bkBody').innerHTML =
    '<p style="font-size:12px;color:var(--ink-3);line-height:1.8;margin:0 0 10px">每次保存菜单前会自动备份上一版，保留最近 30 份。恢复后当前菜单也会先备份，可以再恢复回来。</p>' +
    (list.length ? list.map((b) =>
      '<div class="bk-row"><span class="t">' + new Date(b.time).toLocaleString('zh-CN', { hour12: false }) +
        '<small>' + b.dishes + ' 道菜</small></span>' +
        '<button class="btn sm" data-restore="' + esc(b.name) + '">恢复此版本</button></div>').join('')
      : '<div class="empty-note">暂无备份</div>');
}

panel.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-restore]');
  if (!b) return;
  if (!confirm('确定把菜单恢复到这个版本？')) return;
  try {
    await api('/api/menu/restore', { method: 'POST', auth: true, body: { name: b.dataset.restore } });
    overlay.close(modal);
    await loadMenu();
    toast('已恢复');
  } catch (err) {
    toast(err.message, true);
  }
});

/* ---------------- 导出 / 导入 ---------------- */
function toMenuJs() {
  return '/* 桂亭 · 菜单数据（由后台导出，可在后台「导入」恢复） */\n' +
    'window.MENU_META = ' + JSON.stringify(state.meta, null, 2) + ';\n\n' +
    'window.MENU_CATEGORIES = ' + JSON.stringify(state.categories, null, 2) + ';\n\n' +
    'window.MENU_DISHES = ' + JSON.stringify(state.dishes, null, 2) + ';\n';
}

$('#exportBtn').onclick = () => {
  const blob = new Blob([toMenuJs()], { type: 'text/javascript;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'menu-data-' + new Date().toISOString().slice(0, 10) + '.js';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('已导出菜单文件');
};

/* 只解析 JSON 字面量，不执行文件里的代码 */
function parseMenuFile(txt) {
  if (!/MENU_DISHES/.test(txt)) return JSON.parse(txt);
  const pick = (name) => {
    const m = new RegExp('window\\.MENU_' + name + '\\s*=\\s*').exec(txt);
    if (!m) return undefined;
    let depth = 0, inStr = false, escp = false;
    const start = m.index + m[0].length;
    for (let i = start; i < txt.length; i++) {
      const ch = txt[i];
      if (inStr) {
        if (escp) escp = false;
        else if (ch === '\\') escp = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return JSON.parse(txt.slice(start, i + 1)); }
    }
    throw new Error('文件不完整');
  };
  return { meta: pick('META'), categories: pick('CATEGORIES'), dishes: pick('DISHES') };
}

$('#importBtn').onclick = () => $('#fileJson').click();
$('#fileJson').onchange = (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    let o;
    try {
      o = parseMenuFile(String(fr.result));
      if (!o.dishes || !o.dishes.length) throw new Error('没有读到菜品');
      if (o.dishes.some((d) => typeof d.img === 'string' && d.img.startsWith('data:'))) {
        throw new Error('文件里有内嵌图片，请先把图片改为上传方式');
      }
    } catch (err) {
      toast('导入失败：' + err.message, true);
      return;
    }
    if (!confirm('导入后将替换当前全部菜单（' + o.dishes.length + ' 道菜）。当前菜单会自动备份，确定导入？')) return;
    const tables = state.meta.tables;
    state.meta = o.meta || state.meta;
    if (!state.meta.tables || !state.meta.tables.length) state.meta.tables = tables;
    state.categories = o.categories || state.categories;
    state.dishes = o.dishes;
    curCat = 'all';
    renderCats(); renderList();
    save('已导入 ' + o.dishes.length + ' 道菜');
  };
  fr.readAsText(f, 'utf-8');
};

/* ---------------- 其他 ---------------- */
$('#addBtn').onclick = () => openEdit(null, true);
$('#settingsBtn').onclick = openSettings;
$('#backupBtn').onclick = openBackups;
$('#logoutBtn').onclick = logout;
$('#tipClose').onclick = () => { $('#tip').hidden = true; localStorage.setItem('mo_admin_tip', '0'); };
if (localStorage.getItem('mo_admin_tip') === '0') $('#tip').hidden = true;

loadMenu().catch((e) => {
  $('#list').innerHTML = '<div class="empty-note">菜单载入失败：' + esc(e.message) + '</div>';
});
