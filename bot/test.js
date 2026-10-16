// Локальная проверка логики бота без Telegram: node bot/test.js
const { handleUpdate, handler } = require('./index.js');
const env = { ADMIN_CHAT_ID: '999', WEBHOOK_SECRET: 's3cret' };
const log = [];
const api = async (method, p) => { log.push({ method, chat: p.chat_id, text: p.text, kb: p.reply_markup }); return { ok: true }; };
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
  assert(last().kb.keyboard[0][0].request_contact === true, 'клиенту — кнопка «Отправить номер»');

  log.length = 0;
  await handleUpdate({ message: { chat, from: user, contact: { user_id: 111, phone_number: '79231234567' } } }, env, api);
  assert(log.some(l => l.chat === '999' && l.text.includes('+79231234567')), 'админу ушёл номер');
  assert(log.some(l => String(l.chat) === '111' && l.text.startsWith('Спасибо')), 'клиенту — спасибо');

  log.length = 0;
  await handleUpdate({ message: { chat, from: user, contact: { user_id: 555, phone_number: '70000000000' } } }, env, api);
  assert(!log.some(l => l.chat === '999'), 'чужой контакт не принимается');

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
