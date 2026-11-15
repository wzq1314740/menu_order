/* 搜索：中文菜名、拼音全拼、拼音首字母（离线词典 pinyin-dict.js） */
import { $, esc, priceText } from '../common.js';
import { S, dishHasMethods, perDish, onChange } from './store.js';

const box = $('#searchBox');
const input = $('#searchInput');
const pop = $('#searchPop');
const PYDICT = window.PINYIN_DICT || {};
let index = [];
let timer = null;

/* 每个字 -> 候选读音数组（多音字含全部读音）；字母数字按字面；标点跳过 */
function nameChars(name) {
  const out = [];
  for (const ch of name) {
    const ps = PYDICT[ch];
    if (ps && ps.length) { out.push(ps); continue; }
    if (/[a-z0-9]/i.test(ch)) out.push([ch.toLowerCase()]);
  }
  return out;
}

/* 全拼：可从菜名任意字开始；多音字任一读音命中；最后一个音节可以没打完 */
function pyFullMatch(q, chars) {
  if (q.length < 2) return false;
  function go(qi, i) {
    if (qi >= q.length) return true;
    if (i >= chars.length) return false;
    for (const r of chars[i]) {
      if (q.startsWith(r, qi) && go(qi + r.length, i + 1)) return true;
      if (r.startsWith(q.slice(qi))) return true;
    }
    return false;
  }
  for (let s = 0; s < chars.length; s++) if (go(0, s)) return true;
  return false;
}

/* 首字母：如 bzjw -> 白灼基围虾 */
function pyIniMatch(q, chars) {
  if (q.length < 2) return false;
  function go(qi, i) {
    if (qi >= q.length) return true;
    if (i >= chars.length) return false;
    for (const r of chars[i]) if (r.charAt(0) === q.charAt(qi) && go(qi + 1, i + 1)) return true;
    return false;
  }
  for (let s = 0; s < chars.length; s++) if (go(0, s)) return true;
  return false;
}

export function buildIndex() {
  index = S.dishes.map((d) => ({ d, name: String(d.name || ''), chars: null }));
  if (pop.classList.contains('show')) render();
}

function match(it, q) {
  if (it.name.toLowerCase().indexOf(q) > -1) return true;
  if (!/^[a-z0-9]+$/.test(q)) return false;
  const cs = it.chars || (it.chars = nameChars(it.name));
  return pyFullMatch(q, cs) || pyIniMatch(q, cs);
}

function render() {
  const raw = input.value;
  box.classList.toggle('has-txt', !!raw);
  const q = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) { hide(); return; }
  const hits = index.filter((it) => match(it, q));
  const per = perDish();
  let out;
  if (!hits.length) {
    out = '<div class="sp-head">无匹配结果</div>' +
      '<div class="empty" style="padding:30px 0"><p>未找到对应菜品<br>可换菜名或拼音再试</p></div>';
  } else {
    out = '<div class="sp-head">找到 ' + hits.length + ' 道 · 轻点 ＋ 加入预选</div><div class="sp-body">';
    S.cats.forEach((c) => {
      const list = hits.filter((it) => it.d.cat === c.id);
      if (!list.length) return;
      out += '<div class="sp-grp">' + esc(c.name) + '</div>';
      list.forEach((it) => {
        const q2 = per[it.d.id] || 0;
        out += '<div class="s-line" data-open="' + esc(it.d.id) + '">' +
          '<div><div class="nm">' + esc(it.d.name) + '</div>' +
            '<div class="mt">' + esc(priceText(it.d)) + (dishHasMethods(it.d) ? ' · 可选做法' : '') + '</div></div>' +
          '<div class="sp"></div>' +
          (q2 ? '<span class="q">已选 ' + q2 + '</span>' : '') +
          '<button class="s-add" data-add="' + esc(it.d.id) + '" aria-label="加入预选">+</button>' +
        '</div>';
      });
    });
    out += '</div>';
  }
  pop.innerHTML = out;
  pop.classList.add('show');
}

function hide() { pop.classList.remove('show'); }

input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(render, 150);
});
input.addEventListener('focus', () => { if (input.value.trim()) render(); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hide(); input.blur(); }
  if (e.key === 'Enter') input.blur();
});
$('#searchClr').addEventListener('click', () => {
  input.value = '';
  box.classList.remove('has-txt');
  hide();
  input.focus();
});
/* 点搜索框以外的地方收起结果（点弹窗里的内容不算） */
document.addEventListener('pointerdown', (e) => {
  if (!pop.classList.contains('show')) return;
  if (box.contains(e.target) || e.target.closest('.modal-wrap, .drawer, .veil')) return;
  hide();
});
onChange(() => { if (pop.classList.contains('show')) render(); });
