// Локальная проверка функции формы: node form/test.js
// Почта проверяется на настоящем TLS-соединении с поддельным SMTP-сервером (нужен openssl).
const fs = require('fs');
const os = require('os');
const path = require('path');
const tls = require('tls');
const { execSync } = require('child_process');
const { handleForm, handler, normalizePhone, makeStorage, makeMailer } = require('./index.js');

let failed = 0;
const assert = (c, m) => { if (!c) { failed++; console.error('FAIL:', m); } else console.log('ok  -', m); };

const ORIGIN = 'https://ordius.ru';
const good = { name: '  Иван   Петров ', phone: '8 (923) 123-45-67', company: 'ООО «Ромашка»', fleet: 'b', method: 'x', comment: 'Перезвоните после 14:00', consent: 'yes', website: '', elapsed: '15000' };
const ev = (fields, extra = {}) => ({ httpMethod: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(), ...extra });

const saved = [], mails = [];
let storeOk = true, mailOk = true;
const deps = {
  store: { put: async (k, v) => { if (storeOk) saved.push({ k, v }); return storeOk; } },
  mail: async m => { if (mailOk) mails.push(m); return mailOk; },
  now: () => new Date('2026-10-17T05:30:00.000Z'),
  newRef: () => 'K7M2QX'
};
const env = {};

(async () => {
  // --- нормальная заявка ---
  let r = await handleForm(ev(good), env, deps);
  let b = JSON.parse(r.body);
  assert(r.statusCode === 200 && b.ok && b.ref === 'K7M2QX', 'заявка принята, номер обращения в ответе');
  assert(r.headers['Access-Control-Allow-Origin'] === ORIGIN, 'CORS разрешён только для ordius.ru');
  const rec = saved[0] && saved[0].v;
  assert(saved[0] && saved[0].k === 'forms/2026-10-17/2026-10-17T05-30-00-000Z-K7M2QX.json', 'запись в хранилище по дате');
  assert(rec.name === 'Иван Петров' && rec.phone === '+79231234567' && rec.fleet === '6–15' && rec.method === 'Excel' && rec.company === 'ООО «Ромашка»', 'поля очищены и нормализованы');
  assert(rec.consent.given === true && rec.consent.version === '2026-10-17' && rec.consent.at === rec.at, 'сохранено доказательство согласия');
  assert(!('website' in rec) && !('elapsed' in rec), 'служебные поля не сохраняются');
  assert(mails[0].subject === 'Ordius: заявка на пилот #K7M2QX — Иван Петров' && mails[0].text.includes('+79231234567') && mails[0].text.includes('12:30'), 'письмо с карточкой и временем по Новосибирску');

  // --- JSON и base64 тоже принимаются ---
  saved.length = 0;
  r = await handleForm({ httpMethod: 'POST', headers: { origin: ORIGIN }, body: Buffer.from(JSON.stringify(good)).toString('base64'), isBase64Encoded: true }, env, deps);
  assert(r.statusCode === 200 && saved.length === 1, 'тело в JSON и base64 — принято');

  // --- ошибки заполнения ---
  r = await handleForm(ev({ ...good, name: 'И', phone: '123', fleet: 'z', method: '', consent: '' }), env, deps);
  b = JSON.parse(r.body);
  assert(r.statusCode === 400 && ['name', 'phone', 'fleet', 'method', 'consent'].every(f => b.fields.includes(f)), 'неверные поля — 400 со списком полей');
  r = await handleForm(ev({ ...good, consent: 'no' }), env, deps);
  assert(r.statusCode === 400 && JSON.parse(r.body).fields.join() === 'consent', 'без галочки согласия заявка не принимается');

  // --- спам ---
  saved.length = 0; mails.length = 0;
  r = await handleForm(ev({ ...good, website: 'http://spam.example' }), env, deps);
  assert(r.statusCode === 200 && saved.length === 0 && mails.length === 0, 'поле-ловушка заполнено — молча отбрасываем');
  r = await handleForm(ev({ ...good, elapsed: '900' }), env, deps);
  assert(r.statusCode === 200 && saved.length === 0 && mails.length === 0, 'отправка быстрее человека — молча отбрасываем');
  r = await handleForm(ev({ ...good, elapsed: '' }), env, deps);
  assert(saved.length === 0, 'нет отметки времени — отбрасываем');

  // --- чужие сайты, методы, размер ---
  r = await handleForm(ev(good, { headers: { Origin: 'https://evil.example' } }), env, deps);
  assert(r.statusCode === 403 && !r.headers['Access-Control-Allow-Origin'], 'чужой сайт — 403 без CORS');
  r = await handleForm(ev(good, { headers: {} }), env, deps);
  assert(r.statusCode === 403, 'запрос без Origin (не из браузера с сайта) — 403');
  r = await handleForm(ev(good, { headers: { Referer: 'https://ordius.ru/' } }), env, deps);
  assert(r.statusCode === 200, 'если платформа не передала Origin — сверяемся с Referer');
  r = await handleForm(ev(good, { headers: { Referer: 'https://ordius.ru.evil.example/' } }), env, deps);
  assert(r.statusCode === 403, 'поддельный Referer с похожим адресом — 403');
  r = await handleForm({ httpMethod: 'OPTIONS', headers: { Origin: ORIGIN } }, env, deps);
  assert(r.statusCode === 204 && r.headers['Access-Control-Allow-Methods'].includes('POST'), 'предварительный запрос CORS — 204');
  r = await handleForm({ httpMethod: 'GET', headers: { Origin: ORIGIN } }, env, deps);
  assert(r.statusCode === 405, 'GET — 405');
  r = await handleForm(ev({ ...good, comment: 'x'.repeat(20000) }), env, deps);
  assert(r.statusCode === 413, 'слишком большое тело — 413');
  r = await handleForm(ev(good, { headers: { Origin: 'http://localhost:8765' } }), { ALLOWED_ORIGINS: 'https://ordius.ru, http://localhost:8765' }, deps);
  assert(r.statusCode === 200, 'список разрешённых сайтов настраивается');

  // --- сбои ---
  storeOk = false;
  r = await handleForm(ev(good), env, deps);
  assert(r.statusCode === 200, 'хранилище недоступно, письмо ушло — заявка принята');
  storeOk = true; mailOk = false;
  r = await handleForm(ev(good), env, deps);
  assert(r.statusCode === 200, 'почта недоступна, запись в хранилище есть — заявка принята');
  storeOk = false;
  r = await handleForm(ev(good), env, deps);
  assert(r.statusCode === 502 && JSON.parse(r.body).ok === false, 'недоступно всё — 502, сайт покажет запасной контакт');
  storeOk = true; mailOk = true;

  // --- телефоны ---
  assert(normalizePhone('+7 923 123 45 67') === '+79231234567' && normalizePhone('9231234567') === '+79231234567' && normalizePhone('89231234567') === '+79231234567', 'телефоны РФ в любом написании');
  assert(normalizePhone('+375 29 123 45 67') === '+375291234567' && normalizePhone('12345') === null, 'иностранные номера принимаются, мусор — нет');

  // --- хранилище ---
  const calls = [];
  const fakeFetch = async (url, o) => { calls.push({ url, o }); return { ok: true, text: async () => '' }; };
  const st = makeStorage({ BUCKET: 'ordius-leads' }, { token: { access_token: 'iam123' } }, fakeFetch);
  assert(await st.put('forms/x.json', { a: 1 }) && calls[0].url === 'https://storage.yandexcloud.net/ordius-leads/forms/x.json' && calls[0].o.headers.Authorization === 'Bearer iam123', 'хранилище: PUT с IAM-токеном');
  assert(await makeStorage({}, {}, fakeFetch).put('k', {}) === false && await makeStorage({ BUCKET: 'b' }, {}, fakeFetch).put('k', {}) === false, 'хранилище: без бакета или сервисного аккаунта — запись не считается');

  // --- почта: настоящий TLS ---
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordius-smtp-'));
  let haveSsl = true;
  try { execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 1 -subj /CN=localhost 2>/dev/null`); } catch (e) { haveSsl = false; }
  if (!haveSsl) console.log('skip - openssl не найден, проверка SMTP пропущена');
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
          if (data) { if (line === '.') { data = false; got.push(body); s.write('250 queued\r\n'); } else body += line + '\r\n'; continue; }
          if (line.startsWith('EHLO')) s.write('250-fake\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n');
          else if (line.startsWith('AUTH PLAIN ')) {
            const [, u, p] = Buffer.from(line.slice(11), 'base64').toString('utf8').split('\0');
            s.write(u === 'ordius.info@yandex.ru' && p === 'app-pass' ? '235 ok\r\n' : '535 bad credentials\r\n');
          } else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) s.write('250 ok\r\n');
          else if (line === 'DATA') { data = true; s.write('354 go\r\n'); }
          else if (line === 'QUIT') { s.write('221 bye\r\n'); s.end(); }
          else s.write('500 unknown\r\n');
        }
      });
      s.on('error', () => {});
    });
    await new Promise(res => server.listen(0, '127.0.0.1', res));
    const menv = { MAIL_USER: 'ordius.info@yandex.ru', MAIL_PASS: 'app-pass', MAIL_HOST: 'localhost', MAIL_PORT: String(server.address().port) };
    const ok = await makeMailer(menv, { tls: { ca: cert } })({ subject: 'Ordius: заявка на пилот #K7M2QX — Иван Петров', text: 'Имя: Иван\nТелефон: +79231234567' });
    const [head, b64] = (got[0] || '').split('\r\n\r\n');
    const subj = ((head || '').match(/Subject: ([\s\S]*?)\r\n(?=\S)/) || [])[1] || '';
    const decoded = subj.split(/\r\n /).map(w => Buffer.from(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8')).join('');
    assert(ok && decoded === 'Ordius: заявка на пилот #K7M2QX — Иван Петров', 'SMTP: письмо ушло по TLS, тема читается');
    assert(Buffer.from((b64 || '').replace(/\r\n/g, ''), 'base64').toString('utf8') === 'Имя: Иван\r\nТелефон: +79231234567', 'SMTP: текст читается');
    assert(await makeMailer({ ...menv, MAIL_PASS: 'wrong' }, { tls: { ca: cert } })({ subject: 's', text: 't' }) === false, 'SMTP: неверный пароль — не отправлено');
    assert(await makeMailer(menv)({ subject: 's', text: 't' }) === false, 'SMTP: недоверенный сертификат — отклонён');
    server.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });

  // --- вход функции ---
  const r9 = await handler(ev(good), {});
  assert(r9.statusCode === 502, 'без настроек функция честно сообщает, что заявку сохранить негде');

  console.log(failed ? `\n${failed} проверок не прошло` : '\nВсе проверки прошли');
  process.exitCode = failed ? 1 : 0;
})();
