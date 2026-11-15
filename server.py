#!/usr/bin/env python3
"""桂亭 · 局域网点餐服务（仅依赖 Python 3.8+ 标准库）

用法：
  python server.py              启动服务
  python server.py --setup      设置员工口令和管理口令
  python server.py --install    （Windows，管理员）设置口令、放行防火墙、开机自启并立即启动
  python server.py --uninstall  （Windows，管理员）删除防火墙规则和开机自启
"""
import base64
import hashlib
import hmac
import json
import logging
import logging.handlers
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, 'data')
ORDERS_DIR = os.path.join(DATA, 'orders')
BACKUP_DIR = os.path.join(DATA, 'backup')
UPLOAD_DIR = os.path.join(ROOT, 'images', 'uploads')
MENU_FILE = os.path.join(DATA, 'menu.json')
SESS_FILE = os.path.join(DATA, 'sessions.json')
CONFIG_FILE = os.path.join(ROOT, 'config.json')
LOG_FILE = os.path.join(DATA, 'server.log')

DEFAULT_PORT = 8080
SESSION_DAYS = 30
MAX_BODY = 8 * 1024 * 1024
BACKUP_KEEP = 30
LOGIN_MAX_FAILS = 5
LOGIN_LOCK_SECONDS = 300
FIREWALL_RULE = 'GuitingMenuOrder'
SHORTCUT_NAME = 'GuitingMenuOrder.lnk'

STATUSES = ('new', 'confirmed', 'done', 'cancelled')
COOKIE = 'mo_sess'

# 这些路径不允许通过浏览器直接访问
PRIVATE_PREFIXES = ('/data', '/config.json', '/server.py', '/_unused', '/.')
PRIVATE_SUFFIXES = ('.bat', '.py', '.log')

LOCK = threading.RLock()
log = logging.getLogger('menu')


# ---------------------------------------------------------------- 基础工具

def ensure_dirs():
    for d in (DATA, ORDERS_DIR, BACKUP_DIR, UPLOAD_DIR):
        os.makedirs(d, exist_ok=True)


def read_json(path, default=None):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except (OSError, ValueError):
        log.exception('读取失败：%s', path)
        return default


def write_json(path, obj):
    """先写临时文件再替换，断电或崩溃时不会留下写了一半的文件"""
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def now_ms():
    return int(time.time() * 1000)


def today():
    return datetime.now().strftime('%Y-%m-%d')


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith('127.'))


# ---------------------------------------------------------------- 配置和口令

def hash_pin(pin, salt):
    return hashlib.pbkdf2_hmac('sha256', pin.encode('utf-8'), bytes.fromhex(salt), 120000).hex()


def load_config():
    return read_json(CONFIG_FILE, None)


def save_pins(cfg, staff=None, admin=None):
    if staff:
        cfg['staff_salt'] = secrets.token_hex(16)
        cfg['staff_hash'] = hash_pin(staff, cfg['staff_salt'])
    if admin:
        cfg['admin_salt'] = secrets.token_hex(16)
        cfg['admin_hash'] = hash_pin(admin, cfg['admin_salt'])
    write_json(CONFIG_FILE, cfg)


def check_pin(cfg, pin):
    """返回匹配的角色：admin / staff / None"""
    if not cfg or not pin:
        return None
    for role in ('admin', 'staff'):
        h, salt = cfg.get(role + '_hash'), cfg.get(role + '_salt')
        if h and salt and hmac.compare_digest(h, hash_pin(pin, salt)):
            return role
    return None


def ask_pin(label, min_len=4):
    while True:
        a = input('请设置%s（至少 %d 位）：' % (label, min_len)).strip()
        if len(a) < min_len:
            print('  太短了，请重新输入。')
            continue
        b = input('请再输入一次：').strip()
        if a != b:
            print('  两次输入不一致，请重新输入。')
            continue
        return a


def setup_interactive(force=False):
    cfg = load_config()
    if cfg and cfg.get('admin_hash') and not force:
        ans = input('已经设置过口令，是否重新设置？(y/N)：').strip().lower()
        if ans != 'y':
            return cfg
    cfg = cfg or {'port': DEFAULT_PORT}
    print('\n员工口令：用于查看订单（前台、服务员）。')
    staff = ask_pin('员工口令')
    print('\n管理口令：用于管理菜单、桌号和口令（店长）。')
    while True:
        admin = ask_pin('管理口令')
        if admin == staff:
            print('  管理口令不能和员工口令相同。')
            continue
        break
    save_pins(cfg, staff, admin)
    print('\n口令已保存。')
    return cfg


def ensure_config():
    cfg = load_config()
    if cfg and cfg.get('admin_hash') and cfg.get('staff_hash'):
        return cfg
    if sys.stdin and sys.stdin.isatty():
        print('首次启动，需要先设置口令。')
        return setup_interactive(force=True)
    # 没有控制台（例如用 pythonw 启动）时使用默认口令，登录后台后请立即修改
    cfg = cfg or {'port': DEFAULT_PORT}
    save_pins(cfg, '8888', '6666')
    log.warning('未设置口令，已使用默认口令：员工 8888，管理 6666。请尽快在后台修改。')
    return cfg


# ---------------------------------------------------------------- 菜单

def default_tables():
    tables = [{'id': 'V%02d' % i, 'name': '%02d 号包厢' % i, 'area': '包厢'} for i in range(1, 9)]
    tables += [{'id': 'A%02d' % i, 'name': '大厅 %02d 桌' % i, 'area': '大厅'} for i in range(1, 11)]
    return tables


def parse_menu_js(txt):
    out = {}
    dec = json.JSONDecoder()
    for m in re.finditer(r'window\.MENU_(META|CATEGORIES|DISHES)\s*=\s*', txt):
        obj, _ = dec.raw_decode(txt, m.end())
        out[m.group(1)] = obj
    return out


def migrate_menu():
    """首次启动时把旧的 menu-data.js 转换为 data/menu.json"""
    if os.path.exists(MENU_FILE):
        return
    menu = {'version': 1, 'meta': {}, 'categories': [], 'dishes': []}
    for name in ('menu-data.js', 'menu-data.backup.js'):
        p = os.path.join(ROOT, name)
        if os.path.exists(p):
            with open(p, 'r', encoding='utf-8') as f:
                parsed = parse_menu_js(f.read())
            menu['meta'] = parsed.get('META', {})
            menu['categories'] = parsed.get('CATEGORIES', [])
            menu['dishes'] = parsed.get('DISHES', [])
            log.info('已从 %s 导入 %d 道菜', name, len(menu['dishes']))
            break
    if not menu['meta'].get('tables'):
        menu['meta']['tables'] = default_tables()
    write_json(MENU_FILE, menu)


def load_menu():
    return read_json(MENU_FILE, {'version': 1, 'meta': {'tables': []}, 'categories': [], 'dishes': []})


def backup_menu():
    if not os.path.exists(MENU_FILE):
        return
    name = 'menu-%s.json' % datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    with open(MENU_FILE, 'rb') as src, open(os.path.join(BACKUP_DIR, name), 'wb') as dst:
        dst.write(src.read())
    files = sorted(f for f in os.listdir(BACKUP_DIR) if f.startswith('menu-') and f.endswith('.json'))
    for f in files[:-BACKUP_KEEP]:
        try:
            os.remove(os.path.join(BACKUP_DIR, f))
        except OSError:
            pass


def validate_menu(body):
    if not isinstance(body, dict):
        raise ValueError('菜单格式错误')
    meta, cats, dishes = body.get('meta'), body.get('categories'), body.get('dishes')
    if not isinstance(meta, dict) or not isinstance(cats, list) or not isinstance(dishes, list):
        raise ValueError('菜单缺少 meta / categories / dishes')
    ids = set()
    for d in dishes:
        if not isinstance(d, dict) or not d.get('id') or not d.get('name'):
            raise ValueError('存在缺少编号或名称的菜品')
        if d['id'] in ids:
            raise ValueError('菜品编号重复：%s' % d['id'])
        ids.add(d['id'])
        if isinstance(d.get('img'), str) and d['img'].startswith('data:'):
            raise ValueError('图片请通过上传保存，不能直接内嵌')
    tids = set()
    for t in meta.get('tables') or []:
        if not t.get('id') or not t.get('name'):
            raise ValueError('存在缺少编号或名称的桌号')
        if t['id'] in tids:
            raise ValueError('桌号编号重复：%s' % t['id'])
        tids.add(t['id'])


# ---------------------------------------------------------------- 订单

def orders_path(date):
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', date or ''):
        raise ValueError('日期格式错误')
    return os.path.join(ORDERS_DIR, date + '.json')


def load_orders(date):
    return read_json(orders_path(date), [])


def create_order(body):
    if not isinstance(body, dict):
        raise ValueError('订单格式错误')
    menu = load_menu()
    tables = {t['id']: t for t in menu['meta'].get('tables') or []}
    table = tables.get(str(body.get('table') or ''))
    if not table:
        raise ValueError('桌号不存在，请重新选择包厢或桌号')
    dishes = {d['id']: d for d in menu['dishes']}
    cats = {c['id']: c for c in menu['categories']}
    raw_items = body.get('items')
    if not isinstance(raw_items, list) or not raw_items or len(raw_items) > 200:
        raise ValueError('订单里没有菜品')
    items, missing = [], []
    for it in raw_items:
        d = dishes.get(str(it.get('id') or ''))
        if not d:
            missing.append(str(it.get('name') or it.get('id')))
            continue
        try:
            qty = int(it.get('qty'))
        except (TypeError, ValueError):
            qty = 0
        if qty < 1 or qty > 99:
            raise ValueError('「%s」的数量不正确' % d['name'])
        method = str(it.get('method') or '')
        if method and method not in (d.get('cookMethods') or []):
            missing.append('%s（%s）' % (d['name'], method))
            continue
        cat = cats.get(d.get('cat'), {})
        items.append({
            'id': d['id'], 'name': d['name'], 'method': method, 'qty': qty,
            'cat': d.get('cat', ''), 'catName': cat.get('name', ''),
            'price': d.get('price'), 'unit': d.get('unit', ''),
        })
    if missing:
        raise ValueError('以下菜品已下架或做法已变更，请刷新后重新选择：' + '、'.join(missing))

    try:
        guests = max(0, min(99, int(body.get('guests') or 0)))
    except (TypeError, ValueError):
        guests = 0
    note = str(body.get('note') or '')[:200]
    client_id = str(body.get('clientId') or '')[:64]

    date = today()
    with LOCK:
        orders = load_orders(date)
        if client_id:
            for o in orders:
                if o.get('clientId') == client_id:
                    return o, False
        seq = max([o.get('seq', 0) for o in orders] + [0]) + 1
        ts = now_ms()
        order = {
            'id': '%s-%03d' % (date, seq), 'seq': seq, 'no': '%03d' % seq, 'date': date,
            'table': table['id'], 'tableName': table['name'], 'area': table.get('area', ''),
            'guests': guests, 'note': note, 'items': items, 'clientId': client_id,
            'status': 'new', 'createdAt': ts, 'updatedAt': ts,
            'history': [{'status': 'new', 'at': ts}],
        }
        orders.append(order)
        write_json(orders_path(date), orders)
    log.info('新订单 %s %s %d 项', order['id'], table['name'], len(items))
    return order, True


def update_order(order_id, status, role):
    if status not in STATUSES:
        raise ValueError('状态不正确')
    m = re.match(r'^(\d{4}-\d{2}-\d{2})-\d+$', order_id or '')
    if not m:
        raise ValueError('订单号不正确')
    with LOCK:
        orders = load_orders(m.group(1))
        for o in orders:
            if o['id'] == order_id:
                if o['status'] != status:
                    ts = now_ms()
                    o['status'] = status
                    o['updatedAt'] = ts
                    o.setdefault('history', []).append({'status': status, 'at': ts, 'by': role})
                    write_json(orders_path(m.group(1)), orders)
                return o
    raise LookupError('订单不存在')


# ---------------------------------------------------------------- 会话和登录限制

class Sessions:
    def __init__(self):
        self.data = read_json(SESS_FILE, {}) or {}
        self.purge()

    def purge(self):
        t = time.time()
        self.data = {k: v for k, v in self.data.items() if v.get('exp', 0) > t}

    def create(self, role):
        with LOCK:
            self.purge()
            token = secrets.token_urlsafe(32)
            self.data[token] = {'role': role, 'exp': time.time() + SESSION_DAYS * 86400}
            write_json(SESS_FILE, self.data)
            return token

    def get(self, token):
        s = self.data.get(token or '')
        if s and s.get('exp', 0) > time.time():
            return s['role']
        return None

    def drop(self, token):
        with LOCK:
            if self.data.pop(token or '', None):
                write_json(SESS_FILE, self.data)

    def drop_role(self, role):
        with LOCK:
            self.data = {k: v for k, v in self.data.items() if v.get('role') != role}
            write_json(SESS_FILE, self.data)


class LoginGuard:
    def __init__(self):
        self.fails = {}

    def locked(self, ip):
        f = self.fails.get(ip)
        return bool(f and f['until'] > time.time())

    def fail(self, ip):
        f = self.fails.setdefault(ip, {'n': 0, 'until': 0})
        f['n'] += 1
        if f['n'] >= LOGIN_MAX_FAILS:
            f['n'] = 0
            f['until'] = time.time() + LOGIN_LOCK_SECONDS

    def ok(self, ip):
        self.fails.pop(ip, None)


SESSIONS = None
GUARD = LoginGuard()
CONFIG = None


# ---------------------------------------------------------------- HTTP

class ApiError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code
        self.msg = msg


class Handler(SimpleHTTPRequestHandler):
    server_version = 'GuitingMenu/1.0'
    # Windows 注册表可能把 .js 映射成 text/plain，导致 ES Module 无法加载，这里显式指定
    extensions_map = {
        '': 'application/octet-stream',
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.md': 'text/plain; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        log.debug('%s %s', self.address_string(), fmt % args)

    # ---- 工具
    def client_ip(self):
        return self.client_address[0]

    def token(self):
        c = SimpleCookie(self.headers.get('Cookie') or '')
        return c[COOKIE].value if COOKIE in c else None

    def role(self):
        return SESSIONS.get(self.token())

    def require(self, need):
        r = self.role()
        if not r:
            raise ApiError(401, '请先登录')
        if need == 'admin' and r != 'admin':
            raise ApiError(403, '需要管理口令')
        return r

    def body_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_BODY:
            raise ApiError(413, '内容太大')
        raw = self.rfile.read(n) if n else b''
        try:
            return json.loads(raw.decode('utf-8') or 'null')
        except ValueError:
            raise ApiError(400, '请求格式错误')

    def send_json(self, obj, code=200, headers=None):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def redirect(self, location):
        self.send_response(302)
        self.send_header('Location', location)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def end_headers(self):
        path = urlparse(self.path).path
        if not path.startswith('/api/') and not path.startswith('/images/'):
            # 页面和脚本每次都向服务器确认，修改后各设备刷新即可生效
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    # ---- 路由
    def do_GET(self):
        self.dispatch('GET')

    def do_HEAD(self):
        self.dispatch('HEAD')

    def do_POST(self):
        self.dispatch('POST')

    def do_PUT(self):
        self.dispatch('PUT')

    def do_PATCH(self):
        self.dispatch('PATCH')

    def dispatch(self, method):
        url = urlparse(self.path)
        path = url.path
        try:
            if path.startswith('/api/'):
                return self.api(method, path, parse_qs(url.query))
            if method not in ('GET', 'HEAD'):
                raise ApiError(405, '不支持的请求')
            low = path.lower()
            if low.startswith(PRIVATE_PREFIXES) or low.endswith(PRIVATE_SUFFIXES):
                return self.send_error(404)
            if path in ('/orders.html', '/admin.html'):
                need = 'admin' if path == '/admin.html' else 'staff'
                r = self.role()
                if not r or (need == 'admin' and r != 'admin'):
                    q = 'next=' + quote(path) + ('&need=admin' if need == 'admin' else '')
                    return self.redirect('/login.html?' + q)
            return super().do_GET() if method == 'GET' else super().do_HEAD()
        except ApiError as e:
            self.send_json({'error': e.msg}, e.code)
        except (ValueError, LookupError) as e:
            self.send_json({'error': str(e)}, 404 if isinstance(e, LookupError) else 400)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            log.exception('处理请求出错：%s %s', method, self.path)
            try:
                self.send_json({'error': '服务器内部错误'}, 500)
            except Exception:
                pass

    def api(self, method, path, q):
        global CONFIG

        if path == '/api/menu' and method == 'GET':
            return self.send_json(load_menu())

        if path == '/api/menu' and method == 'PUT':
            self.require('admin')
            body = self.body_json()
            validate_menu(body)
            with LOCK:
                cur = load_menu()
                if int(body.get('version') or 0) != int(cur.get('version') or 0):
                    raise ApiError(409, '菜单已被其他人修改，请刷新页面后再改')
                backup_menu()
                new = {'version': int(cur.get('version') or 0) + 1, 'meta': body['meta'],
                       'categories': body['categories'], 'dishes': body['dishes']}
                write_json(MENU_FILE, new)
            log.info('菜单已保存，版本 %s', new['version'])
            return self.send_json({'ok': True, 'version': new['version']})

        if path == '/api/menu/backups' and method == 'GET':
            self.require('admin')
            files = sorted((f for f in os.listdir(BACKUP_DIR) if f.startswith('menu-') and f.endswith('.json')),
                           reverse=True)
            out = []
            for f in files:
                m = read_json(os.path.join(BACKUP_DIR, f), {}) or {}
                out.append({'name': f, 'dishes': len(m.get('dishes') or []),
                            'time': os.path.getmtime(os.path.join(BACKUP_DIR, f)) * 1000})
            return self.send_json({'backups': out})

        if path == '/api/menu/restore' and method == 'POST':
            self.require('admin')
            name = str((self.body_json() or {}).get('name') or '')
            if not re.match(r'^menu-[\d-]+\.json$', name):
                raise ApiError(400, '备份名称不正确')
            src = read_json(os.path.join(BACKUP_DIR, name), None)
            if not src:
                raise ApiError(404, '备份不存在')
            with LOCK:
                cur = load_menu()
                backup_menu()
                src['version'] = int(cur.get('version') or 0) + 1
                write_json(MENU_FILE, src)
            return self.send_json({'ok': True, 'version': src['version']})

        if path == '/api/orders' and method == 'POST':
            order, created = create_order(self.body_json())
            return self.send_json({'order': public_order(order), 'created': created})

        if path == '/api/orders/mine' and method == 'GET':
            table = (q.get('table') or [''])[0]
            mine = [public_order(o) for o in load_orders(today()) if o['table'] == table]
            return self.send_json({'orders': mine})

        if path == '/api/orders' and method == 'GET':
            self.require('staff')
            date = (q.get('date') or [today()])[0]
            since = int((q.get('since') or ['0'])[0] or 0)
            ts = now_ms()
            orders = [o for o in load_orders(date) if o.get('updatedAt', 0) >= since]
            return self.send_json({'orders': orders, 'now': ts, 'date': date, 'today': today()})

        m = re.match(r'^/api/orders/([\w-]+)$', path)
        if m and method == 'PATCH':
            role = self.require('staff')
            order = update_order(m.group(1), str((self.body_json() or {}).get('status') or ''), role)
            return self.send_json({'order': order})

        if path == '/api/upload' and method == 'POST':
            self.require('admin')
            return self.send_json({'path': save_upload(self.body_json())})

        if path == '/api/login' and method == 'POST':
            ip = self.client_ip()
            if GUARD.locked(ip):
                raise ApiError(429, '输错次数过多，请 5 分钟后再试')
            pin = str((self.body_json() or {}).get('pin') or '').strip()
            role = check_pin(CONFIG, pin)
            if not role:
                GUARD.fail(ip)
                log.warning('登录失败：%s', ip)
                raise ApiError(401, '口令不正确')
            GUARD.ok(ip)
            token = SESSIONS.create(role)
            cookie = '%s=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=%d' % (COOKIE, token, SESSION_DAYS * 86400)
            log.info('登录成功：%s %s', ip, role)
            return self.send_json({'role': role}, headers={'Set-Cookie': cookie})

        if path == '/api/logout' and method == 'POST':
            SESSIONS.drop(self.token())
            return self.send_json({'ok': True},
                                  headers={'Set-Cookie': '%s=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' % COOKIE})

        if path == '/api/me' and method == 'GET':
            return self.send_json({'role': self.role()})

        if path == '/api/config/pins' and method == 'PUT':
            self.require('admin')
            body = self.body_json() or {}
            staff = str(body.get('staff') or '').strip()
            admin = str(body.get('admin') or '').strip()
            if not staff and not admin:
                raise ApiError(400, '请至少填写一个新口令')
            for p in (staff, admin):
                if p and len(p) < 4:
                    raise ApiError(400, '口令至少 4 位')
            if staff and admin and staff == admin:
                raise ApiError(400, '员工口令和管理口令不能相同')
            with LOCK:
                cfg = load_config() or {}
                if staff and check_pin(cfg, staff) == 'admin':
                    raise ApiError(400, '员工口令不能和管理口令相同')
                if admin and check_pin(cfg, admin) == 'staff':
                    raise ApiError(400, '管理口令不能和员工口令相同')
                save_pins(cfg, staff or None, admin or None)
                CONFIG = cfg
                if staff:
                    SESSIONS.drop_role('staff')
            log.info('口令已修改：%s', ','.join(r for r, p in (('staff', staff), ('admin', admin)) if p))
            return self.send_json({'ok': True})

        raise ApiError(404, '接口不存在')


def public_order(o):
    """给点餐设备看的订单信息，不含操作记录"""
    return {k: o.get(k) for k in ('id', 'no', 'tableName', 'guests', 'note', 'items', 'status', 'createdAt')}


def save_upload(body):
    data = str((body or {}).get('data') or '')
    m = re.match(r'^data:image/(jpeg|png|webp);base64,(.+)$', data, re.S)
    if not m:
        raise ApiError(400, '只支持 JPG / PNG / WEBP 图片')
    raw = base64.b64decode(m.group(2))
    if len(raw) > 5 * 1024 * 1024:
        raise ApiError(413, '图片太大，请小于 5MB')
    ext = {'jpeg': 'jpg', 'png': 'png', 'webp': 'webp'}[m.group(1)]
    name = '%s-%s.%s' % (datetime.now().strftime('%Y%m%d%H%M%S'), secrets.token_hex(3), ext)
    with open(os.path.join(UPLOAD_DIR, name), 'wb') as f:
        f.write(raw)
    return 'images/uploads/' + name


# ---------------------------------------------------------------- Windows 安装

def run(cmd):
    r = subprocess.run(cmd, capture_output=True)
    return r.returncode == 0


def powershell(script):
    enc = base64.b64encode(script.encode('utf-16-le')).decode('ascii')
    return run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc])


def pythonw_exe():
    p = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')
    return p if os.path.exists(p) else sys.executable


def startup_shortcut():
    return os.path.join(os.environ.get('APPDATA', ''), r'Microsoft\Windows\Start Menu\Programs\Startup', SHORTCUT_NAME)


def port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(('127.0.0.1', port)) == 0


def ps_quote(s):
    return "'" + s.replace("'", "''") + "'"


def windows_install():
    if os.name != 'nt':
        print('--install 只适用于 Windows。')
        return 1
    cfg = setup_interactive()
    port = int(cfg.get('port') or DEFAULT_PORT)

    run(['netsh', 'advfirewall', 'firewall', 'delete', 'rule', 'name=' + FIREWALL_RULE])
    ok = run(['netsh', 'advfirewall', 'firewall', 'add', 'rule', 'name=' + FIREWALL_RULE, 'dir=in',
              'action=allow', 'protocol=TCP', 'localport=%d' % port, 'profile=any'])
    print('[%s] 防火墙放行 TCP %d 端口' % ('完成' if ok else '失败', port))

    lnk = startup_shortcut()
    script = ('$s=(New-Object -ComObject WScript.Shell).CreateShortcut(%s);'
              '$s.TargetPath=%s;$s.Arguments=%s;$s.WorkingDirectory=%s;$s.WindowStyle=7;$s.Save()'
              % (ps_quote(lnk), ps_quote(pythonw_exe()), ps_quote('"%s"' % os.path.join(ROOT, 'server.py')),
                 ps_quote(ROOT)))
    ok = powershell(script) and os.path.exists(lnk)
    print('[%s] 开机自动启动：%s' % ('完成' if ok else '失败', lnk))

    if port_in_use(port):
        print('[跳过] 服务已在运行（端口 %d 已被占用）' % port)
    else:
        subprocess.Popen([pythonw_exe(), os.path.join(ROOT, 'server.py')], cwd=ROOT,
                         creationflags=getattr(subprocess, 'DETACHED_PROCESS', 0) |
                         getattr(subprocess, 'CREATE_NO_WINDOW', 0), close_fds=True)
        time.sleep(1.5)
        print('[%s] 后台启动服务' % ('完成' if port_in_use(port) else '失败，请运行 start.bat 查看原因'))
    print_urls(port)
    return 0


def windows_uninstall():
    if os.name != 'nt':
        print('--uninstall 只适用于 Windows。')
        return 1
    ok = run(['netsh', 'advfirewall', 'firewall', 'delete', 'rule', 'name=' + FIREWALL_RULE])
    print('[%s] 删除防火墙规则' % ('完成' if ok else '跳过'))
    lnk = startup_shortcut()
    if os.path.exists(lnk):
        os.remove(lnk)
        print('[完成] 删除开机自动启动')
    print('正在运行的服务会在重启电脑后停止；也可以在任务管理器里结束 pythonw.exe。')
    return 0


def print_urls(port):
    ips = lan_ips()
    print('\n================ 桂亭 · 局域网点餐 ================')
    if not ips:
        print('  未检测到局域网地址，请检查网络连接')
    for ip in ips:
        base = 'http://%s:%d' % (ip, port)
        print('  点餐页（iPad / 手机）：%s/' % base)
        print('  订单看板：          %s/orders.html' % base)
        print('  菜单后台：          %s/admin.html' % base)
    print('==================================================\n')


# ---------------------------------------------------------------- 入口

def setup_logging():
    ensure_dirs()
    log.setLevel(logging.INFO)
    fh = logging.handlers.RotatingFileHandler(LOG_FILE, maxBytes=1024 * 1024, backupCount=3, encoding='utf-8')
    fh.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    log.addHandler(fh)
    if sys.stdout:
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(logging.Formatter('%(asctime)s %(message)s', '%H:%M:%S'))
        log.addHandler(sh)


def main(argv):
    if sys.stdout is None:  # pythonw 没有控制台
        sys.stdout = sys.stderr = open(os.devnull, 'w')
    setup_logging()
    if '--setup' in argv:
        setup_interactive(force=True)
        return 0
    if '--install' in argv:
        return windows_install()
    if '--uninstall' in argv:
        return windows_uninstall()

    global SESSIONS, CONFIG
    migrate_menu()
    CONFIG = ensure_config()
    SESSIONS = Sessions()
    port = int(CONFIG.get('port') or DEFAULT_PORT)
    if '--port' in argv:
        port = int(argv[argv.index('--port') + 1])

    httpd = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    httpd.daemon_threads = True
    log.info('服务已启动，端口 %d', port)
    print_urls(port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
