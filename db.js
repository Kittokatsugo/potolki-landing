const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'leads.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS leads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    name        TEXT,
    phone       TEXT NOT NULL,
    source      TEXT,
    calc        TEXT,
    area        TEXT,
    type        TEXT,
    lights      TEXT,
    status      TEXT NOT NULL DEFAULT 'new',
    comment     TEXT,
    ip          TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
`);

/* ---------- Заявки ---------- */
function addLead(d) {
  const stmt = db.prepare(`
    INSERT INTO leads (name, phone, source, calc, area, type, lights, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    d.name || null, d.phone, d.source || null, d.calc || null,
    d.area || null, d.type || null, d.lights || null, d.ip || null
  );
  return { id: Number(info.lastInsertRowid) };
}

function listLeads({ status = 'all', limit = 100, offset = 0 } = {}) {
  const where = status === 'all' ? '' : 'WHERE status = ?';
  const args = status === 'all' ? [] : [status];
  const rows = db.prepare(
    `SELECT * FROM leads ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...args, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM leads ${where}`).get(...args).c;
  return { rows, total };
}

function setLeadStatus(id, status) {
  const allowed = ['new', 'in_progress', 'done', 'rejected'];
  if (!allowed.includes(status)) return false;
  db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, id);
  return true;
}

function setLeadComment(id, comment) {
  db.prepare('UPDATE leads SET comment = ? WHERE id = ?').run(String(comment || '').slice(0, 1000), id);
  return true;
}

function stats() {
  const total = db.prepare('SELECT COUNT(*) AS c FROM leads').get().c;
  const today = db.prepare(
    "SELECT COUNT(*) AS c FROM leads WHERE date(created_at) = date('now')"
  ).get().c;
  const week = db.prepare(
    "SELECT COUNT(*) AS c FROM leads WHERE created_at >= datetime('now','-7 days')"
  ).get().c;
  const byStatus = db.prepare(
    'SELECT status, COUNT(*) AS c FROM leads GROUP BY status'
  ).all();
  return { total, today, week, byStatus };
}

/* ---------- Настройки ---------- */
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

/* ---------- Сессии ---------- */
function createSession(id, ttlHours = 72) {
  db.prepare("INSERT INTO sessions (id, expires_at) VALUES (?, datetime('now', ?))")
    .run(id, `+${ttlHours} hours`);
}
function validSession(id) {
  if (!id) return false;
  const row = db.prepare("SELECT id FROM sessions WHERE id = ? AND expires_at > datetime('now')").get(id);
  return Boolean(row);
}
function deleteSession(id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}
function cleanSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

module.exports = {
  db,
  addLead, listLeads, setLeadStatus, setLeadComment, stats,
  getSetting, setSetting,
  createSession, validSession, deleteSession, cleanSessions,
};
