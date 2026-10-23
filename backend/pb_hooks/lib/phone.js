// Подтверждение номера телефона звонком через SMS.ru. Два способа:
//
//   callcheck (основной) — человек сам звонит на номер, который выдал SMS.ru; звонок сбрасывается,
//     для звонящего бесплатный. Доказывает, что SIM-карта у человека в руках, и не даёт обзванивать
//     чужие номера: сами мы никому не звоним. Статус проверяем запросом к SMS.ru.
//   call (запасной) — робот SMS.ru звонит человеку и сбрасывает, код — последние 4 цифры входящего номера.
//     0,40 ₽ за звонок по России. SMS.ru пометил этот метод устаревшим: работает, пока его не выключат.
//
// SMS не используем: без своего имени отправителя ~18–21 ₽ за сообщение, со своим — 2–3 тыс. ₽ в месяц
// абонентской платы у каждого оператора.
//
// Настройка на сервере, файл /etc/ordius/pocketbase.env:
//   SMSRU_API_ID=<ключ из личного кабинета SMS.ru>
//   ORDIUS_PHONE_DAILY_CAP=300      (необязательно: потолок проверок в сутки на весь сервис)
//   ORDIUS_PHONE_IP_HOURLY=20       (необязательно: проверок в час с одного адреса)
// ORDIUS_SMSRU_BASE — адрес SMS.ru; меняют только автотесты (подставляют местную заглушку).

const PURPOSES = ["signup", "login", "reset", "change"];
const METHODS = ["callcheck", "call"];
const CODE_TTL_MIN = 5;      // столько SMS.ru ждёт звонка (callcheck) / столько живёт код (call)
const TICKET_TTL_MIN = 15;   // столько живёт билет после подтверждения
const MAX_ATTEMPTS = 5;      // неверных вводов кода (call)
const POLL_GAP_MS = 2000;    // не чаще одного запроса статуса к SMS.ru за 2 секунды на проверку
const RU_MOBILE = /^\+79\d{9}$/;

function iso(ms) {
  return new Date(ms).toISOString().replace("T", " ");
}

// Запрос к SMS.ru. Без ключа — ошибка с notConfigured (сервер ответит 503, а не притворится, что звонит).
function smsru(path, params) {
  const key = $os.getenv("SMSRU_API_ID");
  if (!key) {
    const err = new Error("SMSRU_API_ID не задан");
    err.notConfigured = true;
    throw err;
  }
  const all = Object.assign({ api_id: key, json: "1" }, params);
  const body = Object.keys(all).map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(all[k])).join("&");
  const res = $http.send({
    url: ($os.getenv("ORDIUS_SMSRU_BASE") || "https://sms.ru") + path,
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    timeout: 15,
  });
  const j = res.json || {};
  if (res.statusCode !== 200 || j.status !== "OK") {
    throw new Error("SMS.ru " + path + ": " + (j.status_text || j.status_code || res.statusCode));
  }
  return j;
}

// call: робот звонит человеку. → { code, providerId, cost }
function placeCall(phone, ip) {
  const j = smsru("/code/call", { phone: phone.replace(/\D/g, ""), ip: ip || "-1" });
  const code = String(j.code || "");
  if (!/^\d{4}$/.test(code)) throw new Error("SMS.ru /code/call: нет кода в ответе");
  return { code, providerId: String(j.call_id || ""), cost: Number(j.cost) || 0 };
}

// callcheck: человек звонит сам. → { providerId, callPhone, callPhonePretty }
function startCallcheck(phone) {
  const j = smsru("/callcheck/add", { phone: phone.replace(/\D/g, "") });
  const callPhone = String(j.call_phone || "").replace(/\D/g, "");
  if (!j.check_id || callPhone.length < 10) throw new Error("SMS.ru /callcheck/add: нет номера для звонка");
  return { providerId: String(j.check_id), callPhone: "+" + callPhone, callPhonePretty: String(j.call_phone_pretty || "+" + callPhone) };
}

// Статус callcheck: "verified" (звонок был), "waiting" (ещё нет), "expired" (время вышло).
function callcheckStatus(providerId) {
  const j = smsru("/callcheck/status", { check_id: providerId });
  const s = Number(j.check_status);
  if (s === 401) return "verified";
  if (s === 402) return "expired";
  return "waiting";
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

module.exports = {
  PURPOSES, METHODS, CODE_TTL_MIN, TICKET_TTL_MIN, MAX_ATTEMPTS, POLL_GAP_MS, RU_MOBILE,
  iso, placeCall, startCallcheck, callcheckStatus, findTicket,
};
