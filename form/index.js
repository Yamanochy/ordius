// ============================================================
// Ordius — приём заявок на пилот с формы на ordius.ru.
// Облачная функция Yandex Cloud Functions (Node.js 18+), публичный HTTPS-вызов.
// Один файл, без сторонних библиотек.
//
// Что делает с заявкой:
//   1) проверяет поля, отсекает спам-ботов (поле-ловушка, слишком быстрая отправка);
//   2) записывает заявку в бакет Object Storage в России (ч. 5 ст. 18 152-ФЗ),
//      вместе с отметкой о согласии (когда дано, какая редакция);
//   3) отправляет карточку письмом в ящик оператора на Яндекс Почте.
// Трансграничной передачи нет. В логи персональные данные не пишутся.
//
// Переменные окружения:
//   BUCKET           — имя бакета Object Storage
//   MAIL_USER        — ящик, например ordius.info@yandex.ru
//   MAIL_PASS        — пароль приложения Яндекс Почты (не основной пароль!)
//   MAIL_TO          — куда слать карточки (необязательно, по умолчанию MAIL_USER)
//   ALLOWED_ORIGINS  — сайты, с которых принимаются заявки (необязательно, по умолчанию https://ordius.ru)
// У функции должен быть сервисный аккаунт с ролью storage.uploader.
// ============================================================

const tls = require('tls');
const crypto = require('crypto');

const TZ = 'Asia/Novosibirsk';
const CONSENT_URL = 'https://ordius.ru/consent.html';
const CONSENT_VERSION = '2026-10-17';
const MIN_FILL_MS = 2500;
const MAX_BODY = 10000;

const SIZES = { a: '1–5', b: '6–15', c: '16–30', d: 'больше 30' };
const METHODS = { n: 'Тетрадь', x: 'Excel', w: 'Мессенджер', o: '1С', p: 'Другая программа' };

// ---------- помощники ----------
const REF_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRef = () => Array.from(crypto.randomBytes(6), b => REF_ABC[b % REF_ABC.length]).join('');
const fmtTime = at => new Date(at).toLocaleString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const oneLine = (v, max) => clean(v, max * 2).replace(/\s+/g, ' ').slice(0, max);

function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10 && d[0] === '9') d = '7' + d;
  return d.length >= 11 && d.length <= 15 ? '+' + d : null;
}

// Проверка полей. Возвращает { data } или { errors: [имена полей] }.
function validate(f) {
  const errors = [];
  const name = oneLine(f.name, 80);
  const phone = normalizePhone(f.phone);
  const company = oneLine(f.company, 120);
  const comment = clean(f.comment, 1000);
  if (name.length < 2) errors.push('name');
  if (!phone) errors.push('phone');
  if (!SIZES[f.fleet]) errors.push('fleet');
  if (!METHODS[f.method]) errors.push('method');
  if (f.consent !== 'yes') errors.push('consent');
  if (errors.length) return { errors };
  return { data: { name, phone, company, fleet: SIZES[f.fleet], method: METHODS[f.method], comment } };
}

function parseBody(event) {
  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (raw.length > MAX_BODY) return { tooLarge: true };
  const t = raw.trim();
  if (t.startsWith('{')) { try { return { fields: JSON.parse(t) }; } catch (e) { return { fields: {} }; } }
  return { fields: Object.fromEntries(new URLSearchParams(raw)) };
}

function card(ref, d, at) {
  return [
    `Заявка на пилот #${ref}`,
    '',
    `Имя: ${d.name}`,
    `Телефон: ${d.phone}`,
    `Компания: ${d.company || '—'}`,
    `Техники: ${d.fleet}`,
    `Учёт сейчас: ${d.method}`,
    `Комментарий: ${d.comment || '—'}`,
    '',
    `Отправлено: ${fmtTime(at)} (Новосибирск), форма на ordius.ru`,
    `Согласие на обработку ПД: дано при отправке, редакция от 17.10.2026 — ${CONSENT_URL}`
  ].join('\n');
}

// ---------- хранилище: Object Storage в России ----------
function makeStorage(env, context, fetchImpl) {
  const base = env.BUCKET ? `https://storage.yandexcloud.net/${encodeURIComponent(env.BUCKET)}/` : '';
  return {
    async put(key, obj) {
      if (!base) { console.error('BUCKET not set'); return false; }
      const t = context && context.token;
      if (!t || !t.access_token) { console.error('no IAM token: assign a service account to the function'); return false; }
      try {
        const r = await fetchImpl(base + key, {
          method: 'PUT',
          headers: { Authorization: 'Bearer ' + t.access_token, 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(obj)
        });
        if (!r.ok) { console.error('storage put error', r.status, await r.text().catch(() => '')); return false; }
        return true;
      } catch (e) { console.error('storage put error', e && e.message); return false; }
    }
  };
}

// ---------- почта: SMTP Яндекс Почты ----------
function encodeWord(s) {
  const chars = Array.from(String(s)), parts = [];
  for (let i = 0; i < chars.length; i += 10) parts.push('=?UTF-8?B?' + Buffer.from(chars.slice(i, i + 10).join(''), 'utf8').toString('base64') + '?=');
  return parts.join('\r\n ');
}

function buildMessage({ from, to, subject, text }) {
  const body = Buffer.from(String(text).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${encodeWord('Сайт Ordius')} <${from}>`,
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

// ---------- обработка запроса ----------
async function handleForm(event, env, deps) {
  const headers = Object.fromEntries(Object.entries((event && event.headers) || {}).map(([k, v]) => [k.toLowerCase(), v]));
  let origin = headers.origin || '';
  if (!origin && headers.referer) { try { origin = new URL(headers.referer).origin; } catch (e) { origin = ''; } }
  const allowed = String(env.ALLOWED_ORIGINS || 'https://ordius.ru').split(',').map(s => s.trim()).filter(Boolean);
  const cors = allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  const reply = (statusCode, obj, extra = {}) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors, ...extra },
    body: JSON.stringify(obj)
  });
  const method = String(event.httpMethod || 'POST').toUpperCase();

  if (!allowed.includes(origin)) return reply(403, { ok: false, error: 'origin' });
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }, body: '' };
  }
  if (method !== 'POST') return reply(405, { ok: false, error: 'method' }, { Allow: 'POST, OPTIONS' });

  const parsed = parseBody(event);
  if (parsed.tooLarge) return reply(413, { ok: false, error: 'too_large' });
  const f = parsed.fields || {};

  // Спам-боты: заполнили невидимое поле или отправили быстрее человека. Отвечаем «успехом», но ничего не сохраняем.
  const elapsed = Number(f.elapsed);
  if (clean(f.website, 200) || !Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) return reply(200, { ok: true });

  const v = validate(f);
  if (v.errors) return reply(400, { ok: false, error: 'validation', fields: v.errors });

  const at = (deps.now ? deps.now() : new Date()).toISOString();
  const ref = (deps.newRef || newRef)();
  const record = {
    type: 'pilot_form', at, ref, ...v.data, source: 'ordius.ru',
    consent: { given: true, at, document: CONSENT_URL, version: CONSENT_VERSION }
  };
  const key = `forms/${at.slice(0, 10)}/${at.replace(/[:.]/g, '-')}-${ref}.json`;
  const saved = await deps.store.put(key, record);
  const mailed = await deps.mail({ subject: `Ordius: заявка на пилот #${ref} — ${v.data.name}`, text: card(ref, v.data, at) });
  if (!saved && !mailed) return reply(502, { ok: false, error: 'unavailable' });
  if (!saved || !mailed) console.error('partial delivery', { ref, saved, mailed });
  return reply(200, { ok: true, ref });
}

// ---------- вход для Yandex Cloud Functions ----------
module.exports.handler = async function (event, context) {
  const env = process.env;
  try {
    return await handleForm(event || {}, env, { store: makeStorage(env, context, fetch), mail: makeMailer(env) });
  } catch (e) {
    console.error('handler error', e && e.message);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: '{"ok":false,"error":"internal"}' };
  }
};

module.exports.handleForm = handleForm;
module.exports.validate = validate;
module.exports.normalizePhone = normalizePhone;
module.exports.makeStorage = makeStorage;
module.exports.makeMailer = makeMailer;
