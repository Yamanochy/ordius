// Локальная проверка логики бота без Telegram: node bot/test.js
const { handleUpdate: hu, handler, makeStore } = require('./index.js');
const env = { ADMIN_CHAT_ID: '999', WEBHOOK_SECRET: 's3cret' };
const log = [];
const api = async (method, p) => { log.push({ method, chat: p.chat_id, text: p.text, kb: p.reply_markup }); return { ok: true }; };
const saved = [];
let storeOk = true;
const store = async rec => { saved.push(rec); log.push({ method: 'store', rec }); return storeOk; };
const handleUpdate = (u, e, a) => hu(u, e, a, store);
const user = { id: 111, first_name: 'Иван', last_name: 'Петров', username: 'ivan_tech' };
const chat = { id: 111 };
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  -', m); };
const last = () => log[log.length - 1];

(async () => {
  await handleUpdate({ message: { chat, from: user, text: '/start' } }, env, api);
  assert(last().text.includes('Ordius') && last().kb.inline_keyboard.length === 4, '/start — приветствие и меню');

  await handleUpdate({ callback_query: { id: '1', data: 'pilot', from: user, message: { chat } } }, env, api);
  assert(last().text.includes('1/3') && last().kb.inline_keyboard[0].length === 4, 'пилот: вопрос про технику');

  await handleUpdate({ callback_query: { id: '2', data: 's:b', from: user, message: { chat } } }, env, api);
  assert(last().text.includes('2/3') && last().kb.inline_keyboard[1][0].callback_data === 'm:b:x', 'пилот: вопрос про учёт');

  log.length = 0;
  await handleUpdate({ callback_query: { id: '3', data: 'm:b:x', from: user, message: { chat } } }, env, api);
  const toAdmin = log.find(l => l.chat === '999');
  assert(toAdmin && toAdmin.text.includes('6–15') && toAdmin.text.includes('Excel') && toAdmin.text.includes('#u111'), 'админу ушла черновая заявка');
  assert(log.findIndex(l => l.method === 'store') < log.findIndex(l => l.chat === '999'), 'заявка сначала записана в хранилище, потом ушла в Telegram');
  assert(saved[0].type === 'lead' && saved[0].fleet === '6–15' && saved[0].user.username === 'ivan_tech', 'в хранилище — ответы и данные клиента');
  assert(!toAdmin.text.includes('Не записано'), 'при успешной записи предупреждения нет');
  assert(last().kb.keyboard[0][0].request_contact === true, 'клиенту — кнопка «Отправить номер»');
  assert(last().text.includes('consent.html') && last().text.includes('privacy.html'), 'ссылки на согласие и политику');

  log.length = 0;
  await handleUpdate({ message: { chat, from: user, contact: { user_id: 111, phone_number: '79231234567' } } }, env, api);
  assert(log.some(l => l.chat === '999' && l.text.includes('+79231234567')), 'админу ушёл номер');
  assert(saved[saved.length - 1].phone === '+79231234567', 'номер записан в хранилище');
  assert(log.some(l => String(l.chat) === '111' && l.text.startsWith('Спасибо')), 'клиенту — спасибо');

  log.length = 0;
  const n = saved.length;
  await handleUpdate({ message: { chat, from: user, contact: { user_id: 555, phone_number: '70000000000' } } }, env, api);
  assert(!log.some(l => l.chat === '999') && saved.length === n, 'чужой контакт не принимается и не записывается');

  log.length = 0; storeOk = false;
  await handleUpdate({ message: { chat, from: user, text: 'Проверка без хранилища' } }, env, api);
  assert(log.some(l => l.chat === '999' && l.text.includes('Не записано в хранилище')), 'если запись не удалась — админ видит предупреждение');
  storeOk = true;

  const puts = [];
  const fakeFetch = async (url, o) => { puts.push({ url, o }); return { ok: true, text: async () => '' }; };
  const st = makeStore({ BUCKET: 'ordius-leads' }, { token: { access_token: 'iam123', token_type: 'Bearer' } }, fakeFetch);
  const okPut = await st({ type: 'phone', at: '2026-10-17T05:06:07.890Z', user: { id: 111 }, phone: '+7923' });
  assert(okPut && puts[0].o.method === 'PUT' && puts[0].o.headers.Authorization === 'Bearer iam123', 'хранилище: PUT с IAM-токеном');
  assert(puts[0].url === 'https://storage.yandexcloud.net/ordius-leads/leads/2026-10-17/2026-10-17T05-06-07-890Z-u111-phone.json', 'хранилище: путь файла по дате');
  assert(await makeStore({}, {}, fakeFetch)({ at: '2026-10-17T00:00:00Z', user: { id: 1 }, type: 'x' }) === false, 'без BUCKET запись не считается успешной');
  assert(await makeStore({ BUCKET: 'b' }, {}, fakeFetch)({ at: '2026-10-17T00:00:00Z', user: { id: 1 }, type: 'x' }) === false, 'без сервисного аккаунта запись не считается успешной');

  log.length = 0;
  await handleUpdate({ message: { chat, from: user, text: 'Сколько стоит на 25 машин? <b>' } }, env, api);
  const q = log.find(l => l.chat === '999');
  assert(q && q.text.includes('&lt;b&gt;') && q.text.includes('#u111'), 'вопрос переслан админу, текст экранирован');

  log.length = 0;
  await handleUpdate({ message: { chat: { id: 999 }, from: { id: 999 }, text: 'Посчитаем под ваш парк, позвоню завтра', reply_to_message: { text: q.text.replace(/<[^>]+>/g, '') } } }, env, api);
  assert(log.some(l => l.chat === '111' && l.text.includes('позвоню завтра')), 'ответ админа ушёл клиенту');

  log.length = 0;
  await handleUpdate({ message: { chat, from: user, text: '/pilot' } }, env, api);
  assert(last().text.includes('1/3'), '/pilot — начинает запись');

  await handleUpdate({ message: { chat, from: user, text: '/price' } }, env, api);
  assert(last().text.includes('4 900'), '/price — тарифы');

  const r0 = await handler({ headers: {}, body: '{}' });
  assert(r0.statusCode === 500, 'без настроек бот не работает');
  process.env.WEBHOOK_SECRET = 's3cret'; process.env.BOT_TOKEN = 'test';
  const r1 = await handler({ headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' }, body: '{}' });
  assert(r1.statusCode === 403, 'вебхук с чужим секретом отклоняется');
  global.fetch = async () => ({ json: async () => ({ ok: true }) });
  const r2 = await handler({ headers: { 'X-Telegram-Bot-Api-Secret-Token': 's3cret' }, body: Buffer.from(JSON.stringify({ message: { chat, from: user, text: '/start' } })).toString('base64'), isBase64Encoded: true });
  assert(r2.statusCode === 200, 'вебхук с секретом и base64-телом — 200');
})();
