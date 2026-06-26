import { Telegraf, Markup } from 'telegraf';
import { dbQueries } from './database.js';
import dotenv from 'dotenv';
import eventEmitter from './events.js';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('⚠️ Помилка: TELEGRAM_BOT_TOKEN не знайдено в файлі .env!');
}

const bot = new Telegraf(token || 'DUMMY_TOKEN');

// Сесії для покрокового створення заявок
// У пам'яті: { [userId]: { step: string, data: object } }
const sessions = {};

// Сесії для реєстрації нових мешканців
const registrationSessions = {};

// Словники для перекладу
const visitorTypes = {
  courier: "🛵 Кур'єр / доставка",
  guest: '👥 Гість',
  master: '🛠️ Майстер',
  nanny: '👶 Няня',
  other: '❓ Інше'
};

const visitTimes = {
  now: 'Зараз / протягом години',
  today: 'Сьогодні',
  tomorrow: 'Завтра',
  custom: 'Обрати дату і час'
};

// Головне меню
const mainKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🆕 Створити заявку', 'menu_create')],
  [Markup.button.callback('📋 Мої заявки', 'menu_list')],
  [Markup.button.callback('ℹ️ Допомога', 'menu_help')]
]);

// Стартова команда
bot.start((ctx) => {
  const userId = ctx.from.id;
  const name = ctx.from.first_name || 'Користувач';
  dbQueries.getOrCreateUser(userId, name);
  
  const apts = dbQueries.getUserApartments(userId);
  if (apts.length === 0) {
    registrationSessions[userId] = { step: 'ask_section' };
    
    const buttons = [];
    let row = [];
    for(let i=1; i<=12; i++) {
      row.push(Markup.button.callback(`Секція ${i}`, `reg_sec:${i}`));
      if(row.length === 3) { buttons.push(row); row = []; }
    }
    if(row.length > 0) buttons.push(row);
    buttons.push([Markup.button.callback(`Таунхауси`, `reg_sec:13`)]);
    
    ctx.reply(
      'Вітаємо у боті Comfort City! 🏢\nДля початку роботи оберіть вашу секцію:',
      Markup.inlineKeyboard(buttons)
    );
  } else {
    ctx.reply(`Вітаємо у боті Comfort City.\nОберіть дію:`, mainKeyboard);
  }
});

// Обробка вибору секції при реєстрації
bot.action(/^reg_sec:(\d+)$/, (ctx) => {
  ctx.answerCbQuery();
  const userId = ctx.from.id;
  const sectionId = parseInt(ctx.match[1], 10);
  const section = sectionId === 13 ? 'Таунхауси' : `Секція ${sectionId}`;
  
  registrationSessions[userId] = { step: 'ask_number', section };
  ctx.reply(`Ви обрали: *${section}*.\nТепер надішліть номер вашої квартири (тільки цифри):`, { parse_mode: 'Markdown' });
});

// Кнопка Допомога
bot.action('menu_help', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(
    `🤖 Цей бот створений для швидкого оформлення перепусток для відвідувачів ЖК.\n\n` +
    `• Ви можете створити заявку на гостя, кур'єра або майстра.\n` +
    `• Охорона побачить вашу заявку миттєво в системі.\n` +
    `• Кнопка "Мої заявки" покаже статус поточних перепусток.`,
    Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад до меню', 'go_to_menu')]])
  );
});

// Повернення до меню
bot.action('go_to_menu', (ctx) => {
  ctx.answerCbQuery();
  // Очищаємо сесію
  delete sessions[ctx.from.id];
  ctx.reply(`Вітаємо у боті Comfort City.\nОберіть дію:`, mainKeyboard);
});

// Перегляд заявок
bot.action('menu_list', (ctx) => {
  ctx.answerCbQuery();
  const visits = dbQueries.getUserVisits(ctx.from.id);

  if (visits.length === 0) {
    return ctx.reply(
      'У вас немає активних або нещодавніх заявок.',
      Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад до меню', 'go_to_menu')]])
    );
  }

  let message = '📋 *Ваші нещодавні заявки:*\n\n';
  const buttons = [];

  visits.forEach((v, index) => {
    let statusEmoji = '⏳';
    let statusText = 'Очікує';
    if (v.status === 'approved') {
      statusEmoji = '✅';
      statusText = 'Дозволено';
    } else if (v.status === 'rejected') {
      statusEmoji = '❌';
      statusText = 'Відхилено';
    } else if (v.status === 'cancelled') {
      statusEmoji = '❌';
      statusText = 'Скасовано';
    }

    const type = visitorTypes[v.visitor_type] || v.visitor_type;
    const time = v.expected_time === 'custom' ? v.custom_time : visitTimes[v.expected_time];

    message += `${index + 1}. *${v.visitor_name}* (${type})\n`;
    message += `   📍 ${v.section}, кв. ${v.number}\n`;
    message += `   🕒 Час: ${time}\n`;
    message += `   Статус: ${statusEmoji} *${statusText}*\n\n`;

    if (v.status === 'pending') {
      buttons.push([Markup.button.callback(`❌ Скасувати №${index + 1}`, `cancel:${v.id}`)]);
    }
  });

  buttons.push([Markup.button.callback('◀️ Назад до меню', 'go_to_menu')]);

  ctx.replyWithMarkdown(
    message,
    Markup.inlineKeyboard(buttons)
  );
});

// Скасування заявки користувачем
bot.action(/^cancel:(\d+)$/, (ctx) => {
  ctx.answerCbQuery();
  const visitId = parseInt(ctx.match[1]);

  dbQueries.cancelVisit(visitId);
  eventEmitter.emit('visit_change');

  ctx.reply('❌ Заявку успішно скасовано.', mainKeyboard);
});

// Початок створення заявки
bot.action('menu_create', (ctx) => {
  ctx.answerCbQuery();
  const userId = ctx.from.id;
  const apartments = dbQueries.getUserApartments(userId);

  if (apartments.length === 0) {
    return ctx.reply('У вас ще не налаштована квартира. Натисніть /start щоб пройти реєстрацію.');
  }

  sessions[userId] = {
    step: 'choose_apartment',
    data: {}
  };

  // Якщо квартира одна - пропускаємо вибір
  if (apartments.length === 1) {
    sessions[userId].data.apartmentId = apartments[0].id;
    sessions[userId].data.apartmentLabel = `${apartments[0].section}, кв. ${apartments[0].number}`;
    return askVisitorType(ctx);
  }

  // Якщо квартир кілька - пропонуємо вибір
  const buttons = apartments.map(apt => [
    Markup.button.callback(`${apt.section}, кв. ${apt.number}`, `apt:${apt.id}`)
  ]);
  buttons.push([Markup.button.callback('❌ Скасувати', 'go_to_menu')]);

  ctx.reply('Оберіть квартиру:', Markup.inlineKeyboard(buttons));
});

// Обробка вибору квартири
bot.action(/^apt:(\d+)$/, (ctx) => {
  ctx.answerCbQuery();
  const userId = ctx.from.id;
  const aptId = parseInt(ctx.match[1]);

  if (!sessions[userId]) return ctx.reply('Сесію втрачено. Спробуйте знову.', mainKeyboard);

  const apartments = dbQueries.getUserApartments(userId);
  const selectedApt = apartments.find(a => a.id === aptId);

  if (selectedApt) {
    sessions[userId].data.apartmentId = selectedApt.id;
    sessions[userId].data.apartmentLabel = `${selectedApt.section}, кв. ${selectedApt.number}`;
    if (sessions[userId].isEditing) {
      showConfirmation(ctx, userId);
    } else {
      askVisitorType(ctx);
    }
  }
});

// Запит типу відвідувача
function askVisitorType(ctx) {
  const userId = ctx.from.id;
  sessions[userId].step = 'choose_type';

  const buttons = [
    [Markup.button.callback(visitorTypes.courier, 'type:courier')],
    [Markup.button.callback(visitorTypes.guest, 'type:guest')],
    [Markup.button.callback(visitorTypes.master, 'type:master')],
    [Markup.button.callback(visitorTypes.nanny, 'type:nanny')],
    [Markup.button.callback(visitorTypes.other, 'type:other')],
    [Markup.button.callback('❌ Скасувати', 'go_to_menu')]
  ];

  ctx.reply('Хто до вас прийде?', Markup.inlineKeyboard(buttons));
}

// Обробка типу відвідувача
bot.action(/^type:(\w+)$/, (ctx) => {
  ctx.answerCbQuery();
  const userId = ctx.from.id;
  const type = ctx.match[1];

  if (!sessions[userId]) return ctx.reply('Сесію втрачено. Спробуйте знову.', mainKeyboard);

  sessions[userId].data.visitorType = type;
  if (sessions[userId].isEditing) {
    showConfirmation(ctx, userId);
  } else {
    sessions[userId].step = 'waiting_for_name';
    ctx.reply("Вкажіть ім'я або опис відвідувача:\n(Наприклад: Кур'єр Glovo)");
  }
});

// Обробка текстового вводу (Ім'я або власна дата)
bot.on('text', (ctx) => {
  const userId = ctx.from.id;
  
  // Перевірка на етап реєстрації
  if (registrationSessions[userId] && registrationSessions[userId].step === 'ask_number') {
    const number = ctx.message.text.trim();
    if (!/^\d+$/.test(number)) {
      return ctx.reply('Будь ласка, введіть тільки номер квартири (цифрами):');
    }
    
    const section = registrationSessions[userId].section;
    const user = dbQueries.getOrCreateUser(userId, ctx.from.first_name || 'Користувач');
    
    const res = dbQueries.tryLinkApartmentForUser(user.id, section, number);
    if (!res.success) {
      if (res.error === 'already_taken') {
        return ctx.reply('❌ Ця квартира вже зареєстрована на іншого користувача.\nЯкщо це ваша квартира, зверніться до адміністрації.');
      }
      return ctx.reply('❌ Виникла помилка. Спробуйте пізніше.');
    }
    
    delete registrationSessions[userId];
    return ctx.reply(`✅ Ви успішно зареєстровані: ${section}, кв. ${number}!\nТепер ви можете створювати заявки.`, mainKeyboard);
  }

  const session = sessions[userId];
  if (!session) return;

  if (session.step === 'waiting_for_name') {
    session.data.visitorName = ctx.message.text;
    if (session.isEditing) {
      showConfirmation(ctx, userId);
    } else {
      session.step = 'choose_time';

      const buttons = [
        [Markup.button.callback(visitTimes.now, 'time:now')],
        [Markup.button.callback(visitTimes.today, 'time:today')],
        [Markup.button.callback(visitTimes.tomorrow, 'time:tomorrow')],
        [Markup.button.callback(visitTimes.custom, 'time:custom')],
        [Markup.button.callback('❌ Скасувати', 'go_to_menu')]
      ];

      ctx.reply('Коли очікувати?', Markup.inlineKeyboard(buttons));
    }
  }
  else if (session.step === 'waiting_for_custom_time') {
    session.data.expectedTime = 'custom';
    session.data.customTime = ctx.message.text;
    showConfirmation(ctx, userId);
  }
});

// Обробка вибору часу
bot.action(/^time:(\w+)$/, (ctx) => {
  ctx.answerCbQuery();
  const userId = ctx.from.id;
  const timeKey = ctx.match[1];

  if (!sessions[userId]) return ctx.reply('Сесію втрачено. Спробуйте знову.', mainKeyboard);

  if (timeKey === 'custom') {
    sessions[userId].step = 'waiting_for_custom_time';
    return ctx.reply('Вкажіть точну дату та час візиту:\n(Наприклад: Сьогодні о 20:30 або Завтра о 14:00)');
  }

  sessions[userId].data.expectedTime = timeKey;
  sessions[userId].data.customTime = null;
  showConfirmation(ctx, userId);
});

// Показ меню підтвердження
function showConfirmation(ctx, userId) {
  const session = sessions[userId];
  if (!session) return;

  session.step = 'confirm_visit';
  session.isEditing = true;

  const { apartmentLabel, visitorType, visitorName, expectedTime, customTime } = session.data;

  const typeText = visitorTypes[visitorType] || visitorType;
  const timeText = expectedTime === 'custom' ? customTime : visitTimes[expectedTime];

  const message = `📋 *Попередній перегляд заявки:*\n\n` +
    `🏡 *Квартира:* ${apartmentLabel}\n` +
    `👥 *Тип гостя:* ${typeText}\n` +
    `👤 *Ім'я:* ${visitorName}\n` +
    `🕒 *Час візиту:* ${timeText}\n\n` +
    `Будь ласка, підтвердіть правильність даних.`;

  const buttons = [
    [Markup.button.callback('✅ Підтвердити', 'confirm:yes')],
    [Markup.button.callback('✏️ Змінити дані', 'confirm:edit')],
    [Markup.button.callback('❌ Скасувати', 'go_to_menu')]
  ];

  ctx.replyWithMarkdown(message, Markup.inlineKeyboard(buttons));
}

// Підтвердження створення заявки
bot.action('confirm:yes', (ctx) => {
  ctx.answerCbQuery();
  const userId = ctx.from.id;
  const session = sessions[userId];
  if (!session) return ctx.reply('Сесію втрачено. Спробуйте знову.', mainKeyboard);

  const { apartmentId, visitorType, visitorName, expectedTime, customTime } = session.data;

  dbQueries.createVisit(apartmentId, visitorType, visitorName, expectedTime, customTime || undefined);
  eventEmitter.emit('visit_change');

  const typeText = visitorTypes[visitorType] || visitorType;
  const timeText = expectedTime === 'custom' ? customTime : visitTimes[expectedTime];

  ctx.reply(
    `✅ Заявку успішно створено!\n\n` +
    `👤 Гість: ${visitorName}\n` +
    `🏡 Квартира: ${session.data.apartmentLabel}\n` +
    `🕒 Час: ${timeText}\n\n` +
    `Охорона вже бачить вашу заявку.`,
    mainKeyboard
  );

  delete sessions[userId];
});

// Меню редагування полів
bot.action('confirm:edit', (ctx) => {
  ctx.answerCbQuery();
  const userId = ctx.from.id;
  const session = sessions[userId];
  if (!session) return ctx.reply('Сесію втрачено. Спробуйте знову.', mainKeyboard);

  const apartments = dbQueries.getUserApartments(userId);
  const buttons = [];

  if (apartments.length > 1) {
    buttons.push([Markup.button.callback('🏢 Змінити квартиру', 'edit:apartment')]);
  }

  buttons.push(
    [Markup.button.callback('👥 Змінити тип гостя', 'edit:type')],
    [Markup.button.callback("👤 Змінити ім'я", 'edit:name')],
    [Markup.button.callback('🕒 Змінити час', 'edit:time')],
    [Markup.button.callback('◀️ Назад', 'edit:back')]
  );

  ctx.reply('Що саме ви хочете змінити?', Markup.inlineKeyboard(buttons));
});

// Обробка зміни конкретних полів
bot.action('edit:apartment', (ctx) => {
  ctx.answerCbQuery();
  const userId = ctx.from.id;
  const session = sessions[userId];
  if (!session) return ctx.reply('Сесію втрачено. Спробуйте знову.', mainKeyboard);

  const apartments = dbQueries.getUserApartments(userId);
  const buttons = apartments.map(apt => [
    Markup.button.callback(`${apt.section}, кв. ${apt.number}`, `apt:${apt.id}`)
  ]);
  buttons.push([Markup.button.callback('◀️ Назад', 'edit:back')]);

  ctx.reply('Оберіть квартиру:', Markup.inlineKeyboard(buttons));
});

bot.action('edit:type', (ctx) => {
  ctx.answerCbQuery();
  const userId = ctx.from.id;
  const session = sessions[userId];
  if (!session) return ctx.reply('Сесію втрачено. Спробуйте знову.', mainKeyboard);

  askVisitorType(ctx);
});

bot.action('edit:name', (ctx) => {
  ctx.answerCbQuery();
  const userId = ctx.from.id;
  const session = sessions[userId];
  if (!session) return ctx.reply('Сесію втрачено. Спробуйте знову.', mainKeyboard);

  session.step = 'waiting_for_name';
  ctx.reply("Вкажіть нове ім'я або опис відвідувача:\n(Наприклад: Кур'єр Glovo)");
});

bot.action('edit:time', (ctx) => {
  ctx.answerCbQuery();
  const userId = ctx.from.id;
  const session = sessions[userId];
  if (!session) return ctx.reply('Сесію втрачено. Спробуйте знову.', mainKeyboard);

  session.step = 'choose_time';
  const buttons = [
    [Markup.button.callback(visitTimes.now, 'time:now')],
    [Markup.button.callback(visitTimes.today, 'time:today')],
    [Markup.button.callback(visitTimes.tomorrow, 'time:tomorrow')],
    [Markup.button.callback(visitTimes.custom, 'time:custom')],
    [Markup.button.callback('◀️ Назад', 'edit:back')]
  ];

  ctx.reply('Оберіть новий час візиту:', Markup.inlineKeyboard(buttons));
});

bot.action('edit:back', (ctx) => {
  ctx.answerCbQuery();
  const userId = ctx.from.id;
  showConfirmation(ctx, userId);
});

// Запуск бота
if (token) {
  bot.launch()
    .then(() => console.log('🚀 Telegram-бот успішно запущено!'))
    .catch((err) => console.error('Помилка запуску бота:', err));
}

// Зупинка бота при закритті сервера
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

export default bot;
