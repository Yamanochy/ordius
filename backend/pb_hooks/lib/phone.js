// Подтверждение номера телефона звонком.
//
// Провайдер — SMS.ru, метод «звонок с кодом»: робот звонит человеку и сбрасывает, код — последние
// 4 цифры номера, с которого пришёл звонок. 0,40 ₽ за звонок по России, без имени отправителя
// и абонентской платы (SMS сейчас ~8,4 ₽ плюс 2–3 тыс. ₽ в месяц за имя отправителя у каждого оператора).
//
// Настройка на сервере, файл /etc/ordius/pocketbase.env:
//   SMSRU_API_ID=<ключ из личного кабинета SMS.ru>
//   ORDIUS_PHONE_DAILY_CAP=300      (необязательно: потолок звонков в сутки на весь сервис)
//   ORDIUS_PHONE_IP_HOURLY=20       (необязательно: звонков в час с одного адреса)
// Для автотестов: ORDIUS_PHONE_PROVIDER=test и ORDIUS_TEST_CODE=<4 цифры> — звонка нет.

const PURPOSES = ["signup", "login", "reset", "change"];
const CODE_TTL_MIN = 5;
const TICKET_TTL_MIN = 15;
const MAX_ATTEMPTS = 5;

function iso(ms) {
  return new Date(ms).toISOString().replace("T", " ");
}

// Звонок с кодом. Возвращает { code, callId, cost } или бросает ошибку (err.notConfigured — нет ключа).
function placeCall(phone, ip) {
  const provider = $os.getenv("ORDIUS_PHONE_PROVIDER") || "smsru";
  if (provider === "test") {
    const code = $os.getenv("ORDIUS_TEST_CODE");
    if (!/^\d{4}$/.test(code)) throw new Error("ORDIUS_TEST_CODE не задан");
    return { code, callId: "test", cost: 0 };
  }
  const key = $os.getenv("SMSRU_API_ID");
  if (!key) {
    const err = new Error("SMSRU_API_ID не задан");
    err.notConfigured = true;
    throw err;
  }
  const body = "api_id=" + encodeURIComponent(key) +
    "&phone=" + encodeURIComponent(phone.replace(/\D/g, "")) +
    "&ip=" + encodeURIComponent(ip || "-1") + "&json=1";
  const res = $http.send({
    url: $os.getenv("ORDIUS_SMSRU_URL") || "https://sms.ru/code/call", // подмена адреса — только для автотестов
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    timeout: 15,
  });
  const j = res.json || {};
  const code = String(j.code || "");
  if (res.statusCode !== 200 || j.status !== "OK" || !/^\d{4}$/.test(code)) {
    throw new Error("SMS.ru: " + (j.status_text || j.status_code || res.statusCode));
  }
  return { code, callId: String(j.call_id || ""), cost: Number(j.cost) || 0 };
}

// Подтверждённая и ещё не использованная проверка по билету, или null.
function findTicket(app, ticket, purpose) {
  const t = String(ticket || "");
  if (t.length < 20) return null;
  try {
    return app.findFirstRecordByFilter("phone_checks",
      "ticket_hash = {:h} && status = 'verified' && purpose = {:p} && ticket_expires >= {:now}",
      { h: $security.sha256(t), p: purpose, now: iso(Date.now()) });
  } catch (_) {
    return null;
  }
}

module.exports = { PURPOSES, CODE_TTL_MIN, TICKET_TTL_MIN, MAX_ATTEMPTS, iso, placeCall, findTicket };
