// ============================================================
// Бот Ordius (@Ordius_app_bot) — заявки на пилот и вопросы.
// Облачная функция Yandex Cloud Functions (Node.js 18+), вебхук Telegram.
//
// Где живут персональные данные (имя, @username, id, телефон, текст вопроса):
//   1) запись — в бакет Object Storage в России (ч. 5 ст. 18 152-ФЗ);
//   2) полная карточка — письмом в ящик оператора на Яндекс Почте;
//   3) администратору в Telegram — только оповещение БЕЗ персональных данных,
//      с номером обращения (#K7M2QX). Поэтому трансграничной передачи нет.
// Ответ клиенту: администратор делает «Ответить» на оповещение в Telegram,
// бот находит клиента по номеру обращения в хранилище и пересылает ответ.
//
// Переменные окружения:
//   BOT_TOKEN       — токен от @BotFather (вводится в консоли, не в код)
//   WEBHOOK_SECRET  — длинная случайная строка; та же указывается в вебхуке
//   ADMIN_CHAT_ID   — ваш chat id в Telegram (бот покажет по команде /id)
//   BUCKET          — имя бакета Object Storage
//   MAIL_USER       — ящик для карточек, например ordius.info@yandex.ru
//   MAIL_PASS       — пароль приложения Яндекс Почты (не основной пароль!)
//   MAIL_TO         — куда слать карточки (необязательно, по умолчанию MAIL_USER)
// У функции должен быть сервисный аккаунт с ролью storage.uploader.
// ============================================================

const tls = require('tls');
const crypto = require('crypto');

const SITE = 'https://ordius.ru';
const DEMO = 'https://ordius.ru/demo/';
const PRIVACY = 'https://ordius.ru/privacy.html';
const CONSENT = 'https://ordius.ru/consent.html';
const HUMAN = 'https://t.me/Ordius_app';
const TZ = 'Asia/Novosibirsk';

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
    'Нажимая «Отправить номер», вы даёте <a href="' + CONSENT + '">согласие на обработку персональных данных</a>. ' +
    'Как мы их храним и защищаем — в <a href="' + PRIVACY + '">политике</a>.',
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

const WARN_STORE = '\n⚠️ Не записано в хранилище — проверьте BUCKET и сервисный аккаунт функции.';
const WARN_MAIL = '\n⚠️ Письмо не отправлено — проверьте MAIL_USER и MAIL_PASS. Данные есть в хранилище.';

// ---------- помощники ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const person = u => ({ id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(' '), username: u.username || '' });
const REF_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRef = () => Array.from(crypto.randomBytes(6), b => REF_ABC[b % REF_ABC.length]).join('');
const recKey = (at, ref, type) => `records/${at.slice(0, 10)}/${at.replace(/[:.]/g, '-')}-${ref}-${type}.json`;
const fmtTime = at => new Date(at).toLocaleString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const warn = (saved, mailed) => (saved ? '' : WARN_STORE) + (mailed ? '' : WARN_MAIL);

function card(title, ref, u, lines, at) {
  return [
    `${title} #${ref}`,
    '',
    `Имя в Telegram: ${u.name || '—'}`,
    `Telegram: ${u.username ? '@' + u.username + ' (https://t.me/' + u.username + ')' : 'без имени пользователя'}, id ${u.id}`,
    ...lines,
    `Время: ${fmtTime(at)} (Новосибирск)`,
    '',
    `Ответить клиенту в Telegram: в чате с ботом сделайте «Ответить» на оповещение #${ref}.`
  ].join('\n');
}

const menu = () => ({
  inline_keyboard: [
    [{ text: 'Открыть демо', url: DEMO }],
    [{ text: 'Записаться на пилот', callback_data: 'pilot' }],
    [{ text: 'Тарифы', callback_data: 'price' }, { text: 'Задать вопрос', callback_data: 'ask' }],
    [{ text: 'Сайт ordius.ru', url: SITE }]
  ]
});

// ---------- хранилище: Object Storage в России ----------
function makeStorage(env, context, fetchImpl) {
  const base = env.BUCKET ? `https://storage.yandexcloud.net/${encodeURIComponent(env.BUCKET)}/` : '';
  const auth = () => {
    if (!base) { console.error('BUCKET not set'); return null; }
    const t = context && context.token;
    if (!t || !t.access_token) { console.error('no IAM token: assign a service account to the function'); return null; }
    return { Authorization: 'Bearer ' + t.access_token };
  };
  return {
    async put(key, obj) {
      const a = auth(); if (!a) return false;
      try {
        const r = await fetchImpl(base + key, { method: 'PUT', headers: { ...a, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj) });
        if (!r.ok) { console.error('storage put error', r.status, await r.text().catch(() => '')); return false; }
        return true;
      } catch (e) { console.error('storage put error', e && e.message); return false; }
    },
    async get(key) {
      const a = auth(); if (!a) return null;
      try {
        const r = await fetchImpl(base + key, { headers: a });
        if (r.status === 404) return null;
        if (!r.ok) { console.error('storage get error', r.status); return null; }
        return await r.json();
      } catch (e) { console.error('storage get error', e && e.message); return null; }
    }
  };
}

// ---------- почта: SMTP Яндекс Почты, без сторонних библиотек ----------
function encodeWord(s) {
  const chars = Array.from(String(s)), parts = [];
  for (let i = 0; i < chars.length; i += 10) parts.push('=?UTF-8?B?' + Buffer.from(chars.slice(i, i + 10).join(''), 'utf8').toString('base64') + '?=');
  return parts.join('\r\n ');
}

function buildMessage({ from, to, subject, text }) {
  const body = Buffer.from(String(text).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${encodeWord('Бот Ordius')} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@ordius.ru>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64'
  ].join('\r\n') + '\r\n\r\n' + body;
}

async function smtpSend(o) {
  const sock = tls.connect({ host: o.host, port: o.port, servername: o.host, ...(o.tls || {}) });
  sock.setEncoding('utf8');
  const replies = [];
  let buf = '', wake = null, err = null, timer;
  const poke = () => { if (wake) { const w = wake; wake = null; w(); } };
  sock.on('data', d => {
    buf += d;
    let m;
    while ((m = buf.match(/^((?:\d{3}-[^\r\n]*\r\n)*\d{3}(?: [^\r\n]*)?\r\n)/))) { replies.push(m[1]); buf = buf.slice(m[1].length); }
    poke();
  });
  sock.on('error', e => { err = err || e; poke(); });
  sock.on('close', () => { err = err || new Error('connection closed'); poke(); });
  const read = async () => {
    while (!replies.length) {
      if (err) throw err;
      await new Promise(r => { wake = r; });
    }
    return replies.shift();
  };
  const step = async (label, codes, line) => {
    if (line !== undefined) sock.write(line + '\r\n');
    const r = await read();
    if (!codes.includes(+r.slice(0, 3))) throw new Error(`SMTP ${label}: ${r.trim().split('\r\n').pop()}`);
  };
  const run = async () => {
    await step('greeting', [220]);
    await step('EHLO', [250], 'EHLO ordius.ru');
    await step('AUTH', [235], 'AUTH PLAIN ' + Buffer.from('\0' + o.user + '\0' + o.pass, 'utf8').toString('base64'));
    await step('MAIL FROM', [250], `MAIL FROM:<${o.from}>`);
    await step('RCPT TO', [250, 251], `RCPT TO:<${o.to}>`);
    await step('DATA', [354], 'DATA');
    await step('message', [250], buildMessage(o) + '.');
    sock.write('QUIT\r\n');
  };
  try {
    await Promise.race([run(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('SMTP timeout')), o.timeoutMs || 8000); })]);
  } finally {
    clearTimeout(timer);
    sock.end();
    sock.destroy();
  }
}

function makeMailer(env, extra = {}) {
  return async ({ subject, text }) => {
    if (!env.MAIL_USER || !env.MAIL_PASS) { console.error('MAIL_USER/MAIL_PASS not set: mail not sent'); return false; }
    try {
      await smtpSend({
        host: env.MAIL_HOST || 'smtp.yandex.ru', port: Number(env.MAIL_PORT) || 465,
        user: env.MAIL_USER, pass: env.MAIL_PASS, from: env.MAIL_USER, to: env.MAIL_TO || env.MAIL_USER,
        subject, text, ...extra
      });
      return true;
    } catch (e) { console.error('mail error', e && e.message); return false; }
  };
}

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

const NO_DEPS = { store: { put: async () => false, get: async () => null }, mail: async () => false };

// ---------- логика (не зависит от площадки — пригодится и для MAX) ----------
async function handleUpdate(update, env, api, deps = NO_DEPS) {
  const { store, mail } = { ...NO_DEPS, ...deps };
  const makeRef = deps.newRef || newRef;
  const admin = String(env.ADMIN_CHAT_ID || '');
  const send = (chat_id, text, extra = {}) => api('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  const ping = text => (admin ? send(admin, text) : null);
  const now = () => new Date().toISOString();

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
      const at = now(), ref = makeRef(), u = person(q.from), fleet = SIZES[size], method = METHODS[m];
      const saved = (await Promise.all([
        store.put(recKey(at, ref, 'lead'), { type: 'lead', at, ref, user: u, fleet, method }),
        store.put(`refs/${ref}.json`, { chat_id: chat, user_id: u.id, at }),
        store.put(`pending/u${u.id}.json`, { ref, fleet, method, at })
      ])).every(Boolean);
      const mailed = await mail({
        subject: `Ordius: заявка на пилот #${ref}`,
        text: card('Заявка на пилот (номер ещё не оставлен)', ref, u, [`Техники: ${fleet}`, `Учёт сейчас: ${method}`], at)
      });
      await ping(`<b>Заявка на пилот #${ref}</b>\nТехники: ${fleet}, учёт: ${method}.\nКонтакты — в почте.` + warn(saved, mailed));
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

  // Сообщения администратора: ответ клиенту — «Ответить» на оповещение с номером #XXXXXX
  if (admin && chat === admin) {
    if (text === '/id') return send(chat, 'Ваш chat id: <code>' + chat + '</code>');
    const src = msg.reply_to_message && (msg.reply_to_message.text || '');
    const m = src && src.match(/#([A-Z0-9]{6})\b/);
    if (m && text) {
      const ref = m[1];
      const r = await store.get(`refs/${ref}.json`);
      if (!r || !r.chat_id) return send(chat, `Не нашёл обращение #${ref} в хранилище. Ответьте клиенту по телефону или в Telegram — контакты в письме.`);
      await send(r.chat_id, '<b>Ответ от Ordius:</b>\n' + esc(text));
      const at = now();
      await store.put(recKey(at, ref, 'reply'), { type: 'reply', at, ref, text });
      return send(chat, `Отправлено клиенту по обращению #${ref}.`);
    }
    if (text.startsWith('/')) return send(chat, T.start, { reply_markup: menu() });
    return send(chat, 'Чтобы ответить клиенту, сделайте «Ответить» на оповещение с номером обращения (#…).');
  }

  // Номер телефона
  if (msg.contact) {
    if (String(msg.contact.user_id) !== String(msg.from.id)) return send(chat, T.notOwnContact);
    const at = now(), u = person(msg.from);
    const phone = '+' + String(msg.contact.phone_number).replace(/^\+/, '');
    const pending = await store.get(`pending/u${u.id}.json`);
    const ref = (pending && pending.ref) || makeRef();
    const jobs = [store.put(recKey(at, ref, 'phone'), { type: 'phone', at, ref, user: u, phone })];
    if (!pending) jobs.push(store.put(`refs/${ref}.json`, { chat_id: chat, user_id: u.id, at }));
    const saved = (await Promise.all(jobs)).every(Boolean);
    const extra = pending ? [`Техники: ${pending.fleet}`, `Учёт сейчас: ${pending.method}`] : [];
    const mailed = await mail({
      subject: `Ordius: телефон по заявке #${ref}`,
      text: card('Заявка на пилот — оставлен номер', ref, u, [`Телефон: ${phone}`, ...extra], at)
    });
    await ping(`<b>Номер по заявке #${ref}</b>\nТелефон — в почте. Можно звонить.` + warn(saved, mailed));
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
  if (cmd === '/pilot') return handleUpdate({ callback_query: { id: '', data: 'pilot', from: msg.from, message: { chat: msg.chat } } }, env, async (method, p) => (method === 'answerCallbackQuery' ? {} : api(method, p)), deps);
  if (cmd === '/contact') return send(chat, T.contactText, { reply_markup: { inline_keyboard: [[{ text: 'Написать Александру', url: HUMAN }]] } });
  if (cmd === '/id') return send(chat, 'Ваш chat id: <code>' + chat + '</code>');
  if (text.startsWith('/')) return send(chat, T.unknown, { reply_markup: menu() });

  // Любой другой текст — вопрос Александру
  if (text) {
    const at = now(), ref = makeRef(), u = person(msg.from);
    const saved = (await Promise.all([
      store.put(recKey(at, ref, 'question'), { type: 'question', at, ref, user: u, text }),
      store.put(`refs/${ref}.json`, { chat_id: chat, user_id: u.id, at })
    ])).every(Boolean);
    const mailed = await mail({ subject: `Ordius: вопрос #${ref}`, text: card('Вопрос', ref, u, ['', 'Вопрос:', text, ''], at) });
    await ping(`<b>Вопрос #${ref}</b>\nТекст и контакты — в почте. Чтобы ответить, сделайте «Ответить» на это сообщение.` + warn(saved, mailed));
    return send(chat, T.asked);
  }
  return send(chat, T.unknown, { reply_markup: menu() });
}

// ---------- вход для Yandex Cloud Functions ----------
module.exports.handler = async function (event, context) {
  const env = process.env;
  const headers = Object.fromEntries(Object.entries((event && event.headers) || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (!env.WEBHOOK_SECRET || !env.BOT_TOKEN) return { statusCode: 500, body: 'not configured' };
  if (headers['x-telegram-bot-api-secret-token'] !== env.WEBHOOK_SECRET) return { statusCode: 403, body: 'forbidden' };
  let update = {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '{}');
    update = JSON.parse(raw);
  } catch (e) { return { statusCode: 200, body: 'ok' }; }
  try {
    await handleUpdate(update, env, makeApi(env.BOT_TOKEN, fetch), { store: makeStorage(env, context, fetch), mail: makeMailer(env) });
  } catch (e) { console.error('handler error', e && e.stack || e); }
  return { statusCode: 200, body: 'ok' }; // Telegram должен получить 200, иначе будет слать повторно
};

module.exports.handleUpdate = handleUpdate;
module.exports.makeStorage = makeStorage;
module.exports.makeMailer = makeMailer;
module.exports.buildMessage = buildMessage;
