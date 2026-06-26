import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, 'safehome.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Ініціалізація таблиць
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE,
    phone TEXT,
    name TEXT,
    role TEXT DEFAULT 'resident' -- 'resident', 'guard', 'admin'
  );

  CREATE TABLE IF NOT EXISTS apartments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section TEXT NOT NULL,
    number TEXT NOT NULL,
    UNIQUE(section, number)
  );

  CREATE TABLE IF NOT EXISTS user_apartments (
    user_id INTEGER,
    apartment_id INTEGER,
    PRIMARY KEY (user_id, apartment_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (apartment_id) REFERENCES apartments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    apartment_id INTEGER,
    visitor_type TEXT, -- 'courier', 'guest', 'master', 'nanny', 'other'
    visitor_name TEXT,
    expected_time TEXT, -- 'now', 'today', 'tomorrow', 'custom'
    custom_time TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    resolved_by INTEGER,
    FOREIGN KEY (apartment_id) REFERENCES apartments(id),
    FOREIGN KEY (resolved_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_delete_days', '2');
`);

// Міграція для додавання колонки is_manual
try {
  db.exec("ALTER TABLE visits ADD COLUMN is_manual INTEGER DEFAULT 0");
} catch (e) {
  // Колонка вже існує
}

// Додавання тестових даних
const insertApartment = db.prepare('INSERT OR IGNORE INTO apartments (section, number) VALUES (?, ?)');
const findApartment = db.prepare('SELECT id FROM apartments WHERE section = ? AND number = ?');

insertApartment.run('Секція 4', '125');
insertApartment.run('Секція 2', '45');
insertApartment.run('Секція 8', '302');

// Допоміжні функції для роботи з БД
export const dbQueries = {
  // Отримати або створити користувача
  getOrCreateUser: (telegramId, name = 'Користувач') => {
    let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    
    if (!user) {
      const info = db.prepare('INSERT INTO users (telegram_id, name, role) VALUES (?, ?, ?)').run(telegramId, name, 'resident');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    }
    return user;
  },

  // Спробувати прив'язати квартиру (з перевіркою на унікальність)
  tryLinkApartmentForUser: (userId, section, number) => {
    // Шукаємо або створюємо квартиру
    let apt = db.prepare('SELECT * FROM apartments WHERE section = ? AND number = ?').get(section, number);
    if (!apt) {
      const info = db.prepare('INSERT INTO apartments (section, number) VALUES (?, ?)').run(section, number);
      apt = { id: info.lastInsertRowid, section, number };
    }
    
    // Перевіряємо чи хтось вже прив'язаний до цієї квартири
    const existingLink = db.prepare('SELECT * FROM user_apartments WHERE apartment_id = ?').get(apt.id);
    if (existingLink && existingLink.user_id !== userId) {
      return { success: false, error: 'already_taken' };
    }
    
    // Прив'язуємо
    db.prepare('INSERT OR IGNORE INTO user_apartments (user_id, apartment_id) VALUES (?, ?)').run(userId, apt.id);
    return { success: true };
  },

  // Отримати квартири користувача
  getUserApartments: (telegramId) => {
    return db.prepare(`
      SELECT a.* FROM apartments a
      JOIN user_apartments ua ON ua.apartment_id = a.id
      JOIN users u ON u.id = ua.user_id
      WHERE u.telegram_id = ?
    `).all(telegramId);
  },

  // Створити заявку на візит
  createVisit: (apartmentId, type, name, time, customTime = null, isManual = 0, status = 'pending') => {
    const resolvedAt = status === 'inside' ? new Date().toISOString() : null;
    const info = db.prepare(`
      INSERT INTO visits (apartment_id, visitor_type, visitor_name, expected_time, custom_time, is_manual, status, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(apartmentId, type, name, time, customTime, isManual, status, resolvedAt);
    return info.lastInsertRowid;
  },

  // Отримати активні заявки користувача
  getUserVisits: (telegramId) => {
    return db.prepare(`
      SELECT v.*, a.section, a.number FROM visits v
      JOIN apartments a ON a.id = v.apartment_id
      JOIN user_apartments ua ON ua.apartment_id = a.id
      JOIN users u ON u.id = ua.user_id
      WHERE u.telegram_id = ?
      ORDER BY v.created_at DESC
      LIMIT 10
    `).all(telegramId);
  },

  // Отримати всі заявки для панелі охорони
  getAllVisits: () => {
    return db.prepare(`
      SELECT v.*, a.section, a.number, GROUP_CONCAT(u.name, ', ') as resident_name FROM visits v
      JOIN apartments a ON a.id = v.apartment_id
      LEFT JOIN user_apartments ua ON ua.apartment_id = a.id
      LEFT JOIN users u ON u.id = ua.user_id
      GROUP BY v.id
      ORDER BY v.created_at DESC
    `).all();
  },

  // Змінити статус заявки (для охорони)
  updateVisitStatus: (visitId, status, guardId = null) => {
    return db.prepare(`
      UPDATE visits 
      SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
      WHERE id = ?
    `).run(status, guardId, visitId);
  },

  // Скасувати заявку (для мешканця)
  cancelVisit: (visitId) => {
    return db.prepare(`
      UPDATE visits 
      SET status = 'cancelled', resolved_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).run(visitId);
  },

  // Отримати заявку за ID
  getVisitById: (id) => {
    return db.prepare('SELECT * FROM visits WHERE id = ?').get(id);
  },

  // Отримати Telegram ID мешканців квартири
  getTelegramIdsForApartment: (apartmentId) => {
    return db.prepare(`
      SELECT u.telegram_id FROM users u
      JOIN user_apartments ua ON ua.user_id = u.id
      WHERE ua.apartment_id = ?
    `).all(apartmentId).map(row => row.telegram_id);
  },

  // Отримати всі квартири
  getAllApartments: () => {
    return db.prepare('SELECT * FROM apartments ORDER BY section, CAST(number AS INTEGER)').all();
  },

  // Отримати всіх користувачів (мешканців)
  getAllUsers: () => {
    return db.prepare('SELECT * FROM users ORDER BY name').all();
  },

  // Отримати всі зв'язки мешканців з квартирами
  getUserApartmentLinks: () => {
    return db.prepare(`
      SELECT ua.user_id, ua.apartment_id, u.name as user_name, u.telegram_id, a.section, a.number
      FROM user_apartments ua
      JOIN users u ON ua.user_id = u.id
      JOIN apartments a ON ua.apartment_id = a.id
      ORDER BY u.name, a.section, CAST(a.number AS INTEGER)
    `).all();
  },

  // Зв'язати мешканця з квартирою
  linkUserToApartment: (userId, apartmentId) => {
    return db.prepare(`
      INSERT OR IGNORE INTO user_apartments (user_id, apartment_id)
      VALUES (?, ?)
    `).run(userId, apartmentId);
  },

  // Розірвати зв'язок мешканця з квартирою
  unlinkUserFromApartment: (userId, apartmentId) => {
    return db.prepare(`
      DELETE FROM user_apartments
      WHERE user_id = ? AND apartment_id = ?
    `).run(userId, apartmentId);
  },

  // Створити квартиру
  createApartment: (section, number) => {
    const info = db.prepare(`
      INSERT INTO apartments (section, number)
      VALUES (?, ?)
    `).run(section, number);
    return info.lastInsertRowid;
  },

  // Створити користувача напряму
  createUserDirectly: (telegramId, name) => {
    const info = db.prepare(`
      INSERT INTO users (telegram_id, name)
      VALUES (?, ?)
    `).run(telegramId, name);
    return info.lastInsertRowid;
  },

  getSettings: () => {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    return settings;
  },

  updateSetting: (key, value) => {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key);
  },

  deleteOldVisits: () => {
    const days = dbQueries.getSettings().auto_delete_days || 2;
    return db.prepare(`DELETE FROM visits WHERE created_at < datetime('now', '-${days} days')`).run();
  }
};

export default db;
