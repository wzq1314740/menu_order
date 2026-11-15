/* 桂亭 · 弹窗层叠管理
   所有弹窗、抽屉都通过 open/close 进出，遮罩始终压在最上层弹窗的下面；
   点遮罩、点弹窗外空白处或按 ESC 只关闭最上层。 */

const stack = [];
let veil = null;
const BASE_Z = 50;

function ensureVeil() {
  if (veil) return veil;
  veil = document.querySelector('.veil');
  if (!veil) {
    veil = document.createElement('div');
    veil.className = 'veil';
    document.body.appendChild(veil);
  }
  veil.addEventListener('click', closeTop);
  return veil;
}

function sync() {
  const v = ensureVeil();
  stack.forEach((it, i) => { it.el.style.zIndex = String(BASE_Z + i * 2 + 1); });
  if (stack.length) {
    v.style.zIndex = String(BASE_Z + (stack.length - 1) * 2);
    v.classList.add('show');
  } else {
    v.classList.remove('show');
  }
  document.documentElement.classList.toggle('has-overlay', stack.length > 0);
}

export function isOpen(el) {
  return stack.some((it) => it.el === el);
}

export function open(el, opts) {
  if (isOpen(el)) return;
  stack.push({ el, onClose: opts && opts.onClose });
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  if (!el.dataset.ovBound) {
    el.dataset.ovBound = '1';
    /* 点弹窗外围空白处关闭（.modal-wrap 铺满全屏，盖住了遮罩） */
    el.addEventListener('click', (e) => { if (e.target === el) close(el); });
  }
  sync();
}

export function close(el) {
  const i = stack.findIndex((it) => it.el === el);
  if (i < 0) return;
  const it = stack.splice(i, 1)[0];
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  sync();
  if (it.onClose) it.onClose();
}

export function closeTop() {
  if (stack.length) close(stack[stack.length - 1].el);
}

export function hasOpen() {
  return stack.length > 0;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) { e.preventDefault(); closeTop(); }
});
