// Заявки с формы на ordius.ru: проверка полей, защита от спам-ботов, карточка для письма.
// Логика перенесена из облачной функции form/index.js без изменений в правилах.

const SIZES = { a: "1–5", b: "6–15", c: "16–30", d: "больше 30" };
const METHODS = { n: "Тетрадь", x: "Excel", w: "Мессенджер", o: "1С", p: "Другая программа" };
const MIN_FILL_MS = 2500; // человек не заполнит форму быстрее
const DEFAULT_ORIGINS = ["https://ordius.ru", "https://www.ordius.ru"];

const clean = (v, max) => String(v === undefined || v === null ? "" : v)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
const oneLine = (v, max) => clean(v, max * 2).replace(/\s+/g, " ").slice(0, max);
// поле формы может прийти списком, если его отправили дважды
const one = (v) => (Array.isArray(v) ? v[0] : v);

// Бот: заполнил невидимое поле или отправил быстрее человека.
function isBot(f) {
  const elapsed = Number(one(f.elapsed));
  return !!clean(one(f.website), 200) || !isFinite(elapsed) || elapsed < MIN_FILL_MS;
}

// { data } или { errors: [имена полей] }; normalizePhone — из lib/util.js.
function validate(f, normalizePhone) {
  const errors = [];
  const name = oneLine(one(f.name), 80);
  const phone = normalizePhone(oneLine(one(f.phone), 40));
  const company = oneLine(one(f.company), 120);
  const comment = clean(one(f.comment), 1000);
  const fleet = String(one(f.fleet) || "");
  const method = String(one(f.method) || "");
  if (name.length < 2) errors.push("name");
  if (!phone) errors.push("phone");
  if (!Object.prototype.hasOwnProperty.call(SIZES, fleet)) errors.push("fleet");
  if (!Object.prototype.hasOwnProperty.call(METHODS, method)) errors.push("method");
  if (one(f.consent) !== "yes") errors.push("consent");
  if (errors.length) return { errors };
  return { data: { name, phone, company, fleet: SIZES[fleet], method: METHODS[method], comment } };
}

function allowedOrigins(env) {
  const list = String(env || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_ORIGINS;
}

// Откуда пришла заявка: Origin, а если его нет — начало Referer.
function originOf(origin, referer) {
  if (origin) return origin;
  const m = String(referer || "").match(/^(https?:\/\/[^/?#]+)/i);
  return m ? m[1] : "";
}

// Время в Новосибирске (UTC+7, без перехода на летнее) — «27.10.2026 14:05».
function nskTime(iso) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function card(ref, d, iso, consentUrl, consentVersion) {
  const v = consentVersion.split("-").reverse().join(".");
  return [
    `Заявка на пилот #${ref}`,
    "",
    `Имя: ${d.name}`,
    `Телефон: ${d.phone}`,
    `Компания: ${d.company || "—"}`,
    `Техники: ${d.fleet}`,
    `Учёт сейчас: ${d.method}`,
    `Комментарий: ${d.comment || "—"}`,
    "",
    `Отправлено: ${nskTime(iso)} (Новосибирск), форма на ordius.ru`,
    `Согласие на обработку ПД: дано при отправке, редакция от ${v} — ${consentUrl}`,
  ].join("\n");
}

module.exports = { SIZES, METHODS, isBot, validate, allowedOrigins, originOf, card, nskTime };
