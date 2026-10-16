// ============================================================
// Бот Ordius (@Ordius_app_bot) — заявки на пилот и вопросы.
// Работает как облачная функция (Yandex Cloud Functions, Node.js 18+)
// по вебхуку Telegram. Ничего не хранит у себя: заявки и вопросы
// сразу уходят администратору в Telegram, ответы — обратно клиенту.
//
// Переменные окружения:
//   BOT_TOKEN       — токен от @BotFather (вставляется в консоли, не в код)
//   ADMIN_CHAT_ID   — ваш числовой id в Telegram (бот покажет его по команде /id)
//   WEBHOOK_SECRET  — любая длинная строка; та же указывается при установке вебхука
// ============================================================

const SITE = 'https://ordius.ru';
const DEMO = 'https://ordius.ru/demo/';
const PRIVACY = 'https://ordius.ru/privacy.html';
const HUMAN = 'https://t.me/Ordius_app';

const SIZES = { a: '1–5', b: '6–15', c: '16–30', d: 'больше 30' };
const METHODS = { n: 'Тетрадь', x: 'Excel', w: 'Мессенджер', o: '1С', p: 'Другая программа' };

const T = {
  start:
    '<b>Ordius</b> — учёт смен, ремонтов и зарплаты водителей для владельцев спецтехники и грузовых автопарков.\n\n' +
    'Водитель отмечает смену в телефоне, механик ведёт ремонт до приёмки, бухгалтер видит, кому сколько выплатить. ' +
    'Внутри — ИИ-помощник Орди.\n\n' +
    'Запуск — <b>1 декабря 2026</b>. Сейчас идёт запись на бесплатный пилот.',
  price:
    '<b>Тарифы Ordius</b>\n\n' +
    '<b>Старт</b> — 4 900 ₽ в месяц, до 10 единиц техники.\n' +
    'Табель со смартфона, зарплата и авансы, ремонты цепочкой, деньги по объектам, топливные карты, ИИ-помощник Орди.\n\n' +
    '<b>Бизнес</b> — 11 900 ₽ в месяц, до 40 единиц.\n' +
    'Всё из «Старта» плюс планировщик, кабинет заказчика, филиалы, склад, GPS, вахта, кадры, штрафы.\n\n' +
    'Первый месяц на любом тарифе — бесплатно. Табель и технику из Excel переносим сами.',
  sizeQ: 'Запись на пилот — 3 коротких вопроса.\n\n<b>1/3.</b> Сколько у вас единиц техники?',
  methodQ: '<b>2/3.</b> Как сейчас ведёте учёт смен и зарплаты?',
  phoneQ:
    '<b>3/3.</b> Оставьте номер — Александр позвонит, расскажет, как пройдёт пилот, и ответит на вопросы. Разговор займёт около 20 минут.\n\n' +
    'Нажимая «Отправить номер», вы соглашаетесь на обработку персональных данных по <a href="' + PRIVACY + '">политике конфиденциальности</a>.',
  thanks:
    'Спасибо! Заявка принята. Александр свяжется с вами в ближайшее время — обычно в тот же день.\n\n' +
    'Пока можно посмотреть демо: там вымышленная компания, все кнопки работают.',
  noPhone: 'Хорошо. Напишите Александру напрямую, когда будет удобно: @Ordius_app',
  askQ: 'Напишите вопрос одним сообщением — передам его Александру. Ответ придёт сюда же.',
  asked: 'Вопрос передан Александру. Ответ придёт в этот чат.',
  contactText: 'Написать Александру напрямую: @Ordius_app\n\nИли задайте вопрос здесь — ответ придёт в этот чат.',
  notOwnContact: 'Пожалуйста, отправьте свой номер кнопкой «Отправить номер» внизу.',
  unknown: 'Выберите, что вас интересует:'
};

// ---------- помощники ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function who(u) {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Без имени';
  return esc(name) + (u.username ? ' @' + esc(u.username) : '') + ' #u' + u.id;
}
const menu = () => ({
  inline_keyboard: [
    [{ text: 'Открыть демо', url: DEMO }],
    [{ text: 'Записаться на пилот', callback_data: 'pilot' }],
    [{ text: 'Тарифы', callback_data: 'price' }, { text: 'Задать вопрос', callback_data: 'ask' }],
    [{ text: 'Сайт ordius.ru', url: SITE }]
  ]
});

function makeApi(token, fetchImpl) {
  return async (method, params) => {
    const r = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params)
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) console.error('Telegram API error', method, j.description);
    return j;
  };
}

// ---------- логика (не зависит от площадки — пригодится и для MAX) ----------
async function handleUpdate(update, env, api) {
  const admin = String(env.ADMIN_CHAT_ID || '');
  const send = (chat_id, text, extra = {}) => api('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

  // Нажатия на кнопки
  if (update.callback_query) {
    const q = update.callback_query, chat = q.message.chat.id, d = q.data || '';
    await api('answerCallbackQuery', { callback_query_id: q.id });
    if (d === 'price') return send(chat, T.price, { reply_markup: menu() });
    if (d === 'ask') return send(chat, T.askQ, { reply_markup: { force_reply: true, input_field_placeholder: 'Ваш вопрос' } });
    if (d === 'pilot') {
      return send(chat, T.sizeQ, { reply_markup: { inline_keyboard: [Object.keys(SIZES).map(k => ({ text: SIZES[k], callback_data: 's:' + k }))] } });
    }
    if (d.startsWith('s:')) {
      const size = d.slice(2);
      if (!SIZES[size]) return null;
      const rows = Object.keys(METHODS).map(m => [{ text: METHODS[m], callback_data: 'm:' + size + ':' + m }]);
      return send(chat, T.methodQ, { reply_markup: { inline_keyboard: rows } });
    }
    if (d.startsWith('m:')) {
      const [, size, m] = d.split(':');
      if (!SIZES[size] || !METHODS[m]) return null;
      if (admin) await send(admin, `<b>Заявка на пилот</b> (номер ещё не оставлен)\n${who(q.from)}\nТехники: ${SIZES[size]}\nУчёт сейчас: ${METHODS[m]}`);
      return send(chat, T.phoneQ, {
        reply_markup: { keyboard: [[{ text: 'Отправить номер', request_contact: true }], [{ text: 'Не хочу оставлять номер' }]], one_time_keyboard: true, resize_keyboard: true }
      });
    }
    return null;
  }

  const msg = update.message;
  if (!msg || !msg.chat) return null;
  const chat = String(msg.chat.id);
  const text = (msg.text || '').trim();

  // Сообщения от администратора: ответ клиенту — ответом (reply) на пересланное сообщение
  if (admin && chat === admin) {
    if (text === '/id') return send(chat, 'Ваш chat id: <code>' + chat + '</code>');
    const src = msg.reply_to_message && (msg.reply_to_message.text || '');
    const m = src && src.match(/#u(\d+)/);
    if (m && text) {
      await send(m[1], '<b>Ответ от Ordius:</b>\n' + esc(text));
      return send(chat, 'Отправлено клиенту.');
    }
    if (text.startsWith('/')) return send(chat, T.start, { reply_markup: menu() });
    return send(chat, 'Чтобы ответить клиенту, сделайте «Ответить» на его сообщение с меткой #u…');
  }

  // Номер телефона
  if (msg.contact) {
    if (String(msg.contact.user_id) !== String(msg.from.id)) return send(chat, T.notOwnContact);
    if (admin) await send(admin, `<b>Номер для заявки:</b> <code>+${esc(String(msg.contact.phone_number).replace(/^\+/, ''))}</code>\n${who(msg.from)}`);
    await send(chat, T.thanks, { reply_markup: { remove_keyboard: true } });
    return send(chat, 'Что дальше?', { reply_markup: menu() });
  }

  if (text === 'Не хочу оставлять номер') {
    await send(chat, T.noPhone, { reply_markup: { remove_keyboard: true } });
    return send(chat, T.unknown, { reply_markup: menu() });
  }

  // Команды
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  if (cmd === '/start') return send(chat, T.start, { reply_markup: menu() });
  if (cmd === '/demo') return send(chat, 'Демо Ordius — вымышленная компания, 7 ролей, всё нажимается:', { reply_markup: { inline_keyboard: [[{ text: 'Открыть демо', url: DEMO }]] } });
  if (cmd === '/price') return send(chat, T.price, { reply_markup: menu() });
  if (cmd === '/pilot') return handleUpdate({ callback_query: { id: '', data: 'pilot', from: msg.from, message: { chat: msg.chat } } }, env, async (method, p) => (method === 'answerCallbackQuery' ? {} : api(method, p)));
  if (cmd === '/contact') return send(chat, T.contactText, { reply_markup: { inline_keyboard: [[{ text: 'Написать Александру', url: HUMAN }]] } });
  if (cmd === '/id') return send(chat, 'Ваш chat id: <code>' + chat + '</code>');
  if (text.startsWith('/')) return send(chat, T.unknown, { reply_markup: menu() });

  // Любой другой текст — вопрос Александру
  if (text) {
    if (admin) await send(admin, `<b>Вопрос</b> от ${who(msg.from)}:\n${esc(text)}`);
    return send(chat, T.asked);
  }
  return send(chat, T.unknown, { reply_markup: menu() });
}

// ---------- вход для Yandex Cloud Functions ----------
module.exports.handler = async function (event) {
  const env = process.env;
  const headers = Object.fromEntries(Object.entries((event && event.headers) || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (!env.WEBHOOK_SECRET || !env.BOT_TOKEN) return { statusCode: 500, body: 'not configured' };
  if (headers['x-telegram-bot-api-secret-token'] !== env.WEBHOOK_SECRET) return { statusCode: 403, body: 'forbidden' };
  let update = {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '{}');
    update = JSON.parse(raw);
  } catch (e) { return { statusCode: 200, body: 'ok' }; }
  try { await handleUpdate(update, env, makeApi(env.BOT_TOKEN, fetch)); }
  catch (e) { console.error('handler error', e && e.stack || e); }
  return { statusCode: 200, body: 'ok' }; // Telegram должен получить 200, иначе будет слать повторно
};

module.exports.handleUpdate = handleUpdate;
