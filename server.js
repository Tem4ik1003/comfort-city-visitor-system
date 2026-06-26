import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbQueries } from './database.js';
import eventEmitter from './events.js';
import bot from './bot.js'; // Запускає бота паралельно і імпортує його інстанс

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// Дозволяємо CORS для розробки (оскільки React може бути на іншому порту)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// API: Отримати всі заявки (для панелі охорони)
app.get('/api/visits', (req, res) => {
  try {
    const visits = dbQueries.getAllVisits();
    res.json(visits);
  } catch (error) {
    console.error('Помилка отримання заявок:', error);
    res.status(500).json({ error: 'Помилка бази даних' });
  }
});

// API: Отримати список усіх квартир
app.get('/api/apartments', (req, res) => {
  try {
    const apartments = dbQueries.getAllApartments();
    res.json(apartments);
  } catch (error) {
    console.error('Помилка отримання квартир:', error);
    res.status(500).json({ error: 'Помилка бази даних' });
  }
});

// API: Отримати всіх користувачів
app.get('/api/users', (req, res) => {
  try {
    const users = dbQueries.getAllUsers();
    res.json(users);
  } catch (error) {
    console.error('Помилка отримання користувачів:', error);
    res.status(500).json({ error: 'Помилка бази даних' });
  }
});

// API: Створити користувача
app.post('/api/users', (req, res) => {
  const { telegramId, name } = req.body;
  if (!telegramId || !name) {
    return res.status(400).json({ error: 'Відсутні обов\'язкові поля' });
  }
  try {
    const userId = dbQueries.createUserDirectly(parseInt(telegramId), name);
    res.json({ success: true, id: userId });
  } catch (error) {
    console.error('Помилка створення користувача:', error);
    res.status(500).json({ error: 'Помилка бази даних (можливо, такий Telegram ID вже існує)' });
  }
});

// API: Створити квартиру
app.post('/api/apartments', (req, res) => {
  const { section, number } = req.body;
  if (!section || !number) {
    return res.status(400).json({ error: 'Відсутні обов\'язкові поля' });
  }
  try {
    const aptId = dbQueries.createApartment(`Секція ${section}`, number);
    res.json({ success: true, id: aptId });
  } catch (error) {
    console.error('Помилка створення квартири:', error);
    res.status(500).json({ error: 'Помилка бази даних (можливо, така квартира вже існує)' });
  }
});

// API: Отримати зв'язки мешканців з квартирами
app.get('/api/user-apartments', (req, res) => {
  try {
    const links = dbQueries.getUserApartmentLinks();
    res.json(links);
  } catch (error) {
    console.error('Помилка отримання зв\'язків:', error);
    res.status(500).json({ error: 'Помилка бази даних' });
  }
});

// API: Створити зв'язок мешканця з квартирою
app.post('/api/user-apartments', (req, res) => {
  const { userId, apartmentId } = req.body;
  if (!userId || !apartmentId) {
    return res.status(400).json({ error: 'Відсутні обов\'язкові поля' });
  }
  try {
    dbQueries.linkUserToApartment(parseInt(userId), parseInt(apartmentId));
    res.json({ success: true });
  } catch (error) {
    console.error('Помилка створення зв\'язку:', error);
    res.status(500).json({ error: 'Помилка бази даних' });
  }
});

// API: Видалити зв'язок мешканця з квартирою
app.delete('/api/user-apartments', (req, res) => {
  const { userId, apartmentId } = req.body;
  if (!userId || !apartmentId) {
    return res.status(400).json({ error: 'Відсутні обов\'язкові поля' });
  }
  try {
    dbQueries.unlinkUserFromApartment(parseInt(userId), parseInt(apartmentId));
    res.json({ success: true });
  } catch (error) {
    console.error('Помилка видалення зв\'язку:', error);
    res.status(500).json({ error: 'Помилка бази даних' });
  }
});

// Словники для перекладу типів гостей у повідомленнях
const visitorTypes = {
  courier: "🛵 Кур'єр / Доставка",
  guest: '👥 Гість',
  master: '🛠️ Майстер',
  nanny: '👶 Няня',
  other: '❓ Інше'
};

// API: Створити ручну заявку охорони (відвідувач одразу всередині)
app.post('/api/visits/manual', (req, res) => {
  const { apartmentId, visitorType, visitorName } = req.body;

  if (!apartmentId || !visitorType || !visitorName) {
    return res.status(400).json({ error: 'Відсутні обов\'язкові поля' });
  }

  try {
    dbQueries.createVisit(
      parseInt(apartmentId),
      visitorType,
      visitorName,
      'now', // expected time
      null, // custom time
      1, // is_manual
      'inside' // status
    );

    // Сповіщаємо всі підключені SSE клієнти
    eventEmitter.emit('visit_change');

    // Відправляємо сповіщення в телеграм бот мешканцям
    const telegramIds = dbQueries.getTelegramIdsForApartment(parseInt(apartmentId));
    const typeLabel = visitorTypes[visitorType] || visitorType;
    const text = `🔔 *Повідомлення охорони:*\nОхорона зареєструвала відвідувача *${visitorName}* (${typeLabel}), він зайшов на територію комплексу.`;
    
    telegramIds.forEach(tgId => {
      bot.telegram.sendMessage(tgId, text, { parse_mode: 'Markdown' }).catch(err => {
        console.error('Помилка надсилання сповіщення:', err);
      });
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Помилка створення ручної заявки:', error);
    res.status(500).json({ error: 'Помилка бази даних' });
  }
});

// API: Змінити статус заявки (прийняти / відхилити / вхід / вихід)
app.post('/api/visits/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'approved', 'rejected', 'inside', 'completed'

  if (!['approved', 'rejected', 'pending', 'inside', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Некоректний статус' });
  }

  try {
    // Отримуємо інформацію про візит до оновлення
    const visit = dbQueries.getVisitById(parseInt(id));

    dbQueries.updateVisitStatus(parseInt(id), status);
    
    // Сповіщаємо всі підключені SSE клієнти
    eventEmitter.emit('visit_change');

    // Відправляємо сповіщення в телеграм бот мешканцям квартири
    if (visit && (status === 'inside' || status === 'completed')) {
      const telegramIds = dbQueries.getTelegramIdsForApartment(visit.apartment_id);
      const typeLabel = visitorTypes[visit.visitor_type] || visit.visitor_type;
      
      let text = '';
      if (status === 'inside') {
        text = `🔔 *Повідомлення охорони:*\n👤 Відвідувач *${visit.visitor_name}* (${typeLabel}) зайшов на територію комплексу.`;
      } else if (status === 'completed') {
        text = `🔔 *Повідомлення охорони:*\n👤 Відвідувач *${visit.visitor_name}* (${typeLabel}) залишив територію комплексу.`;
      }

      if (text) {
        telegramIds.forEach(tgId => {
          bot.telegram.sendMessage(tgId, text, { parse_mode: 'Markdown' }).catch(err => {
            console.error(`Помилка надсилання сповіщення користувачу ${tgId}:`, err);
          });
        });
      }
    }
    
    res.json({ success: true, id, status });
  } catch (error) {
    console.error('Помилка оновлення статусу:', error);
    res.status(500).json({ error: 'Помилка оновлення бази даних' });
  }
});

// API: Server-Sent Events (SSE) для миттєвого оновлення інтерфейсу охорони
app.get('/api/visits/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const onVisitChange = () => {
    res.write(`data: ${JSON.stringify({ update: true })}\n\n`);
  };

  eventEmitter.on('visit_change', onVisitChange);

  // Відправляємо перше повідомлення про успішне підключення
  res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);

  req.on('close', () => {
    eventEmitter.off('visit_change', onVisitChange);
  });
});

// API: Налаштування
app.get('/api/settings', (req, res) => {
  try {
    res.json(dbQueries.getSettings());
  } catch (error) {
    res.status(500).json({ error: 'Помилка бази даних' });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const { auto_delete_days } = req.body;
    if (auto_delete_days !== undefined) {
      dbQueries.updateSetting('auto_delete_days', auto_delete_days.toString());
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Помилка бази даних' });
  }
});

// Фонове завдання для видалення старих заявок (кожні 1 годину)
setInterval(() => {
  try {
    dbQueries.deleteOldVisits();
    eventEmitter.emit('visit_change');
  } catch (e) {
    console.error('Помилка авто-видалення:', e);
  }
}, 60 * 60 * 1000);

// Запуск один раз при старті
setTimeout(() => {
  try { dbQueries.deleteOldVisits(); } catch (e) {}
}, 5000);

// Роздача статичних файлів React у продакшні
const frontendDist = path.resolve(__dirname, 'frontend/dist');
app.use(express.static(frontendDist));

app.get('*', (req, res) => {
  // Якщо запит не до API, віддаємо React-додаток
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(frontendDist, 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📡 Сервер запущено на порту ${PORT}`);
  console.log(`🔗 Локально:        http://localhost:${PORT}`);
  console.log(`🌐 В локальній мережі: http://192.168.31.37:${PORT}`);
});
