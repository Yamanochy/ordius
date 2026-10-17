// Локальная проверка бота без Telegram, хранилища и почты: node bot/test.js
// Почта проверяется на настоящем TLS-соединении с поддельным SMTP-сервером (нужен openssl).
const fs = require('fs');
const os = require('os');
const path = require('path');
const tls = require('tls');
const { execSync } = require('child_process');
const { handleUpdate: hu, handler, makeStorage, makeMailer } = require('./index.js');

const env = { ADMIN_CHAT_ID: '999', WEBHOOK_SECRET: 's3cret' };
const log = [];
const api = async (method, p) => { log.push({ method, chat: String(p.chat_id), text: p.text, kb: p.reply_markup }); return { ok: true }; };
const db = new Map();
let storeOk = true, mailOk = true;
const mails = [];
const store = {
  put: async (k, v) => { if (!storeOk) return false; db.set(k, JSON.parse(JSON.stringify(v))); return true; },
  get: async k => (storeOk ? db.get(k) || null : null)
};
const mail = async m => { mails.push(m); return mailOk; };
const refs = ['AAAAA2', 'BBBBB3', 'CCCCC4', 'DDDDD5', 'EEEEE6'];
const deps = { store, mail, newRef: () => refs.shift() };
const handleUpdate = (u, e = env) => hu(u, e, api, deps);

const user = { id: 111, first_name: 'Иван', last_name: 'Петров', username: 'ivan_tech' };
const chat = { id: 111 };
let failed = 0;
const assert = (c, m) => { if (!c) { failed++; console.error('FAIL:', m); } else console.log('ok  -', m); };
const last = () => log[log.length - 1];
const toAdmin = () => log.filter(l => l.chat === '999');
const noPD = t => !/Иван|Петров|ivan_tech|111|7923/.test(t);
const plain = t => t.replace(/<[^>]+>/g, '');

(async () => {
  // --- запись на пилот ---
  await handleUpdate({ message: { chat, from: user, text: '/start' } });
  assert(last().text.includes('Ordius') && last().kb.inline_keyboard.length === 4, '/start — приветствие и меню');

  await handleUpdate({ callback_query: { id: '1', data: 'pilot', from: user, message: { chat } } });
  assert(last().text.includes('1/3') && last().kb.inline_keyboard[0].length === 4, 'пилот: вопрос про технику');

  await handleUpdate({ callback_query: { id: '2', data: 's:b', from: user, message: { chat } } });
  assert(last().text.includes('2/3') && last().kb.inline_keyboard[1][0].callback_data === 'm:b:x', 'пилот: вопрос про учёт');

  log.length = 0;
  await handleUpdate({ callback_query: { id: '3', data: 'm:b:x', from: user, message: { chat } } });
  const leadKey = [...db.keys()].find(k => k.startsWith('records/') && k.endsWith('-AAAAA2-lead.json'));
  assert(leadKey && db.get(leadKey).fleet === '6–15' && db.get(leadKey).user.username === 'ivan_tech', 'заявка записана в хранилище');
  assert(db.get('refs/AAAAA2.json').chat_id === 111 && db.get('pending/u111.json').method === 'Excel', 'в хранилище — номер обращения и черновик заявки');
  const m1 = mails[0];
  assert(m1 && m1.subject.includes('#AAAAA2') && /Иван Петров/.test(m1.text) && /@ivan_tech/.test(m1.text) && /6–15/.test(m1.text) && /Excel/.test(m1.text), 'письмо с полной карточкой заявки');
  const p1 = toAdmin()[0];
  assert(p1 && p1.text.includes('#AAAAA2') && p1.text.includes('6–15') && noPD(p1.text), 'оповещение в Telegram — без персональных данных');
  assert(!p1.text.includes('⚠️'), 'при успехе предупреждений нет');
  assert(last().kb.keyboard[0][0].request_contact === true && last().text.includes('consent.html') && last().text.includes('privacy.html'), 'клиенту — кнопка «Отправить номер» и ссылки на согласие и политику');

  log.length = 0;
  await handleUpdate({ message: { chat, from: user, contact: { user_id: 111, phone_number: '79231234567' } } });
  const phoneKey = [...db.keys()].find(k => k.endsWith('-AAAAA2-phone.json'));
  assert(phoneKey && db.get(phoneKey).phone === '+79231234567', 'номер записан к той же заявке');
  const m2 = mails[1];
  assert(m2.subject.includes('#AAAAA2') && m2.text.includes('+79231234567') && m2.text.includes('6–15'), 'письмо с номером и ответами');
  const p2 = toAdmin()[0];
  assert(p2.text.includes('#AAAAA2') && noPD(p2.text), 'оповещение о номере — без персональных данных');
  assert(log.some(l => l.chat === '111' && l.text.startsWith('Спасибо')), 'клиенту — спасибо');

  log.length = 0;
  const n = db.size, nm = mails.length;
  await handleUpdate({ message: { chat, from: user, contact: { user_id: 555, phone_number: '70000000000' } } });
  assert(toAdmin().length === 0 && db.size === n && mails.length === nm, 'чужой контакт не принимается и никуда не уходит');

  // --- вопрос и ответ администратора ---
  log.length = 0;
  await handleUpdate({ message: { chat, from: user, text: 'Сколько стоит на 25 машин? <b>' } });
  const m3 = mails[mails.length - 1];
  assert(m3.subject.includes('#BBBBB3') && m3.text.includes('Сколько стоит на 25 машин? <b>'), 'вопрос пришёл письмом');
  const p3 = toAdmin()[0];
  assert(p3.text.includes('#BBBBB3') && !p3.text.includes('25 машин') && noPD(p3.text), 'оповещение о вопросе — без текста и контактов');
  assert(last().text === 'Вопрос передан Александру. Ответ придёт в этот чат.', 'клиенту — вопрос передан');

  log.length = 0;
  await hu({ message: { chat: { id: 999 }, from: { id: 999 }, text: 'Посчитаем под ваш парк, позвоню завтра', reply_to_message: { text: plain(p3.text) } } }, env, api, deps);
  assert(log.some(l => l.chat === '111' && l.text.includes('позвоню завтра')), 'ответ администратора ушёл клиенту');
  assert(last().text.includes('#BBBBB3'), 'администратору — подтверждение');
  assert([...db.keys()].some(k => k.endsWith('-BBBBB3-reply.json')), 'ответ записан в хранилище');

  log.length = 0;
  await hu({ message: { chat: { id: 999 }, from: { id: 999 }, text: 'Привет', reply_to_message: { text: 'Вопрос #ZZZZZ9' } } }, env, api, deps);
  assert(last().text.includes('Не нашёл обращение #ZZZZZ9') && !log.some(l => l.chat === '111'), 'неизвестный номер обращения — клиенту ничего не уходит');

  // --- сбои хранилища и почты видны администратору ---
  log.length = 0; storeOk = false; mailOk = false;
  await handleUpdate({ message: { chat, from: user, text: 'Проверка сбоя' } });
  const p4 = toAdmin()[0];
  assert(p4.text.includes('Не записано в хранилище') && p4.text.includes('Письмо не отправлено') && noPD(p4.text), 'сбои видны администратору, данные в Telegram не уходят');
  storeOk = true; mailOk = true;

  log.length = 0;
  await handleUpdate({ message: { chat, from: user, text: '/pilot' } });
  assert(last().text.includes('1/3'), '/pilot — начинает запись');
  await handleUpdate({ message: { chat, from: user, text: '/price' } });
  assert(last().text.includes('4 900'), '/price — тарифы');

  // --- хранилище Object Storage ---
  const calls = [];
  const fakeFetch = async (url, o = {}) => {
    calls.push({ url, o });
    if (url.endsWith('missing.json')) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, json: async () => ({ chat_id: 5 }), text: async () => '' };
  };
  const st = makeStorage({ BUCKET: 'ordius-leads' }, { token: { access_token: 'iam123', token_type: 'Bearer' } }, fakeFetch);
  assert(await st.put('records/2026-10-17/x.json', { a: 1 }) && calls[0].o.method === 'PUT' && calls[0].o.headers.Authorization === 'Bearer iam123', 'хранилище: PUT с IAM-токеном');
  assert(calls[0].url === 'https://storage.yandexcloud.net/ordius-leads/records/2026-10-17/x.json', 'хранилище: правильный адрес');
  assert((await st.get('refs/x.json')).chat_id === 5 && (await st.get('refs/missing.json')) === null, 'хранилище: чтение и 404');
  assert(await makeStorage({}, {}, fakeFetch).put('k', {}) === false, 'без BUCKET запись не считается успешной');
  assert(await makeStorage({ BUCKET: 'b' }, {}, fakeFetch).put('k', {}) === false, 'без сервисного аккаунта запись не считается успешной');
  assert(await makeMailer({})({ subject: 's', text: 't' }) === false, 'без MAIL_USER/MAIL_PASS письмо не считается отправленным');

  // --- почта: настоящий TLS и SMTP-диалог ---
  let haveSsl = true;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordius-smtp-'));
  try {
    execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 1 -subj /CN=localhost 2>/dev/null`);
  } catch (e) { haveSsl = false; }
  if (!haveSsl) { console.log('skip - openssl не найден, проверка SMTP пропущена'); }
  else {
    const key = fs.readFileSync(`${dir}/k.pem`), cert = fs.readFileSync(`${dir}/c.pem`);
    const got = [];
    const server = tls.createServer({ key, cert }, s => {
      let buf = '', data = false, body = '';
      s.write('220 fake ESMTP\r\n');
      s.on('data', d => {
        buf += d.toString('utf8');
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (data) {
            if (line === '.') { data = false; got.push(body); s.write('250 2.0.0 queued\r\n'); } else body += line + '\r\n';
            continue;
          }
          if (line.startsWith('EHLO')) s.write('250-fake\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n');
          else if (line.startsWith('AUTH PLAIN ')) {
            const [, u, p] = Buffer.from(line.slice(11), 'base64').toString('utf8').split('\0');
            s.write(u === 'ordius.info@yandex.ru' && p === 'app-pass' ? '235 2.7.0 ok\r\n' : '535 5.7.8 bad credentials\r\n');
          } else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) s.write('250 ok\r\n');
          else if (line === 'DATA') { data = true; s.write('354 go\r\n'); }
          else if (line === 'QUIT') { s.write('221 bye\r\n'); s.end(); }
          else s.write('500 unknown\r\n');
        }
      });
      s.on('error', () => {});
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const menv = { MAIL_USER: 'ordius.info@yandex.ru', MAIL_PASS: 'app-pass', MAIL_HOST: 'localhost', MAIL_PORT: String(port) };
    const ok = await makeMailer(menv, { tls: { ca: cert } })({ subject: 'Ordius: заявка на пилот #AAAAA2', text: 'Имя: Иван\nТехники: 6–15' });
    assert(ok === true && got.length === 1, 'SMTP: письмо отправлено по TLS');
    const msgText = got[0] || '';
    const [head, b64] = msgText.split('\r\n\r\n');
    const subj = (head.match(/Subject: ([\s\S]*?)\r\n(?=\S)/) || [])[1] || '';
    const decodedSubj = subj.split(/\r\n /).map(w => Buffer.from(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8')).join('');
    assert(decodedSubj === 'Ordius: заявка на пилот #AAAAA2', 'SMTP: тема в UTF-8 читается');
    assert(Buffer.from((b64 || '').replace(/\r\n/g, ''), 'base64').toString('utf8') === 'Имя: Иван\r\nТехники: 6–15', 'SMTP: текст письма читается');
    assert(/From: =\?UTF-8\?B\?[^\r]+\?= <ordius\.info@yandex\.ru>/.test(head) && head.includes('To: <ordius.info@yandex.ru>'), 'SMTP: отправитель и получатель');
    const bad = await makeMailer({ ...menv, MAIL_PASS: 'wrong' }, { tls: { ca: cert } })({ subject: 's', text: 't' });
    assert(bad === false, 'SMTP: неверный пароль — письмо не считается отправленным');
    const noTrust = await makeMailer(menv)({ subject: 's', text: 't' });
    assert(noTrust === false, 'SMTP: сервер с недоверенным сертификатом отклоняется');
    server.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });

  // --- вход функции ---
  const r0 = await handler({ headers: {}, body: '{}' });
  assert(r0.statusCode === 500, 'без настроек бот не работает');
  process.env.WEBHOOK_SECRET = 's3cret'; process.env.BOT_TOKEN = 'test';
  const r1 = await handler({ headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' }, body: '{}' });
  assert(r1.statusCode === 403, 'вебхук с чужим секретом отклоняется');
  global.fetch = async () => ({ json: async () => ({ ok: true }) });
  const r2 = await handler({ headers: { 'X-Telegram-Bot-Api-Secret-Token': 's3cret' }, body: Buffer.from(JSON.stringify({ message: { chat, from: user, text: '/start' } })).toString('base64'), isBase64Encoded: true }, {});
  assert(r2.statusCode === 200, 'вебхук с секретом и base64-телом — 200');

  console.log(failed ? `\n${failed} проверок не прошло` : '\nВсе проверки прошли');
  process.exitCode = failed ? 1 : 0;
})();
