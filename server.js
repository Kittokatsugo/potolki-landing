require('dotenv').config();

const express = require('express');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const DB = require('./db.js');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');

/* =========================================================
   Почта — из .env, никогда из кода
   ========================================================= */
const SMTP = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || 'true') === 'true',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
};
const MAIL_TO = process.env.MAIL_TO || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP.user;
const mailReady = Boolean(SMTP.host && SMTP.user && SMTP.pass && MAIL_TO);

const transporter = mailReady
  ? nodemailer.createTransport({
      host: SMTP.host, port: SMTP.port, secure: SMTP.secure,
      auth: { user: SMTP.user, pass: SMTP.pass },
    })
  : null;

/* =========================================================
   Парсеры: битый JSON → честный 400, без стектрейса
   ========================================================= */
app.use((req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('application/json')) {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 32 * 1024) { req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) { req.body = {}; return next(); }
      try {
        req.body = JSON.parse(raw);
      } catch (e) {
        return res.status(400).json({ ok: false, error: 'Некорректный формат данных' });
      }
      next();
    });
    return;
  }
  next();
});
app.use(express.urlencoded({ extended: true, limit: '16kb' }));

// Никогда не отдаём пользователю стектрейсы
function fail(res, code, msg) {
  res.status(code).json({ ok: false, error: msg });
}

/* =========================================================
   Rate limit по IP
   ========================================================= */
const rate = new Map();
const RATE_WINDOW = 10 * 60 * 1000;
const RATE_MAX = Number(process.env.RATE_MAX || 5);

function rateLimited(ip, max = RATE_MAX) {
  const now = Date.now();
  const arr = (rate.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  arr.push(now);
  rate.set(ip, arr);
  return arr.length > max;
}

function clientIp(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || req.socket.remoteAddress || 'unknown';
}

function esc(s) {
  return String(s ?? '').slice(0, 500)
    .replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('8')) d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d;
}
function isValidPhone(raw) {
  const d = normalizePhone(raw);
  return d.length === 11 && d.startsWith('7');
}
function fmtPhone(raw) {
  const d = normalizePhone(raw);
  return d.length === 11
    ? `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`
    : raw;
}

/* =========================================================
   Куки (без зависимостей)
   ========================================================= */
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

const SESSION_COOKIE = 'pp_admin';

function getSession(req) {
  return parseCookies(req)[SESSION_COOKIE] || null;
}

/* =========================================================
   Админ: пароль
   Инициализация: если пароля нет — берём из ADMIN_PASSWORD или
   генерируем и пишем в data/admin-password.txt (один раз).
   ========================================================= */
function adminPasswordHash() {
  let hash = DB.getSetting('admin_password_hash');
  if (hash) return hash;

  let pwd = process.env.ADMIN_PASSWORD;
  if (!pwd) {
    pwd = crypto.randomBytes(9).toString('base64url');
    const f = path.join(__dirname, 'data', 'admin-password.txt');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `Логин: admin\nПароль: ${pwd}\n\nАдминка: /admin\nСмените пароль после первого входа.\n`, 'utf8');
    console.log('\n=== СГЕНЕРИРОВАН ПАРОЛЬ АДМИНКИ ===');
    console.log('Логин: admin');
    console.log('Пароль: ' + pwd);
    console.log('Сохранён в data/admin-password.txt\n');
  }
  hash = bcrypt.hashSync(pwd, 10);
  DB.setSetting('admin_password_hash', hash);
  return hash;
}

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';

function requireAuth(req, res, next) {
  if (DB.validSession(getSession(req))) return next();
  if (req.path.startsWith('/api/')) return fail(res, 401, 'Требуется вход');
  return res.redirect('/admin/login');
}

/* =========================================================
   ПУБЛИЧНОЕ API
   ========================================================= */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, mail: mailReady });
});

app.post('/api/lead', async (req, res) => {
  const ip = clientIp(req);
  if (rateLimited(ip)) return fail(res, 429, 'Слишком много заявок. Попробуйте позже.');

  const name = (req.body?.name || '').trim().slice(0, 120);
  const phoneRaw = String(req.body?.phone || '').trim();
  const source = (req.body?.source || '').trim().slice(0, 80);
  const calc = (req.body?.calc || '').trim().slice(0, 300);

  if (!isValidPhone(phoneRaw)) return fail(res, 400, 'Некорректный телефон');

  const phone = fmtPhone(phoneRaw);

  // 1) ВСЕГДА сохраняем в базу — это главный источник правды
  let saved;
  try {
    saved = DB.addLead({
      name, phone, source, calc,
      area: req.body?.area || null,
      type: req.body?.type || null,
      lights: req.body?.lights || null,
      ip,
    });
  } catch (e) {
    console.error('[LEAD] Ошибка записи в базу:', e.message);
    return fail(res, 500, 'Не удалось сохранить заявку');
  }

  // 2) Письмо — как страховка (если настроено)
  if (mailReady) {
    const digits = normalizePhone(phoneRaw);
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">
        <h2 style="margin:0 0 16px">Новая заявка #${saved.id}</h2>
        <table cellpadding="6" style="border-collapse:collapse">
          <tr><td style="color:#64748b">Имя</td><td><b>${esc(name) || '—'}</b></td></tr>
          <tr><td style="color:#64748b">Телефон</td><td><b style="font-size:17px">${phone}</b></td></tr>
          <tr><td style="color:#64748b">Откуда</td><td>${esc(source) || '—'}</td></tr>
          ${calc ? `<tr><td style="color:#64748b">Расчёт</td><td>${esc(calc)}</td></tr>` : ''}
          <tr><td style="color:#64748b">Время</td><td>${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)</td></tr>
        </table>
        <p style="margin-top:20px">
          <a href="tel:+${digits}" style="background:#ff6b35;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Позвонить клиенту</a>
        </p>
      </div>`;

    transporter.sendMail({
      from: `"Сайт ПотолокПро" <${MAIL_FROM}>`,
      to: MAIL_TO,
      replyTo: MAIL_FROM,
      subject: `Заявка #${saved.id}: ${name || 'без имени'} — ${phone}`,
      text: `Новая заявка #${saved.id}\nИмя: ${name || '—'}\nТелефон: ${phone}\nОткуда: ${source || '—'}\n${calc ? 'Расчёт: ' + calc + '\n' : ''}`,
      html,
    }).then(() => console.log(`[LEAD] #${saved.id} письмо отправлено`))
      .catch(e => console.error(`[LEAD] #${saved.id} письмо не ушло:`, e.message));
  }

  res.json({ ok: true, id: saved.id });
});

/* =========================================================
   АДМИНКА: авторизация
   ========================================================= */
adminPasswordHash(); // инициализация при старте
DB.cleanSessions();

app.get('/admin/login', (req, res) => {
  if (DB.validSession(getSession(req))) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'admin-login.html'));
});

app.post('/api/admin/login', (req, res) => {
  const ip = clientIp(req);
  if (rateLimited(ip, 10)) return fail(res, 429, 'Слишком много попыток. Подождите 10 минут.');

  const login = String(req.body?.login || '').trim();
  const password = String(req.body?.password || '');

  const hash = adminPasswordHash();
  const loginOk = login.toLowerCase() === ADMIN_LOGIN.toLowerCase();
  const passOk = bcrypt.compareSync(password, hash);

  if (!loginOk || !passOk) return fail(res, 401, 'Неверный логин или пароль');

  const sid = crypto.randomBytes(32).toString('hex');
  DB.createSession(sid, 72);

  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 72 * 3600 * 1000,
    path: '/',
  });
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  const sid = getSession(req);
  if (sid) DB.deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

/* =========================================================
   АДМИНКА: данные
   ========================================================= */
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/admin/leads', requireAuth, (req, res) => {
  const status = ['all', 'new', 'in_progress', 'done', 'rejected'].includes(req.query.status)
    ? req.query.status : 'all';
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { rows, total } = DB.listLeads({ status, limit, offset });
  res.json({ ok: true, rows, total });
});

app.post('/api/admin/leads/:id/status', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '');
  if (!Number.isInteger(id)) return fail(res, 400, 'Неверный id');
  if (!DB.setLeadStatus(id, status)) return fail(res, 400, 'Неверный статус');
  res.json({ ok: true });
});

app.post('/api/admin/leads/:id/comment', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, 'Неверный id');
  DB.setLeadComment(id, String(req.body?.comment || ''));
  res.json({ ok: true });
});

app.get('/api/admin/stats', requireAuth, (req, res) => {
  res.json({ ok: true, ...DB.stats() });
});

/* =========================================================
   Статика
   ========================================================= */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const BLOCKED = /^\/(\.env|\.git|node_modules|package|data|serve\.cjs|server\.js|db\.js|e2e\.mjs|convert\.mjs|diag\.mjs|check\.mjs|shot\.mjs|shot2\.mjs|drag\.mjs|admine2e\.mjs|screens|img\/raw)/;

app.use((req, res, next) => {
  let rel = decodeURIComponent(req.path);
  if (rel === '/') rel = '/index.html';
  if (BLOCKED.test(rel)) return res.status(404).end();

  const fp = path.join(__dirname, rel);
  if (!fp.startsWith(__dirname)) return res.status(403).end();

  fs.readFile(fp, (err, data) => {
    if (err) return next();
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream',
      'Cache-Control': rel.endsWith('.html') ? 'no-cache' : 'public, max-age=86400',
    });
    res.end(data);
  });
});

app.use((req, res) => res.status(404).send('404'));

/* =========================================================
   Глобальный обработчик ошибок: без стектрейсов наружу
   ========================================================= */
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  if (res.headersSent) return;
  fail(res, 500, 'Внутренняя ошибка сервера');
});

process.on('uncaughtException', (e) => console.error('[UNCAUGHT]', e.message));
process.on('unhandledRejection', (e) => console.error('[UNHANDLED]', e?.message || e));

app.listen(PORT, () => {
  console.log(`Server on http://127.0.0.1:${PORT}`);
  console.log(`Админка: http://127.0.0.1:${PORT}/admin`);
  console.log(`Почта: ${mailReady ? 'настроена → ' + MAIL_TO : 'НЕ настроена (заявки копятся в админке)'}`);
});
