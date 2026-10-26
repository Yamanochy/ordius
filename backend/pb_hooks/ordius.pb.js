/// <reference path="../pb_data/types.d.ts" />
// Серверная логика Ordius. Права доступа проверяют правила коллекций (миграция ordius_schema);
// здесь — то, что правилами не выразить: расчёт смен, вступление в компанию, защита роли владельца,
// служебные поля и журнал изменений.
//
// Каждый обработчик PocketBase выполняет отдельно: переменные верхнего уровня внутри него не видны.
// Поэтому помощники подключаются через require внутри обработчика, а обработчик передаётся напрямую, без обёрток.

// ---------- общее: запись и всё, на что она ссылается, — из одной компании ----------
// Дублирует правила доступа на случай ошибки в них: ни одна ссылка (водитель, техника, объект, смена…)
// не может вести в чужую компанию, а саму компанию у записи сменить нельзя.
const sameCompany = (e) => {
  const rec = e.record;
  const col = rec.collection();
  if (col.name === "companies" || !col.fields.getByName("company")) return e.next();
  const companyId = rec.get("company");
  if (!rec.isNew() && rec.original().get("company") !== companyId) {
    throw new BadRequestError("Компанию у записи менять нельзя");
  }
  const fields = col.fields;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.type() !== "relation" || f.getName() === "company") continue;
    const target = e.app.findCollectionByNameOrId(f.collectionId);
    if (!target.fields.getByName("company")) continue;
    for (const id of rec.getStringSlice(f.getName())) {
      let other = null;
      try { other = e.app.findRecordById(target.id, id); } catch (_) { /* проверит валидация поля */ }
      if (other && other.get("company") !== companyId) {
        throw new BadRequestError(`Поле «${f.getName()}» ссылается на запись другой компании`);
      }
    }
  }
  e.next();
};
onRecordCreateRequest(sameCompany);
onRecordUpdateRequest(sameCompany);

// ---------- пользователи: телефон в едином виде ----------
// Телефон видит только сам человек (и администратор сервера); коллегам — через карточку участника.
onRecordEnrich((e) => {
  const info = e.requestInfo;
  const self = info && info.auth && info.auth.collection().name === "users" && info.auth.id === e.record.id;
  if (!self && !(info && info.hasSuperuserAuth())) e.record.hide("phone");
  e.next();
}, "users");

// Номер меняется только через подтверждение звонком (/api/ordius/phone/change); напрямую — только администратор.
const normalizeUserPhone = (e) => {
  const { normalizePhone } = require(`${__hooks}/lib/util.js`);
  const body = e.requestInfo().body || {};
  const sent = Object.prototype.hasOwnProperty.call(body, "phone");
  if (sent && !e.hasSuperuserAuth() && normalizePhone(body.phone) !== e.record.original().get("phone")) {
    throw new BadRequestError("Номер меняется только с подтверждением звонком");
  }
  if (sent) {
    const raw = String(body.phone || "").trim();
    if (raw) {
      const p = normalizePhone(raw);
      if (!p) throw new BadRequestError("Телефон указан неверно");
      e.record.set("phone", p);
    } else {
      e.record.set("phone", "");
    }
  }
  if (!e.record.get("phone") && !e.record.get("email")) {
    throw new BadRequestError("Нужен телефон или почта");
  }
  e.next();
};
onRecordCreateRequest(normalizeUserPhone, "users");
onRecordUpdateRequest(normalizeUserPhone, "users");

// Вход: телефон в любом написании («8 923…», «+7 (923)…») приводим к виду, в котором он хранится.
onRecordAuthWithPasswordRequest((e) => {
  const { normalizePhone } = require(`${__hooks}/lib/util.js`);
  const p = normalizePhone(e.identity);
  if (p && !e.record) {
    try { e.record = e.app.findFirstRecordByData("users", "phone", p); } catch (_) { /* неверный вход */ }
  }
  e.next();
}, "users");

// ---------- подтверждение номера звонком ----------
// purpose: signup — регистрация, login — вход без пароля, reset — новый пароль, change — смена номера (нужен вход).
// Основной способ (method = callcheck): человек сам звонит на выданный номер, звонок бесплатный и сбрасывается.
//   1) POST /api/ordius/phone/start  { phone, purpose }  → { check, ticket, call_phone, call_phone_pretty, expires }
//   2) POST /api/ordius/phone/status { check }           → { status: waiting | verified | expired }, опрашивать раз в 2–3 с
// Запасной (method = call): робот звонит человеку, тот вводит последние 4 цифры входящего номера.
//   1) POST /api/ordius/phone/start  { phone, purpose, method: "call" } → { check, expires, digits: 4 }
//   2) POST /api/ordius/phone/verify { check, code }     → { ticket }
// 3) Билет (15 минут после подтверждения, один раз) — в signup, phone/login, password-reset или phone/change.
routerAdd("POST", "/api/ordius/phone/start", (e) => {
  const { normalizePhone } = require(`${__hooks}/lib/util.js`);
  const ph = require(`${__hooks}/lib/phone.js`);
  const body = e.requestInfo().body || {};
  const purpose = String(body.purpose || "");
  if (ph.PURPOSES.indexOf(purpose) === -1) throw new BadRequestError("Неизвестная цель проверки");
  const method = String(body.method || "callcheck");
  if (ph.METHODS.indexOf(method) === -1) throw new BadRequestError("Неизвестный способ проверки");
  const phone = normalizePhone(body.phone);
  if (!phone) throw new BadRequestError("Телефон указан неверно");
  // вход в российские сервисы — по номеру российского оператора (закон 406-ФЗ); водители — с мобильных
  if (!ph.RU_MOBILE.test(phone)) throw new BadRequestError("Нужен российский мобильный номер: +7 9…");
  const isUser = e.auth && e.auth.collection().name === "users";
  if (purpose === "change" && !isUser) throw new UnauthorizedError("Войдите в приложение");

  let existing = null;
  try { existing = e.app.findFirstRecordByData("users", "phone", phone); } catch (_) { /* номер свободен */ }
  if ((purpose === "signup" || purpose === "change") && existing) {
    throw new BadRequestError("Этот номер уже зарегистрирован. Войдите или восстановите пароль");
  }
  if ((purpose === "login" || purpose === "reset") && !existing) {
    throw new BadRequestError("Номер не зарегистрирован");
  }

  // Каждый звонок стоит денег и может быть использован, чтобы донимать чужой номер, поэтому лимиты.
  const now = Date.now();
  const count = (filter, params) => e.app.countRecords("phone_checks", $dbx.exp(filter, params));
  const ipHash = $security.sha256("ordius:" + e.realIP());
  if (count("phone = {:p} AND created >= {:t}", { p: phone, t: ph.iso(now - 3600e3) }) >= 3 ||
      count("phone = {:p} AND created >= {:t}", { p: phone, t: ph.iso(now - 86400e3) }) >= 6) {
    throw new TooManyRequestsError("На этот номер уже звонили несколько раз. Попробуйте позже");
  }
  // с одного адреса — 20 звонков в час: хватит, чтобы зарегистрировать бригаду с офисного Wi-Fi
  const perIp = Number($os.getenv("ORDIUS_PHONE_IP_HOURLY")) || 20;
  if (count("ip_hash = {:h} AND created >= {:t}", { h: ipHash, t: ph.iso(now - 3600e3) }) >= perIp) {
    throw new TooManyRequestsError("Слишком много звонков с этого устройства. Попробуйте позже");
  }
  const cap = Number($os.getenv("ORDIUS_PHONE_DAILY_CAP")) || 300;
  if (count("created >= {:t}", { t: ph.iso(now - 86400e3) }) >= cap) {
    e.app.logger().error("phone check daily cap reached", "cap", cap);
    throw new TooManyRequestsError("Сервис подтверждения временно перегружен. Попробуйте через час");
  }

  let call;
  try {
    call = method === "callcheck" ? ph.startCallcheck(phone) : ph.placeCall(phone, e.realIP());
  } catch (err) {
    e.app.logger().error("phone check start failed", "method", method, "error", String(err));
    if (err.notConfigured) throw new ApiError(503, "Подтверждение номера ещё не настроено на сервере", null);
    throw new BadRequestError(method === "callcheck"
      ? "Не получилось начать проверку. Попробуйте через минуту"
      : "Не получилось позвонить. Проверьте номер или подтвердите звонком со своего телефона");
  }
  const rec = new Record(e.app.findCollectionByNameOrId("phone_checks"));
  rec.set("phone", phone);
  rec.set("purpose", purpose);
  rec.set("method", method);
  rec.set("status", "sent");
  rec.set("attempts", 0);
  rec.set("expires", ph.iso(now + ph.CODE_TTL_MIN * 60e3));
  rec.set("ip_hash", ipHash);
  if (purpose === "change") rec.set("user", e.auth.id);
  rec.set("call_id", call.providerId);
  if (method === "call") {
    rec.set("code", call.code);
    rec.set("cost", call.cost);
    e.app.save(rec);
    return e.json(200, { check: rec.id, method, expires: rec.getString("expires"), digits: 4 });
  }
  // callcheck: билет выдаём сразу тому, кто начал проверку; действовать он начнёт после звонка
  const ticket = $security.randomString(40);
  rec.set("call_phone", call.callPhone);
  rec.set("ticket_hash", $security.sha256(ticket));
  e.app.save(rec);
  return e.json(200, {
    check: rec.id, method, ticket, expires: rec.getString("expires"),
    call_phone: call.callPhone, call_phone_pretty: call.callPhonePretty,
  });
});

// Был ли звонок (callcheck): POST /api/ordius/phone/status { check }. Секретов в ответе нет.
routerAdd("POST", "/api/ordius/phone/status", (e) => {
  const ph = require(`${__hooks}/lib/phone.js`);
  const body = e.requestInfo().body || {};
  let rec = null;
  try { rec = e.app.findRecordById("phone_checks", String(body.check || "")); } catch (_) { /* нет такой */ }
  if (!rec || rec.get("method") !== "callcheck") throw new NotFoundError("Проверка не найдена");
  const st = rec.get("status");
  if (st === "verified" || st === "used") return e.json(200, { status: "verified" });
  if (st === "failed") return e.json(200, { status: "expired" });
  const now = Date.now();
  if (rec.getString("expires") < ph.iso(now)) {
    rec.set("status", "failed");
    e.app.save(rec);
    return e.json(200, { status: "expired" });
  }
  const last = rec.getString("last_checked");
  if (last && last > ph.iso(now - ph.POLL_GAP_MS)) return e.json(200, { status: "waiting" });
  rec.set("last_checked", ph.iso(now));
  let result = "waiting";
  try {
    result = ph.callcheckStatus(rec.get("call_id"));
  } catch (err) {
    e.app.logger().error("callcheck status failed", "error", String(err));
  }
  if (result === "verified") {
    rec.set("status", "verified");
    rec.set("ticket_expires", ph.iso(now + ph.TICKET_TTL_MIN * 60e3));
  } else if (result === "expired") {
    rec.set("status", "failed");
  }
  e.app.save(rec);
  return e.json(200, { status: result });
});

routerAdd("POST", "/api/ordius/phone/verify", (e) => {
  const ph = require(`${__hooks}/lib/phone.js`);
  const body = e.requestInfo().body || {};
  let rec = null;
  try { rec = e.app.findRecordById("phone_checks", String(body.check || "")); } catch (_) { /* нет такой */ }
  const again = "Запросите звонок ещё раз";
  if (!rec || rec.get("method") !== "call" || rec.get("status") !== "sent") throw new BadRequestError(again);
  if (rec.getString("expires") < ph.iso(Date.now())) throw new BadRequestError("Время вышло. " + again);
  const code = String(body.code || "").replace(/\D/g, "");
  if (code !== rec.get("code")) {
    const n = rec.getInt("attempts") + 1;
    rec.set("attempts", n);
    if (n >= ph.MAX_ATTEMPTS) { rec.set("status", "failed"); rec.set("code", ""); }
    e.app.save(rec);
    throw new BadRequestError(n >= ph.MAX_ATTEMPTS ? "Слишком много попыток. " + again : "Цифры не совпадают");
  }
  const ticket = $security.randomString(40);
  rec.set("status", "verified");
  rec.set("code", "");
  rec.set("ticket_hash", $security.sha256(ticket));
  rec.set("ticket_expires", ph.iso(Date.now() + ph.TICKET_TTL_MIN * 60e3));
  e.app.save(rec);
  return e.json(200, { ticket, phone: rec.get("phone"), purpose: rec.get("purpose") });
});

// Регистрация: POST /api/ordius/signup { ticket, name, password } → вход сразу (как auth-with-password).
routerAdd("POST", "/api/ordius/signup", (e) => {
  const ph = require(`${__hooks}/lib/phone.js`);
  const body = e.requestInfo().body || {};
  const chk = ph.findTicket(e.app, body.ticket, "signup");
  if (!chk) throw new BadRequestError("Подтвердите номер ещё раз");
  const name = String(body.name || "").trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new BadRequestError("Укажите имя и фамилию");
  const pass = String(body.password || "");
  if (pass.length < 8 || pass.length > 71) throw new BadRequestError("Пароль — от 8 до 71 символа");
  const user = new Record(e.app.findCollectionByNameOrId("users"));
  user.set("name", name.slice(0, 120));
  user.set("phone", chk.get("phone"));
  user.set("emailVisibility", false);
  user.setPassword(pass);
  try {
    e.app.runInTransaction((tx) => {
      tx.save(user);
      chk.set("status", "used");
      chk.set("user", user.id);
      tx.save(chk);
    });
  } catch (err) {
    e.app.logger().error("signup failed", "error", String(err));
    throw new BadRequestError("Не получилось зарегистрироваться: возможно, номер уже занят");
  }
  return $apis.recordAuthResponse(e, user, "phone", null);
});

// Вход без пароля: POST /api/ordius/phone/login { ticket }.
routerAdd("POST", "/api/ordius/phone/login", (e) => {
  const ph = require(`${__hooks}/lib/phone.js`);
  const body = e.requestInfo().body || {};
  const chk = ph.findTicket(e.app, body.ticket, "login");
  if (!chk) throw new BadRequestError("Подтвердите номер ещё раз");
  let user = null;
  try { user = e.app.findFirstRecordByData("users", "phone", chk.get("phone")); } catch (_) { /* удалён */ }
  if (!user) throw new BadRequestError("Номер не зарегистрирован");
  chk.set("status", "used");
  chk.set("user", user.id);
  e.app.save(chk);
  return $apis.recordAuthResponse(e, user, "phone", null);
});

// Смена номера: POST /api/ordius/phone/change { ticket } — билет выдан на новый номер этому же человеку.
routerAdd("POST", "/api/ordius/phone/change", (e) => {
  const ph = require(`${__hooks}/lib/phone.js`);
  const { audit } = require(`${__hooks}/lib/util.js`);
  const body = e.requestInfo().body || {};
  const chk = ph.findTicket(e.app, body.ticket, "change");
  if (!chk || chk.get("user") !== e.auth.id) throw new BadRequestError("Подтвердите новый номер ещё раз");
  const user = e.app.findRecordById("users", e.auth.id);
  const phone = chk.get("phone");
  try {
    e.app.runInTransaction((tx) => {
      user.set("phone", phone);
      tx.save(user);
      chk.set("status", "used");
      tx.save(chk);
      // контактный телефон в карточках сотрудника — тоже новый
      for (const m of tx.findRecordsByFilter("memberships", "user = {:u}", "", 0, 0, { u: user.id })) {
        m.set("phone", phone);
        tx.save(m);
        audit(tx, "update", m, user, { reason: "phone changed" });
      }
    });
  } catch (err) {
    e.app.logger().error("phone change failed", "error", String(err));
    throw new BadRequestError("Не получилось сменить номер: возможно, он уже занят");
  }
  return e.json(200, { phone });
}, $apis.requireAuth("users"));

// Приглашения по номеру: руководитель завёл человека с телефоном — человек видит это после входа
// и сам решает, вступать ли. GET /api/ordius/invitations, POST /api/ordius/invitations/{id}/accept
routerAdd("GET", "/api/ordius/invitations", (e) => {
  const phone = e.auth.get("phone");
  if (!phone) return e.json(200, { items: [] });
  const items = e.app.findRecordsByFilter("memberships",
    "phone = {:p} && user = '' && status != 'dismissed'", "-created", 50, 0, { p: phone })
    .map((m) => {
      const c = e.app.findRecordById("companies", m.get("company"));
      return { membership: m.id, company: c.id, company_name: c.get("name"), display_name: m.get("display_name"), roles: m.get("roles") };
    });
  return e.json(200, { items });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/ordius/invitations/{id}/accept", (e) => {
  const { audit } = require(`${__hooks}/lib/util.js`);
  const phone = e.auth.get("phone");
  let m = null;
  try {
    m = e.app.findFirstRecordByFilter("memberships", "id = {:id} && phone = {:p} && user = '' && status != 'dismissed'",
      { id: e.request.pathValue("id"), p: phone || "-" });
  } catch (_) { /* нет приглашения */ }
  if (!phone || !m) throw new NotFoundError("Приглашение не найдено");
  let dup = null;
  try {
    dup = e.app.findFirstRecordByFilter("memberships", "company = {:c} && user = {:u}", { c: m.get("company"), u: e.auth.id });
  } catch (_) { /* нет дубля */ }
  if (dup) throw new BadRequestError("Вы уже состоите в этой компании");
  m.set("user", e.auth.id);
  m.set("invite_code", "");
  m.set("invite_expires", "");
  if (m.get("status") === "pending") m.set("status", "active");
  e.app.save(m);
  audit(e.app, "update", m, e.auth, { reason: "invitation accepted" });
  const c = e.app.findRecordById("companies", m.get("company"));
  return e.json(200, { membership: m.id, company: c.id, company_name: c.get("name"), status: m.get("status") });
}, $apis.requireAuth("users"));

// Проверки звонков храним 30 дней, потом удаляем.
cronAdd("ordius_phone_checks_cleanup", "17 21 * * *", () => {
  const cutoff = new Date(Date.now() - 30 * 86400e3).toISOString().replace("T", " ");
  $app.db().newQuery("DELETE FROM phone_checks WHERE created < {:t}").bind({ t: cutoff }).execute();
});

// ---------- компании: создатель становится владельцем ----------
onRecordCreateRequest((e) => {
  const { code, rejectServerFields, audit } = require(`${__hooks}/lib/util.js`);
  // тариф меняет только администратор сервера (после оплаты), не клиент
  rejectServerFields(e, ["join_code", "created_by", "plan"]);
  if (!e.record.get("plan")) e.record.set("plan", "pilot");
  e.record.set("join_code", code(8));
  if (e.hasSuperuserAuth()) return e.next();
  const mine = e.app.countRecords("companies", $dbx.hashExp({ created_by: e.auth.id }));
  if (mine >= 5) throw new BadRequestError("Создано уже 5 компаний. Если нужно больше — напишите в поддержку");
  e.record.set("created_by", e.auth.id);
  e.next();

  const m = new Record(e.app.findCollectionByNameOrId("memberships"));
  m.set("company", e.record.id);
  m.set("user", e.auth.id);
  m.set("display_name", e.auth.get("name"));
  m.set("phone", e.auth.get("phone"));
  m.set("roles", ["owner"]);
  m.set("status", "active");
  try {
    e.app.save(m);
  } catch (err) {
    e.app.delete(e.record);
    throw new BadRequestError("Не удалось создать владельца компании: " + err);
  }
  audit(e.app, "create", e.record, e.auth);
}, "companies");

onRecordUpdateRequest((e) => {
  const { rejectServerFields, audit } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["join_code", "created_by", "plan"]);
  e.next();
  audit(e.app, "update", e.record, e.auth);
}, "companies");

// Новый код вступления (старый перестаёт работать): POST /api/ordius/companies/{id}/join-code
routerAdd("POST", "/api/ordius/companies/{id}/join-code", (e) => {
  const { membershipOf, hasRole, code, audit } = require(`${__hooks}/lib/util.js`);
  const company = e.app.findRecordById("companies", e.request.pathValue("id"));
  if (!hasRole(membershipOf(e.app, company.id, e.auth.id), ["owner", "manager"])) {
    throw new ForbiddenError("Только владелец или руководитель");
  }
  company.set("join_code", code(8));
  e.app.save(company);
  audit(e.app, "update", company, e.auth, { reason: "new join_code" });
  return e.json(200, { join_code: company.get("join_code") });
}, $apis.requireAuth("users"));

// ---------- участники ----------
// Вступление: по коду компании — заявка ждёт одобрения; по личному приглашению — сразу в работу.
// POST /api/ordius/join  { code, display_name? }
routerAdd("POST", "/api/ordius/join", (e) => {
  const { nowIso } = require(`${__hooks}/lib/util.js`);
  const body = e.requestInfo().body || {};
  const raw = String(body.code || "").trim().toUpperCase().replace(/[\s-]/g, "");
  if (raw.length < 6) throw new BadRequestError("Введите код");

  // 1) личное приглашение на уже заведённого руководителем человека
  let invited = null;
  try {
    invited = e.app.findFirstRecordByFilter("memberships",
      "invite_code = {:c} && invite_expires >= {:now} && user = ''", { c: raw, now: nowIso() });
  } catch (_) { /* нет такого приглашения */ }
  if (invited) {
    let dup = null;
    try {
      dup = e.app.findFirstRecordByFilter("memberships", "company = {:c} && user = {:u}",
        { c: invited.get("company"), u: e.auth.id });
    } catch (_) { /* нет дубля */ }
    if (dup) throw new BadRequestError("Вы уже состоите в этой компании");
    invited.set("user", e.auth.id);
    invited.set("invite_code", "");
    invited.set("invite_expires", "");
    if (invited.get("status") === "pending") invited.set("status", "active");
    if (!invited.get("phone")) invited.set("phone", e.auth.get("phone"));
    e.app.save(invited);
    const company = e.app.findRecordById("companies", invited.get("company"));
    return e.json(200, { membership: invited.id, company: company.id, company_name: company.get("name"), status: invited.get("status") });
  }

  // 2) общий код компании — заявка
  let company = null;
  try {
    company = e.app.findFirstRecordByFilter("companies", "join_code = {:c}", { c: raw });
  } catch (_) { /* нет такой компании */ }
  if (!company) throw new NotFoundError("Код не подошёл. Проверьте его у руководителя");

  let existing = null;
  try {
    existing = e.app.findFirstRecordByFilter("memberships", "company = {:c} && user = {:u}", { c: company.id, u: e.auth.id });
  } catch (_) { /* нет */ }
  if (existing) {
    return e.json(200, { membership: existing.id, company: company.id, company_name: company.get("name"), status: existing.get("status") });
  }
  const m = new Record(e.app.findCollectionByNameOrId("memberships"));
  m.set("company", company.id);
  m.set("user", e.auth.id);
  m.set("display_name", String(body.display_name || e.auth.get("name") || "").slice(0, 120));
  m.set("phone", e.auth.get("phone"));
  m.set("roles", ["driver"]);
  m.set("status", "pending");
  e.app.save(m);
  return e.json(200, { membership: m.id, company: company.id, company_name: company.get("name"), status: "pending" });
}, $apis.requireAuth("users"));

// Личное приглашение для заведённого человека: POST /api/ordius/memberships/{id}/invite → { code, expires }
routerAdd("POST", "/api/ordius/memberships/{id}/invite", (e) => {
  const { membershipOf, hasRole, code } = require(`${__hooks}/lib/util.js`);
  const m = e.app.findRecordById("memberships", e.request.pathValue("id"));
  if (!hasRole(membershipOf(e.app, m.get("company"), e.auth.id), ["owner", "manager"])) {
    throw new ForbiddenError("Только владелец или руководитель");
  }
  if (m.get("user")) throw new BadRequestError("Человек уже вошёл в приложение");
  const c = code(8);
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().replace("T", " ");
  m.set("invite_code", c);
  m.set("invite_expires", expires);
  e.app.save(m);
  return e.json(200, { code: c, expires });
}, $apis.requireAuth("users"));

// ---------- смена пароля без почты ----------
// Руководитель выдаёт сотруднику одноразовый код на сутки: POST /api/ordius/memberships/{id}/password-code
// Ограничения — чтобы код не стал способом зайти под чужим аккаунтом:
//   владельцу код не выдаётся (только поддержка), руководителю — только владельцем;
//   человеку, который состоит ещё в одной компании, — только поддержка (иначе руководитель
//   одной компании получил бы доступ к данным другой).
routerAdd("POST", "/api/ordius/memberships/{id}/password-code", (e) => {
  const { membershipOf, hasRole, code, audit } = require(`${__hooks}/lib/util.js`);
  const m = e.app.findRecordById("memberships", e.request.pathValue("id"));
  const me = membershipOf(e.app, m.get("company"), e.auth.id);
  if (!hasRole(me, ["owner", "manager"])) throw new ForbiddenError("Только владелец или руководитель");
  const userId = m.get("user");
  if (!userId) throw new BadRequestError("Человек ещё не входил в приложение — выдайте ему приглашение");
  if (userId === e.auth.id) throw new BadRequestError("Свой пароль меняйте в профиле");
  if (m.get("status") !== "active") throw new BadRequestError("Сотрудник не работает в компании");
  if (hasRole(m, ["owner"])) throw new ForbiddenError("Пароль владельца сбрасывается только через поддержку");
  if (hasRole(m, ["manager"]) && !hasRole(me, ["owner"])) throw new ForbiddenError("Код для руководителя выдаёт только владелец");
  const elsewhere = e.app.findRecordsByFilter("memberships",
    "user = {:u} && company != {:c} && status != 'dismissed'", "", 1, 0, { u: userId, c: m.get("company") });
  if (elsewhere.length) throw new BadRequestError("Сотрудник состоит и в другой компании — сброс пароля через поддержку");
  const c = code(8);
  const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString().replace("T", " ");
  m.set("reset_code", c);
  m.set("reset_expires", expires);
  e.app.save(m);
  audit(e.app, "update", m, e.auth, { reason: "password reset code issued" });
  return e.json(200, { code: c, expires });
}, $apis.requireAuth("users"));

// Новый пароль по коду: POST /api/ordius/password-reset { phone, code, password }.
// Все входы на других устройствах после этого сбрасываются.
// Или { ticket, password } — билет после подтверждения номера звонком (purpose = reset).
routerAdd("POST", "/api/ordius/password-reset", (e) => {
  const { normalizePhone, nowIso, audit } = require(`${__hooks}/lib/util.js`);
  const body = e.requestInfo().body || {};
  const pass = String(body.password || "");
  if (pass.length < 8 || pass.length > 71) throw new BadRequestError("Пароль — от 8 до 71 символа");

  if (body.ticket) {
    const ph = require(`${__hooks}/lib/phone.js`);
    const chk = ph.findTicket(e.app, body.ticket, "reset");
    let u = null;
    if (chk) {
      try { u = e.app.findFirstRecordByData("users", "phone", chk.get("phone")); } catch (_) { /* удалён */ }
    }
    if (!u) throw new BadRequestError("Подтвердите номер ещё раз");
    e.app.runInTransaction((tx) => {
      u.setPassword(pass);
      tx.save(u);
      chk.set("status", "used");
      chk.set("user", u.id);
      tx.save(chk);
    });
    return e.json(200, { ok: true });
  }

  const phone = normalizePhone(body.phone);
  const c = String(body.code || "").trim().toUpperCase().replace(/[\s-]/g, "");
  const wrong = "Телефон или код не подходят";
  if (!phone || c.length < 6) throw new BadRequestError(wrong);
  let user = null;
  let m = null;
  try {
    user = e.app.findFirstRecordByData("users", "phone", phone);
    m = e.app.findFirstRecordByFilter("memberships",
      "user = {:u} && reset_code = {:c} && reset_expires >= {:now} && status = 'active'", { u: user.id, c, now: nowIso() });
  } catch (_) { /* неверный телефон или код */ }
  if (!user || !m) throw new BadRequestError(wrong);
  e.app.runInTransaction((txApp) => {
    user.setPassword(pass);
    txApp.save(user);
    m.set("reset_code", "");
    m.set("reset_expires", "");
    txApp.save(m);
  });
  audit(e.app, "update", m, user, { reason: "password reset by code" });
  return e.json(200, { ok: true });
});

// Роль владельца: выдаёт и снимает только владелец; у компании всегда остаётся хотя бы один владелец.
const guardOwners = (e) => {
  const isCreate = e.record.isNew();
  const { membershipOf, hasRole, normalizePhone, rejectServerFields, audit } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["invite_code", "invite_expires"]);
  const phone = e.record.get("phone");
  if (phone) {
    const p = normalizePhone(phone);
    if (!p) throw new BadRequestError("Телефон указан неверно");
    e.record.set("phone", p);
  }
  if (!e.hasSuperuserAuth()) {
    const me = membershipOf(e.app, e.record.get("company"), e.auth.id);
    const iAmOwner = hasRole(me, ["owner"]);
    const was = isCreate ? [] : (e.record.original().get("roles") || []);
    const now = e.record.get("roles") || [];
    const touchesOwner = (was.indexOf("owner") !== -1) !== (now.indexOf("owner") !== -1) ||
      (!isCreate && was.indexOf("owner") !== -1 && e.record.get("status") !== e.record.original().get("status"));
    if (touchesOwner && !iAmOwner) throw new ForbiddenError("Роль владельца может менять только владелец");
    if (!isCreate && was.indexOf("owner") !== -1 && (now.indexOf("owner") === -1 || e.record.get("status") !== "active")) {
      const owners = e.app.findRecordsByFilter("memberships",
        "company = {:c} && status = 'active' && roles ?= 'owner' && id != {:id}", "", 0, 0,
        { c: e.record.get("company"), id: e.record.id });
      if (!owners.length) throw new BadRequestError("В компании должен остаться хотя бы один владелец");
    }
  }
  if (e.record.get("status") === "dismissed" && !e.record.getString("dismissed_on")) {
    e.record.set("dismissed_on", new Date().toISOString().slice(0, 10) + " 00:00:00.000Z");
  }
  e.next();
  audit(e.app, isCreate ? "create" : "update", e.record, e.auth);
};
onRecordCreateRequest(guardOwners, "memberships");
onRecordUpdateRequest(guardOwners, "memberships");

// ---------- смены: расчёт при подтверждении ----------
// Поля смены, которые ставит только сервер: amount_kop, calc, confirmed_by, confirmed_at, created_by.

onRecordCreateRequest((e) => {
  const { rejectServerFields, audit } = require(`${__hooks}/lib/util.js`);
  const billing = require(`${__hooks}/lib/billing.js`);
  rejectServerFields(e, ["amount_kop", "calc", "confirmed_by", "confirmed_at", "created_by"]);
  e.record.set("created_by", e.auth ? e.auth.id : "");
  billing.contractDefaults(e.app, e.record);
  e.next();
  audit(e.app, "create", e.record, e.auth);
}, "shifts");

onRecordUpdateRequest((e) => {
  const { rejectServerFields, audit, nowIso } = require(`${__hooks}/lib/util.js`);
  const calc = require(`${__hooks}/lib/calc.js`);
  const billing = require(`${__hooks}/lib/billing.js`);
  rejectServerFields(e, ["amount_kop", "calc", "confirmed_by", "confirmed_at", "created_by"]);
  const before = e.record.original().get("status");
  const after = e.record.get("status");
  billing.contractDefaults(e.app, e.record);

  if (after === "confirmed" && before !== "confirmed") {
    const shift = e.record;
    const companyId = shift.get("company");
    const entries = e.app.findRecordsByFilter("shift_entries", "shift = {:s}", "created", 0, 0, { s: shift.id })
      .map((r) => ({ id: r.id, unit: r.get("unit"), vehicle: r.get("vehicle"), quantity: r.get("quantity"),
        tons: r.get("tons"), km: r.get("km"), overtime: r.get("overtime") }));
    const rates = e.app.findRecordsByFilter("rates", "company = {:c} && unit != 'month'", "", 0, 0, { c: companyId })
      .map((r) => ({ id: r.id, unit: r.get("unit"), amount_kop: r.get("amount_kop"), member: r.get("member"),
        vehicle: r.get("vehicle"), site: r.get("site"), customer: r.get("customer"),
        valid_from: r.getString("valid_from"), valid_to: r.getString("valid_to") }));
    const factors = e.app.findRecordsByFilter("rate_factors", "company = {:c}", "", 0, 0, { c: companyId })
      .map((r) => ({ kind: r.get("kind"), factor_permille: r.get("factor_permille"),
        valid_from: r.getString("valid_from"), valid_to: r.getString("valid_to") }));
    let result;
    try {
      result = calc.calcShift({ member: shift.get("member"), site: shift.get("site"), customer: shift.get("customer"),
        date: shift.getString("date"), night: shift.get("night"), holiday: shift.get("holiday") }, entries, rates, factors);
    } catch (err) {
      throw new BadRequestError("Смену нельзя подтвердить: " + err.message, err.missing ? { missing: err.missing } : undefined);
    }
    shift.set("amount_kop", result.amount_kop);
    shift.set("calc", result);
    shift.set("confirmed_by", e.auth ? e.auth.id : "");
    shift.set("confirmed_at", nowIso());
    shift.set("reject_reason", "");
  } else if (before === "confirmed" && after !== "confirmed") {
    e.record.set("amount_kop", null);
    e.record.set("calc", null);
    e.record.set("confirmed_by", "");
    e.record.set("confirmed_at", "");
  }
  if (after === "rejected" && !String(e.record.get("reject_reason") || "").trim()) {
    throw new BadRequestError("Укажите причину, по которой смена возвращена");
  }
  e.next();
  // Выручка по контракту: считается при подтверждении и не мешает ему — пробелы видны в реестре.
  if (after === "confirmed" && before !== "confirmed") {
    try { billing.saveBill(e.app, e.record, calc); } catch (err) { e.app.logger().error("bill failed", "shift", e.record.id, "error", String(err)); }
  } else if (before === "confirmed" && after !== "confirmed") {
    billing.deleteBill(e.app, e.record.id);
  }
  audit(e.app, "update", e.record, e.auth, { status: { from: before, to: after } });
}, "shifts");

onRecordDeleteRequest((e) => {
  const { audit } = require(`${__hooks}/lib/util.js`);
  e.next();
  audit(e.app, "delete", e.record, e.auth);
}, "shifts");

// Строки смены: количество по единице расчёта; позиция — из контракта этой смены.
const checkEntry = (e) => {
  const r = e.record;
  const unit = r.get("unit");
  const q = r.get("quantity") > 0;
  if (unit === "tkm" && (!(r.get("tons") > 0) || !(r.get("km") > 0))) {
    throw new BadRequestError("Для тонно-километров укажите тонны и километры");
  }
  const need = { hour: "Укажите часы", trip: "Укажите число рейсов", lin_m: "Укажите погонные метры",
    sq_m: "Укажите квадратные метры", cu_m: "Укажите кубометры", piece: "Укажите количество" };
  if (need[unit] && !q) throw new BadRequestError(need[unit]);
  if (unit === "km" && !q && !(r.get("km") > 0)) throw new BadRequestError("Укажите километры");
  if (unit === "ton" && !q && !(r.get("tons") > 0)) throw new BadRequestError("Укажите тонны");
  if (r.get("contract_item")) {
    const billing = require(`${__hooks}/lib/billing.js`);
    let item = null, shift = null;
    try { item = e.app.findRecordById("contract_items", r.get("contract_item")); } catch (_) { /* проверит валидация */ }
    try { shift = e.app.findRecordById("shifts", r.get("shift")); } catch (_) { /* проверит валидация */ }
    const contract = shift ? billing.contractOf(e.app, shift) : "";
    if (item && contract && item.get("contract") !== contract) {
      throw new BadRequestError("Эта позиция — из другого контракта, не того, по которому идёт смена");
    }
  }
  e.next();
  // показания из путевого — текущие показания машины; подошёл срок ТО — задача механику
  const vehicleId = r.get("vehicle");
  if (vehicleId) {
    const fleet = require(`${__hooks}/lib/fleet.js`);
    const calc = require(`${__hooks}/lib/calc.js`);
    try {
      if (fleet.bumpReadings(e.app, vehicleId, r.get("odometer_end") || r.get("odometer_start"),
        r.get("engine_hours_end") || r.get("engine_hours_start"))) {
        fleet.syncMaintenanceTasks(e.app, calc, "vehicle = {:v}", { v: vehicleId });
      }
    } catch (err) { e.app.logger().error("readings failed", "vehicle", vehicleId, "error", String(err)); }
  }
};
onRecordCreateRequest(checkEntry, "shift_entries");
onRecordUpdateRequest(checkEntry, "shift_entries");

// ---------- деньги: кто внёс, журнал ----------
const moneyCreate = (e) => {
  const { rejectServerFields, audit } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["created_by", "member_confirmed_at"]);
  e.record.set("created_by", e.auth ? e.auth.id : "");
  e.next();
  audit(e.app, "create", e.record, e.auth);
};
const moneyUpdate = (e) => {
  const { rejectServerFields, audit, nowIso } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["created_by", "member_confirmed_at"]);
  if (e.record.collection().name === "payouts") {
    const nowConfirmed = e.record.get("member_confirmed");
    if (nowConfirmed && !e.record.original().get("member_confirmed")) {
      if (e.record.get("status") !== "paid") throw new BadRequestError("Выплата ещё не проведена");
      e.record.set("member_confirmed_at", nowIso());
    } else if (!nowConfirmed) {
      e.record.set("member_confirmed_at", "");
    }
  }
  e.next();
  audit(e.app, "update", e.record, e.auth);
};
const moneyDelete = (e) => {
  const { audit } = require(`${__hooks}/lib/util.js`);
  e.next();
  audit(e.app, "delete", e.record, e.auth);
};
for (const c of ["adjustments", "payouts"]) {
  onRecordCreateRequest(moneyCreate, c);
  onRecordUpdateRequest(moneyUpdate, c);
  onRecordDeleteRequest(moneyDelete, c);
}
// rotations — от графика вахт зависят суточные, поэтому изменения тоже в журнал
for (const c of ["rates", "rate_factors", "contracts", "contract_items", "contract_prices", "fuel_cards", "maintenance_plans",
  "rotations"]) {
  onRecordCreateRequest((e) => { const { audit } = require(`${__hooks}/lib/util.js`); e.next(); audit(e.app, "create", e.record, e.auth); }, c);
  onRecordUpdateRequest((e) => { const { audit } = require(`${__hooks}/lib/util.js`); e.next(); audit(e.app, "update", e.record, e.auth); }, c);
  onRecordDeleteRequest((e) => { const { audit } = require(`${__hooks}/lib/util.js`); e.next(); audit(e.app, "delete", e.record, e.auth); }, c);
}

// ---------- документы, задачи, объявления: автор ставится сервером ----------
onRecordCreateRequest((e) => {
  const { rejectServerFields } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["uploaded_by"]);
  e.record.set("uploaded_by", e.auth ? e.auth.id : "");
  e.next();
}, "documents");

onRecordCreateRequest((e) => {
  const { rejectServerFields } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["created_by", "closed_at", "maintenance_plan"]);
  e.record.set("created_by", e.auth ? e.auth.id : "");
  if (!e.record.get("status")) e.record.set("status", "new");
  if (!e.record.get("priority")) e.record.set("priority", "normal");
  e.next();
}, "tasks");

onRecordUpdateRequest((e) => {
  const { rejectServerFields, nowIso } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["created_by", "closed_at", "maintenance_plan"]);
  const before = e.record.original();
  const fromStatus = before.get("status");
  const toStatus = e.record.get("status");
  const reassigned = before.get("assignee") !== e.record.get("assignee") ||
    before.get("assignee_role") !== e.record.get("assignee_role");
  if (toStatus !== fromStatus) {
    e.record.set("closed_at", toStatus === "done" || toStatus === "cancelled" ? nowIso() : "");
  }
  e.next();
  const col = e.app.findCollectionByNameOrId("task_events");
  const add = (kind, extra) => {
    const ev = new Record(col);
    ev.set("company", e.record.get("company"));
    ev.set("task", e.record.id);
    ev.set("author", e.auth ? e.auth.id : "");
    ev.set("kind", kind);
    for (const k in extra) ev.set(k, extra[k]);
    e.app.save(ev);
  };
  if (toStatus !== fromStatus) add("status", { from_status: fromStatus, to_status: toStatus });
  if (reassigned) add("assign", { text: e.record.get("assignee") || e.record.get("assignee_role") || "" });
}, "tasks");

onRecordCreateRequest((e) => {
  const { rejectServerFields } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["author", "from_status", "to_status"]);
  e.record.set("author", e.auth ? e.auth.id : "");
  e.next();
}, "task_events");

onRecordCreateRequest((e) => {
  const { rejectServerFields } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["author"]);
  e.record.set("author", e.auth ? e.auth.id : "");
  e.next();
}, "posts");

// ---------- расчётная ведомость ----------
// GET /api/ordius/payroll?company=…&from=ГГГГ-ММ-ДД&to=ГГГГ-ММ-ДД[&member=…][&format=csv]
// Владелец, руководитель и бухгалтер видят всех; остальные — только себя.
// В строке: смены, оклад, премии, суточные за дни вахты, дорога, удержания, НДФЛ, начислено, на руки, к выплате.
// НДФЛ — нарастающим итогом с начала года; ставки компании вносятся «на руки» или до НДФЛ (companies.rates_basis).
routerAdd("GET", "/api/ordius/payroll", (e) => {
  const { membershipOf, hasRole } = require(`${__hooks}/lib/util.js`);
  const calc = require(`${__hooks}/lib/calc.js`);
  const q = e.requestInfo().query || {};
  const companyId = String(q.company || "");
  const from = String(q.from || "").slice(0, 10);
  const to = String(q.to || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new BadRequestError("Укажите период: from и to в виде ГГГГ-ММ-ДД");
  }
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (days > 370) throw new BadRequestError("Период не длиннее года");
  const me = membershipOf(e.app, companyId, e.auth.id);
  if (!me) throw new ForbiddenError("Нет доступа к компании");
  const company = e.app.findRecordById("companies", companyId);
  const basis = company.get("rates_basis") === "gross" ? "gross" : "net";
  const freeKop = company.get("per_diem_free_kop") || 70000;
  const today = new Date().toISOString().slice(0, 10);
  const seeAll = hasRole(me, ["owner", "manager", "accountant"]);
  let members;
  if (seeAll) {
    members = q.member
      ? [e.app.findFirstRecordByFilter("memberships", "id = {:id} && company = {:c}", { id: String(q.member), c: companyId })]
      : e.app.findRecordsByFilter("memberships", "company = {:c} && status != 'pending'", "display_name", 0, 0, { c: companyId });
  } else {
    members = [me];
  }
  const perDiemRates = e.app.findRecordsByFilter("rates", "company = {:c} && unit = 'per_diem'", "", 0, 0, { c: companyId })
    .map((r) => ({ id: r.id, unit: "per_diem", amount_kop: r.get("amount_kop"), member: r.get("member"), vehicle: r.get("vehicle"),
      site: r.get("site"), customer: r.get("customer"), valid_from: r.getString("valid_from"), valid_to: r.getString("valid_to") }));

  // Всё, из чего складывается заработок человека за [f; t].
  const inputs = (m, f, t) => {
    const p = { m: m.id, c: companyId, from: f + " 00:00:00.000Z", to: t + " 23:59:59.999Z" };
    const shifts = e.app.findRecordsByFilter("shifts", "member = {:m} && date >= {:from} && date <= {:to}", "date", 0, 0, p)
      .map((s) => ({ status: s.get("status"), amount_kop: s.get("amount_kop") }));
    const monthRates = e.app.findRecordsByFilter("rates", "company = {:c} && unit = 'month' && member = {:m}", "", 0, 0, p)
      .map((r) => ({ unit: "month", amount_kop: r.get("amount_kop"), valid_from: r.getString("valid_from"), valid_to: r.getString("valid_to") }));
    const adjustments = e.app.findRecordsByFilter("adjustments", "member = {:m} && date >= {:from} && date <= {:to}", "", 0, 0, p)
      .map((a) => ({ kind: a.get("kind"), amount_kop: a.get("amount_kop") }));
    const rotations = e.app.findRecordsByFilter("rotations",
      "member = {:m} && date_from <= {:to} && date_to >= {:from} && (status = 'active' || status = 'done')", "date_from", 0, 0, p)
      .map((r) => ({ member: m.id, site: r.get("site"), status: r.get("status"),
        date_from: r.getString("date_from"), date_to: r.getString("date_to") }));
    const perDiem = calc.perDiemForPeriod(rotations, perDiemRates, f, t, today, freeKop);
    return { shifts, monthRates, adjustments, perDiem, from: f, to: t };
  };
  const yearSegments = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    yearSegments.push({ from: y === Number(from.slice(0, 4)) ? from : `${y}-01-01`, to: y === Number(to.slice(0, 4)) ? to : `${y}-12-31` });
  }

  const rows = members.map((m) => {
    const all = inputs(m, from, to);
    let ndfl = 0;
    if (!m.get("no_ndfl")) {
      for (const seg of yearSegments) {
        const base = calc.payComponents(yearSegments.length === 1 ? all : inputs(m, seg.from, seg.to)).taxable_kop;
        const yearStart = seg.from.slice(0, 4) + "-01-01";
        const ytd = seg.from > yearStart ? calc.payComponents(inputs(m, yearStart, calc.addDays(seg.from, -1))).taxable_kop : 0;
        ndfl += calc.ndflPeriod(basis, ytd, base);
      }
    }
    const p = { m: m.id, from: from + " 00:00:00.000Z", to: to + " 23:59:59.999Z" };
    const payouts = e.app.findRecordsByFilter("payouts",
      "member = {:m} && ((period_from != '' && period_from <= {:to} && period_to >= {:from}) || (period_from = '' && paid_on >= {:from} && paid_on <= {:to}))",
      "", 0, 0, p).map((x) => ({ status: x.get("status"), amount_kop: x.get("amount_kop") }));
    return Object.assign({
      member: m.id, display_name: m.get("display_name"), personnel_no: m.get("personnel_no"), status: m.get("status"),
      no_ndfl: !!m.get("no_ndfl"),
    }, calc.payrollSummary(Object.assign({}, all, { payouts, ndfl_kop: ndfl, basis })));
  });

  if (q.format === "csv") {
    const rub = (k) => (k / 100).toFixed(2).replace(".", ",");
    const esc = (s) => '"' + String(s || "").replace(/"/g, '""') + '"';
    const head = ["Табельный №", "ФИО", "Смен подтверждено", "Смен не подтверждено", "По сменам, ₽", "Оклад, ₽",
      "Премии, ₽", "Дней вахты", "Суточные, ₽", "Дорога, ₽", "Начислено до НДФЛ, ₽", "НДФЛ, ₽", "Удержания, ₽",
      "На руки, ₽", "Выплачено, ₽", "К выплате, ₽"];
    const lines = [head.map(esc).join(";")].concat(rows.map((r) => [
      esc(r.personnel_no), esc(r.display_name), r.shifts_confirmed, r.shifts_pending, rub(r.earned_kop), rub(r.salary_kop),
      rub(r.bonuses_kop), r.per_diem_days, rub(r.per_diem_kop), rub(r.travel_kop), rub(r.gross_kop), rub(r.ndfl_kop),
      rub(r.deductions_kop), rub(r.accrued_kop), rub(r.paid_kop), rub(r.due_kop),
    ].join(";")));
    e.response.header().set("Content-Type", "text/csv; charset=utf-8");
    e.response.header().set("Content-Disposition", `attachment; filename="ordius-${from}_${to}.csv"`);
    return e.string(200, "\uFEFF" + lines.join("\r\n") + "\r\n");
  }
  return e.json(200, { company: companyId, from, to, basis, rows });
}, $apis.requireAuth("users"));

// ---------- выручка: пересчёт, реестр для заказчика, отчёт по деньгам ----------
// Пересчитать выручку подтверждённых смен за период (например, после того как внесли недостающую цену).
// POST /api/ordius/bills/recalc { company, from, to } — владелец или руководитель.
routerAdd("POST", "/api/ordius/bills/recalc", (e) => {
  const { membershipOf, hasRole } = require(`${__hooks}/lib/util.js`);
  const calc = require(`${__hooks}/lib/calc.js`);
  const billing = require(`${__hooks}/lib/billing.js`);
  const body = e.requestInfo().body || {};
  const companyId = String(body.company || "");
  const from = String(body.from || "").slice(0, 10);
  const to = String(body.to || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new BadRequestError("Укажите период: from и to в виде ГГГГ-ММ-ДД");
  }
  if (!hasRole(membershipOf(e.app, companyId, e.auth.id), ["owner", "manager"])) {
    throw new ForbiddenError("Только владелец или руководитель");
  }
  const shifts = e.app.findRecordsByFilter("shifts",
    "company = {:c} && status = 'confirmed' && date >= {:from} && date <= {:to}", "date", 0, 0,
    { c: companyId, from: from + " 00:00:00.000Z", to: to + " 23:59:59.999Z" });
  let incomplete = 0;
  for (const sh of shifts) {
    const bill = billing.saveBill(e.app, sh, calc);
    if (bill && bill.get("status") === "incomplete") incomplete++;
  }
  return e.json(200, { shifts: shifts.length, incomplete });
}, $apis.requireAuth("users"));

// Реестр выполненных работ по контракту — основа акта и сверки с заказчиком.
// GET /api/ordius/registry?company=…&contract=…&from=…&to=…[&format=csv] — владелец, руководитель, бухгалтер.
routerAdd("GET", "/api/ordius/registry", (e) => {
  const { membershipOf, hasRole, jsonOf } = require(`${__hooks}/lib/util.js`);
  const calc = require(`${__hooks}/lib/calc.js`);
  const billing = require(`${__hooks}/lib/billing.js`);
  const q = e.requestInfo().query || {};
  const companyId = String(q.company || "");
  const from = String(q.from || "").slice(0, 10);
  const to = String(q.to || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new BadRequestError("Укажите период: from и to в виде ГГГГ-ММ-ДД");
  }
  if (!hasRole(membershipOf(e.app, companyId, e.auth.id), ["owner", "manager", "accountant"])) {
    throw new ForbiddenError("Реестр видят владелец, руководитель и бухгалтер");
  }
  let contract = null;
  try {
    contract = e.app.findFirstRecordByFilter("contracts", "id = {:id} && company = {:c}", { id: String(q.contract || ""), c: companyId });
  } catch (_) { /* нет */ }
  if (!contract) throw new NotFoundError("Контракт не найден");
  const customer = e.app.findRecordById("customers", contract.get("customer"));

  const names = (col, filter) => {
    const m = {};
    for (const r of e.app.findRecordsByFilter(col, filter, "", 0, 0, { c: companyId })) m[r.id] = r;
    return m;
  };
  const sites = names("sites", "company = {:c}");
  const vehicles = names("vehicles", "company = {:c}");
  const members = names("memberships", "company = {:c}");
  const vname = (id) => (vehicles[id] ? [vehicles[id].get("name"), vehicles[id].get("plate")].filter(Boolean).join(" ") : "");
  const vatOf = (amount, vat) => (/^\d+$/.test(String(vat || "")) && Number(vat) > 0
    ? Math.round(amount * Number(vat) / (100 + Number(vat))) : 0);

  const range = { k: contract.id, from: from + " 00:00:00.000Z", to: to + " 23:59:59.999Z" };
  const bills = e.app.findRecordsByFilter("shift_bills", "contract = {:k} && date >= {:from} && date <= {:to}", "date", 0, 0, range);
  const lines = [];
  const missing = [];
  for (const b of bills) {
    let sh = null;
    try { sh = e.app.findRecordById("shifts", b.get("shift")); } catch (_) { continue; }
    const base = { date: b.getString("date").slice(0, 10), shift: sh.id, site: sites[sh.get("site")] ? sites[sh.get("site")].get("name") : "",
      driver: members[sh.get("member")] ? members[sh.get("member")].get("display_name") : "" };
    for (const l of jsonOf(b, "lines", [])) {
      lines.push(Object.assign({}, base, { vehicle: vname(l.vehicle), item: l.item, item_name: l.item_name, unit: l.unit,
        unit_label: calc.UNIT_LABEL[l.unit] || l.unit, quantity: l.quantity, price_kop: l.price_kop, vat: l.vat,
        amount_kop: l.amount_kop, vat_kop: vatOf(l.amount_kop, l.vat) }));
    }
    for (const m of jsonOf(b, "missing", [])) missing.push(Object.assign({}, base, { vehicle: vname(m.vehicle), reason: m.reason }));
  }
  // абонентские позиции («в месяц») — пропорционально дням периода
  const items = billing.loadItems(e.app, contract.id);
  const prices = billing.loadPrices(e.app, items.filter((i) => i.unit === "month").map((i) => i.id));
  for (const it of items.filter((i) => i.unit === "month" && i.active !== false)) {
    const amount = calc.monthlyForPeriod(it, prices, from, to);
    if (!amount) continue;
    const p = calc.pickPrice(prices, it.id, to) || {};
    lines.push({ date: "", shift: "", site: "", driver: "", vehicle: "", item: it.id, item_name: it.name, unit: "month",
      unit_label: "месяц", quantity: null, price_kop: p.price_kop || null, vat: p.vat || "", amount_kop: amount,
      vat_kop: vatOf(amount, p.vat) });
  }
  const byItem = {};
  for (const l of lines) {
    const t = byItem[l.item] || (byItem[l.item] = { item: l.item, item_name: l.item_name, unit_label: l.unit_label, quantity: 0, amount_kop: 0, vat_kop: 0 });
    t.quantity = Math.round((t.quantity + (l.quantity || 0)) * 1000) / 1000;
    t.amount_kop += l.amount_kop;
    t.vat_kop += l.vat_kop;
  }
  const total = lines.reduce((a, l) => a + l.amount_kop, 0);
  const vatTotal = lines.reduce((a, l) => a + l.vat_kop, 0);
  // выполнено по контракту за всё время — против цены контракта
  const done = e.app.findRecordsByFilter("shift_bills", "contract = {:k}", "", 0, 0, { k: contract.id })
    .reduce((a, b) => a + (b.get("amount_kop") || 0), 0);

  if (q.format === "csv") {
    const rub = (k) => (k / 100).toFixed(2).replace(".", ",");
    const num = (v) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
    const esc = (v) => '"' + String(v === null || v === undefined ? "" : v).replace(/"/g, '""') + '"';
    const out = [
      [esc(`Реестр работ по контракту ${contract.get("number") || ""} «${contract.get("title")}»`)].join(";"),
      [esc(`Заказчик: ${customer.get("name")}`), esc(`Период: ${from} — ${to}`)].join(";"),
      "",
      ["Дата", "Объект", "Техника", "Водитель", "Позиция", "Ед.", "Кол-во", "Цена, ₽", "Сумма, ₽", "в т.ч. НДС, ₽"].map(esc).join(";"),
    ];
    for (const l of lines) {
      out.push([esc(l.date), esc(l.site), esc(l.vehicle), esc(l.driver), esc(l.item_name), esc(l.unit_label),
        num(l.quantity), l.price_kop === null ? "" : rub(l.price_kop), rub(l.amount_kop), rub(l.vat_kop)].join(";"));
    }
    out.push("", [esc("Итого по позициям")].join(";"));
    for (const t of Object.values(byItem)) {
      out.push(["", "", "", "", esc(t.item_name), esc(t.unit_label), num(t.quantity), "", rub(t.amount_kop), rub(t.vat_kop)].join(";"));
    }
    out.push(["", "", "", "", esc("ИТОГО"), "", "", "", rub(total), rub(vatTotal)].join(";"));
    if (missing.length) {
      out.push("", esc("Не выставлено — нужно исправить"));
      for (const m of missing) out.push([esc(m.date), esc(m.site), esc(m.vehicle), esc(m.driver), esc(m.reason)].join(";"));
    }
    e.response.header().set("Content-Type", "text/csv; charset=utf-8");
    e.response.header().set("Content-Disposition", `attachment; filename="reestr-${from}_${to}.csv"`);
    return e.string(200, "﻿" + out.join("\r\n") + "\r\n");
  }
  return e.json(200, {
    contract: { id: contract.id, number: contract.get("number"), title: contract.get("title"), limit_kop: contract.get("limit_kop") || null },
    customer: { id: customer.id, name: customer.get("name") },
    from, to, lines, totals: Object.values(byItem), total_kop: total, vat_kop: vatTotal, missing, done_kop: done,
  });
}, $apis.requireAuth("users"));

// Деньги за период: выручка по контрактам, оплата людям по сменам и разница между ними.
// GET /api/ordius/revenue?company=…&from=…&to=…&group=customer|contract|site|vehicle — владелец, руководитель, бухгалтер.
routerAdd("GET", "/api/ordius/revenue", (e) => {
  const { membershipOf, hasRole, jsonOf } = require(`${__hooks}/lib/util.js`);
  const q = e.requestInfo().query || {};
  const companyId = String(q.company || "");
  const from = String(q.from || "").slice(0, 10);
  const to = String(q.to || "").slice(0, 10);
  const group = String(q.group || "customer");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new BadRequestError("Укажите период: from и to в виде ГГГГ-ММ-ДД");
  }
  if (["customer", "contract", "site", "vehicle"].indexOf(group) === -1) throw new BadRequestError("group: customer, contract, site или vehicle");
  if (!hasRole(membershipOf(e.app, companyId, e.auth.id), ["owner", "manager", "accountant"])) {
    throw new ForbiddenError("Деньги компании видят владелец, руководитель и бухгалтер");
  }
  const range = { c: companyId, from: from + " 00:00:00.000Z", to: to + " 23:59:59.999Z" };
  const shifts = e.app.findRecordsByFilter("shifts",
    "company = {:c} && status = 'confirmed' && date >= {:from} && date <= {:to}", "", 0, 0, range);
  const shiftById = {};
  for (const sh of shifts) shiftById[sh.id] = sh;
  const bills = e.app.findRecordsByFilter("shift_bills", "company = {:c} && date >= {:from} && date <= {:to}", "", 0, 0, range);

  const col = { customer: "customers", contract: "contracts", site: "sites", vehicle: "vehicles" }[group];
  const nameOf = {};
  for (const r of e.app.findRecordsByFilter(col, "company = {:c}", "", 0, 0, { c: companyId })) {
    nameOf[r.id] = group === "contract" ? [r.get("number"), r.get("title")].filter(Boolean).join(" ")
      : group === "vehicle" ? [r.get("name"), r.get("plate")].filter(Boolean).join(" ") : r.get("name");
  }
  const rows = {};
  const row = (key) => rows[key] || (rows[key] = { key, name: key ? (nameOf[key] || "—") : "Без " + { customer: "заказчика",
    contract: "контракта", site: "объекта", vehicle: "техники" }[group], bill_kop: 0, pay_kop: 0, shifts: {}, incomplete: 0 });

  for (const sh of shifts) {
    if (group === "vehicle") {
      for (const l of jsonOf(sh, "calc", {}).lines || []) { const r = row(l.vehicle || ""); r.pay_kop += l.amount_kop || 0; r.shifts[sh.id] = 1; }
    } else {
      const r = row(sh.get(group) || "");
      r.pay_kop += sh.get("amount_kop") || 0;
      r.shifts[sh.id] = 1;
    }
  }
  for (const b of bills) {
    const sh = shiftById[b.get("shift")];
    if (group === "vehicle") {
      for (const l of jsonOf(b, "lines", [])) row(l.vehicle || "").bill_kop += l.amount_kop || 0;
      if (b.get("status") === "incomplete") for (const m of jsonOf(b, "missing", [])) row(m.vehicle || "").incomplete++;
    } else {
      const key = group === "site" ? (sh ? sh.get("site") : "") : b.get(group) || "";
      const r = row(key);
      r.bill_kop += b.get("amount_kop") || 0;
      if (b.get("status") === "incomplete") r.incomplete++;
    }
  }
  const out = Object.values(rows).map((r) => ({ key: r.key, name: r.name, bill_kop: r.bill_kop, pay_kop: r.pay_kop,
    margin_kop: r.bill_kop - r.pay_kop, shifts: Object.keys(r.shifts).length, incomplete: r.incomplete }))
    .sort((a, b) => b.bill_kop - a.bill_kop || b.pay_kop - a.pay_kop);
  const sum = (f) => out.reduce((a, r) => a + r[f], 0);
  return e.json(200, { from, to, group, rows: out,
    total: { bill_kop: sum("bill_kop"), pay_kop: sum("pay_kop"), margin_kop: sum("margin_kop") } });
}, $apis.requireAuth("users"));

// ---------- топливные карты: ПИН зашифрован, выдаётся отдельным запросом и попадает в журнал ----------
onRecordCreateRequest((e) => {
  const { rejectServerFields } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["pin_set"]);
  e.record.set("pin_set", false);
  e.next();
}, "fuel_cards");
onRecordUpdateRequest((e) => {
  const { rejectServerFields } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["pin_set"]);
  e.next();
}, "fuel_cards");

// Ключ шифрования ПИН выводится из ключа шифрования настроек PocketBase: отдельный секрет не нужен,
// а при восстановлении из копии ключ приезжает вместе с базой.
// POST /api/ordius/fuel-cards/{id}/pin { pin } — владелец или руководитель; пустой pin — стереть.
routerAdd("POST", "/api/ordius/fuel-cards/{id}/pin", (e) => {
  const { membershipOf, hasRole, audit } = require(`${__hooks}/lib/util.js`);
  const card = e.app.findRecordById("fuel_cards", e.request.pathValue("id"));
  if (!hasRole(membershipOf(e.app, card.get("company"), e.auth.id), ["owner", "manager"])) {
    throw new ForbiddenError("ПИН задаёт владелец или руководитель");
  }
  const pin = String((e.requestInfo().body || {}).pin || "").trim();
  if (pin && !/^\d{4,8}$/.test(pin)) throw new BadRequestError("ПИН — от 4 до 8 цифр");
  const base = $os.getenv("PB_ENCRYPTION_KEY");
  if (!base) throw new ApiError(503, "На сервере не задан ключ шифрования", null);
  card.set("pin_enc", pin ? $security.encrypt(pin, $security.hs256("ordius-fuel-pin", base).slice(0, 32)) : "");
  card.set("pin_set", !!pin);
  e.app.save(card);
  audit(e.app, "update", card, e.auth, { reason: pin ? "pin set" : "pin cleared" });
  return e.json(200, { pin_set: !!pin });
}, $apis.requireAuth("users"));

// GET /api/ordius/fuel-cards/{id}/pin — владелец, руководитель или тот, за кем закреплена карта.
routerAdd("GET", "/api/ordius/fuel-cards/{id}/pin", (e) => {
  const { membershipOf, hasRole, audit } = require(`${__hooks}/lib/util.js`);
  const card = e.app.findRecordById("fuel_cards", e.request.pathValue("id"));
  const me = membershipOf(e.app, card.get("company"), e.auth.id);
  if (!me) throw new ForbiddenError("Нет доступа");
  if (!hasRole(me, ["owner", "manager"]) && card.get("holder") !== me.id) {
    throw new ForbiddenError("ПИН видит только тот, за кем закреплена карта, и руководство");
  }
  if (!card.get("pin_enc")) throw new NotFoundError("ПИН не задан");
  const pin = $security.decrypt(card.get("pin_enc"), $security.hs256("ordius-fuel-pin", $os.getenv("PB_ENCRYPTION_KEY")).slice(0, 32));
  audit(e.app, "view", card, e.auth, { reason: "pin viewed" });
  return e.json(200, { pin });
}, $apis.requireAuth("users"));

// ---------- график вахт: даты по порядку, у человека вахты не накладываются ----------
const checkRotation = (e) => {
  const { rejectServerFields } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["created_by"]);
  const r = e.record;
  if (r.isNew()) r.set("created_by", e.auth ? e.auth.id : "");
  const df = r.getString("date_from").slice(0, 10);
  const dt = r.getString("date_to").slice(0, 10);
  if (df && dt && dt < df) throw new BadRequestError("Конец вахты раньше начала");
  if (r.get("status") !== "cancelled" && df && dt) {
    let clash = null;
    try {
      clash = e.app.findFirstRecordByFilter("rotations",
        "member = {:m} && status != 'cancelled' && id != {:id} && date_from <= {:to} && date_to >= {:from}",
        { m: r.get("member"), id: r.id || "", from: df + " 00:00:00.000Z", to: dt + " 23:59:59.999Z" });
    } catch (_) { /* пересечений нет */ }
    if (clash) throw new BadRequestError("У человека уже есть вахта на эти даты");
  }
  e.next();
};
onRecordCreateRequest(checkRotation, "rotations");
onRecordUpdateRequest(checkRotation, "rotations");

// ---------- сообщения: автор ставится сервером ----------
onRecordCreateRequest((e) => {
  const { rejectServerFields } = require(`${__hooks}/lib/util.js`);
  rejectServerFields(e, ["author"]);
  e.record.set("author", e.auth ? e.auth.id : "");
  e.next();
}, "messages");

// ---------- заправки и журнал ТО: автор — сервер; показания — в карточку машины; ТО — задачи механику ----------
const fleetCreate = (e) => {
  const { rejectServerFields, audit } = require(`${__hooks}/lib/util.js`);
  const fleet = require(`${__hooks}/lib/fleet.js`);
  const calc = require(`${__hooks}/lib/calc.js`);
  rejectServerFields(e, ["created_by"]);
  const isNew = e.record.isNew();
  if (isNew) e.record.set("created_by", e.auth ? e.auth.id : "");
  e.next();
  const r = e.record;
  const vehicleId = r.get("vehicle");
  try {
    fleet.bumpReadings(e.app, vehicleId, r.get("odometer"), r.get("engine_hours"));
    if (r.collection().name === "maintenance_logs") fleet.applyLog(e.app, r, e.auth ? e.auth.id : "");
    fleet.syncMaintenanceTasks(e.app, calc, "vehicle = {:v}", { v: vehicleId });
  } catch (err) { e.app.logger().error("fleet update failed", "vehicle", vehicleId, "error", String(err)); }
  audit(e.app, isNew ? "create" : "update", r, e.auth);
};
for (const c of ["fuel_logs", "maintenance_logs"]) {
  onRecordCreateRequest(fleetCreate, c);
  onRecordUpdateRequest(fleetCreate, c);
  onRecordDeleteRequest((e) => { const { audit } = require(`${__hooks}/lib/util.js`); e.next(); audit(e.app, "delete", e.record, e.auth); }, c);
}

// ТО по сроку (дням) наступает и без новых показаний — проверка раз в час.
cronAdd("ordius_maintenance", "41 * * * *", () => {
  const fleet = require(`${__hooks}/lib/fleet.js`);
  const calc = require(`${__hooks}/lib/calc.js`);
  try { fleet.syncMaintenanceTasks($app, calc, "", {}); } catch (err) { $app.logger().error("maintenance sync failed", "error", String(err)); }
});

// Состояние ТО по всем машинам: что просрочено, что скоро, сколько осталось.
// GET /api/ordius/maintenance?company=… — офис и механик.
routerAdd("GET", "/api/ordius/maintenance", (e) => {
  const { membershipOf, hasRole } = require(`${__hooks}/lib/util.js`);
  const fleet = require(`${__hooks}/lib/fleet.js`);
  const calc = require(`${__hooks}/lib/calc.js`);
  const companyId = String((e.requestInfo().query || {}).company || "");
  if (!hasRole(membershipOf(e.app, companyId, e.auth.id), ["owner", "manager", "dispatcher", "accountant", "mechanic"])) {
    throw new ForbiddenError("Состояние ТО видят офис и механик");
  }
  const order = { overdue: 0, soon: 1, unknown: 2, ok: 3 };
  const rows = [];
  for (const p of e.app.findRecordsByFilter("maintenance_plans", "company = {:c} && active = true", "", 0, 0, { c: companyId })) {
    let v = null;
    try { v = e.app.findRecordById("vehicles", p.get("vehicle")); } catch (_) { continue; }
    const st = calc.maintenanceStatus(fleet.planOf(p), fleet.readingsOf(v), fleet.today());
    const open = e.app.findRecordsByFilter("tasks", "maintenance_plan = {:p} && status != 'done' && status != 'cancelled'",
      "", 1, 0, { p: p.id });
    rows.push({ plan: p.id, name: p.get("name"), vehicle: v.id, vehicle_name: fleet.vehicleName(v),
      odometer_now: v.get("odometer_now"), engine_hours_now: v.get("engine_hours_now"), readings_at: v.getString("readings_at"),
      status: st.status, parts: st.parts, task: open.length ? open[0].id : "" });
  }
  rows.sort((a, b) => order[a.status] - order[b.status] || a.vehicle_name.localeCompare(b.vehicle_name));
  return e.json(200, { rows });
}, $apis.requireAuth("users"));

// Проверить сроки ТО сейчас и поставить задачи (иначе это делает расписание раз в час).
// POST /api/ordius/maintenance/sync { company } — руководство и механик.
routerAdd("POST", "/api/ordius/maintenance/sync", (e) => {
  const { membershipOf, hasRole } = require(`${__hooks}/lib/util.js`);
  const fleet = require(`${__hooks}/lib/fleet.js`);
  const calc = require(`${__hooks}/lib/calc.js`);
  const companyId = String((e.requestInfo().body || {}).company || "");
  if (!hasRole(membershipOf(e.app, companyId, e.auth.id), ["owner", "manager", "mechanic"])) {
    throw new ForbiddenError("Только руководство и механик");
  }
  return e.json(200, { created: fleet.syncMaintenanceTasks(e.app, calc, "company = {:c}", { c: companyId }) });
}, $apis.requireAuth("users"));

// ГСМ за период по каждой машине: пробег и моточасы по путевым, расход против нормы, заправки против путевых.
// GET /api/ordius/fuel?company=…&from=…&to=…[&vehicle=…][&format=csv] — офис и механик.
routerAdd("GET", "/api/ordius/fuel", (e) => {
  const { membershipOf, hasRole } = require(`${__hooks}/lib/util.js`);
  const fleet = require(`${__hooks}/lib/fleet.js`);
  const calc = require(`${__hooks}/lib/calc.js`);
  const q = e.requestInfo().query || {};
  const companyId = String(q.company || "");
  const from = String(q.from || "").slice(0, 10);
  const to = String(q.to || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new BadRequestError("Укажите период: from и to в виде ГГГГ-ММ-ДД");
  }
  if (!hasRole(membershipOf(e.app, companyId, e.auth.id), ["owner", "manager", "dispatcher", "accountant", "mechanic"])) {
    throw new ForbiddenError("Учёт ГСМ видят офис и механик");
  }
  const p = { c: companyId, v: String(q.vehicle || ""), from: from + " 00:00:00.000Z", to: to + " 23:59:59.999Z" };
  const byVehicle = q.vehicle ? " && vehicle = {:v}" : "";
  const vehicles = e.app.findRecordsByFilter("vehicles", "company = {:c}" + (q.vehicle ? " && id = {:v}" : ""), "name", 0, 0, p);
  const entries = {};
  for (const r of e.app.findRecordsByFilter("shift_entries",
    "company = {:c} && vehicle != '' && shift.date >= {:from} && shift.date <= {:to}" + byVehicle, "", 0, 0, p)) {
    (entries[r.get("vehicle")] = entries[r.get("vehicle")] || []).push({
      odometer_start: r.get("odometer_start"), odometer_end: r.get("odometer_end"),
      engine_hours_start: r.get("engine_hours_start"), engine_hours_end: r.get("engine_hours_end"),
      fuel_start: r.get("fuel_start"), fuel_end: r.get("fuel_end"), fuel_added: r.get("fuel_added"),
    });
  }
  const logs = {};
  for (const r of e.app.findRecordsByFilter("fuel_logs", "company = {:c} && at >= {:from} && at <= {:to}" + byVehicle, "", 0, 0, p)) {
    (logs[r.get("vehicle")] = logs[r.get("vehicle")] || []).push({ liters: r.get("liters"), amount_kop: r.get("amount_kop") });
  }
  const rows = [];
  for (const v of vehicles) {
    if (!entries[v.id] && !logs[v.id]) continue;
    rows.push(Object.assign({ vehicle: v.id, vehicle_name: fleet.vehicleName(v),
      fuel_norm_100km: v.get("fuel_norm_100km") || null, fuel_norm_hour: v.get("fuel_norm_hour") || null },
    calc.fuelSummary({ fuel_norm_100km: v.get("fuel_norm_100km"), fuel_norm_hour: v.get("fuel_norm_hour") },
      entries[v.id] || [], logs[v.id] || [])));
  }
  if (q.format === "csv") {
    const num = (x) => (x === null || x === undefined ? "" : String(x).replace(".", ","));
    const esc = (x) => '"' + String(x || "").replace(/"/g, '""') + '"';
    const head = ["Техника", "Км", "Моточасы", "Расход по путевым, л", "Норма, л", "Перерасход, л", "Перерасход, %",
      "Заправлено по чекам и картам, л", "Сумма заправок, ₽", "Записано в путевых, л", "Не отражено в путевых, л"];
    const out = [head.map(esc).join(";")].concat(rows.map((r) => [esc(r.vehicle_name), num(r.km), num(r.hours), num(r.used_l),
      num(r.norm_l), num(r.overrun_l), num(r.overrun_pct), num(r.refueled_l), num(r.spent_kop / 100), num(r.added_waybills_l),
      num(r.not_in_waybills_l)].join(";")));
    e.response.header().set("Content-Type", "text/csv; charset=utf-8");
    e.response.header().set("Content-Disposition", `attachment; filename="gsm-${from}_${to}.csv"`);
    return e.string(200, "\uFEFF" + out.join("\r\n") + "\r\n");
  }
  return e.json(200, { from, to, rows });
}, $apis.requireAuth("users"));
