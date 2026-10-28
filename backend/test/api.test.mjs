// Проверка схемы, правил доступа и серверной логики Ordius на настоящем PocketBase.
//   PB_BIN=/путь/к/pocketbase node backend/test/api.test.mjs
// Поднимает PocketBase во временной папке с миграциями и хуками из репозитория,
// проходит сценарий пилота двумя компаниями и проверяет, что чужие данные не видны.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PB = process.env.PB_BIN;
const TERMS = createRequire(import.meta.url)(join(ROOT, "pb_hooks/lib/legal.js")).TERMS_VERSION;
if (!PB) { console.error("Укажите PB_BIN — путь к pocketbase"); process.exit(2); }

let failed = 0, passed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log("ok  -", name); }
  else { failed++; console.log("FAIL:", name, detail !== undefined ? JSON.stringify(detail).slice(0, 400) : ""); }
};
const is2xx = (r) => r.status >= 200 && r.status < 300;

const freePort = () => new Promise((res) => {
  const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});

// ---------- заглушка SMS.ru: настоящих звонков нет, но сервер ходит в «SMS.ru» по-настоящему ----------
// /code/call — робот «звонит», код всегда TEST_CODE; /callcheck/add и /callcheck/status — человек звонит сам;
// /__call?check_id=… — тест «звонит» с телефона человека, /__expire?check_id=… — время вышло.
import http from "node:http";
const TEST_CODE = "1435";
const SMSRU_KEY = "TEST-API-ID";
const seen = [];
const called = new Set(), expired = new Set();
let checkSeq = 0;
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => { b += c; }); req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const params = Object.fromEntries(new URLSearchParams(b));
    res.setHeader("Content-Type", "application/json");
    const send = (o) => res.end(JSON.stringify(o));
    if (u.pathname === "/__call") { called.add(u.searchParams.get("check_id")); return send({ ok: true }); }
    if (u.pathname === "/__expire") { expired.add(u.searchParams.get("check_id")); return send({ ok: true }); }
    seen.push({ path: u.pathname, method: req.method, params });
    if (params.api_id !== SMSRU_KEY) return send({ status: "ERROR", status_code: 200, status_text: "Неправильный api_id" });
    if (u.pathname === "/code/call") return send({ status: "OK", code: TEST_CODE, call_id: "201737-542", cost: 0.4, balance: 99.6 });
    if (u.pathname === "/callcheck/add") {
      const id = `201737-${++checkSeq}`;
      return send({ status: "OK", status_code: 100, check_id: id, call_phone: "78005553535",
        call_phone_pretty: "+7 (800) 555-3535", call_phone_html: "<a href=\"callto:78005553535\">+7 (800) 555-3535</a>" });
    }
    if (u.pathname === "/callcheck/status") {
      const id = params.check_id;
      const st = called.has(id) ? 401 : expired.has(id) ? 402 : 400;
      return send({ status: "OK", status_code: 100, check_status: st, check_status_text: String(st) });
    }
    res.statusCode = 404; send({ status: "ERROR" });
  });
});
const mockPort = await freePort();
await new Promise((r) => mock.listen(mockPort, "127.0.0.1", r));
const MOCK = `http://127.0.0.1:${mockPort}`;
const callFromPhone = (providerId) => fetch(`${MOCK}/__call?check_id=${encodeURIComponent(providerId)}`);

const dir = mkdtempSync(join(tmpdir(), "ordius-pb-"));
const port = await freePort();
const BASE = `http://127.0.0.1:${port}`;
const env = { ...process.env, PB_ENCRYPTION_KEY: "abcdefghijklmnopqrstuvwxyz012345",
  SMSRU_API_ID: SMSRU_KEY, ORDIUS_SMSRU_BASE: MOCK, ORDIUS_PHONE_IP_HOURLY: "1000",
  ORDIUS_ADMIN_PHONES: "8 923 000-00-01" };  // Иван Петров (A) — администратор Ordius
const args = [`--dir=${dir}/pb_data`, `--migrationsDir=${ROOT}/pb_migrations`, `--hooksDir=${ROOT}/pb_hooks`, "--encryptionEnv=PB_ENCRYPTION_KEY"];
execFileSync(PB, ["superuser", "upsert", "admin@test.local", "Adm1nPassw0rd!", ...args], { env, stdio: "ignore" });
const srv = spawn(PB, ["serve", `--http=127.0.0.1:${port}`, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
let srvLog = "";
srv.stdout.on("data", (d) => { srvLog += d; });
srv.stderr.on("data", (d) => { srvLog += d; });
const stop = () => { try { srv.kill(); } catch (_) {} try { mock.close(); } catch (_) {} rmSync(dir, { recursive: true, force: true }); };
process.on("exit", stop);

for (let i = 0; i < 100; i++) {
  try { if ((await fetch(BASE + "/api/health")).ok) break; } catch (_) {}
  await new Promise((r) => setTimeout(r, 100));
}

async function api(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(BASE + path, { method, headers, body: payload });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text };
}
const list = async (col, token, filter) => {
  const q = filter ? `?perPage=200&filter=${encodeURIComponent(filter)}` : "?perPage=200";
  const r = await api("GET", `/api/collections/${col}/records${q}`, { token });
  return r.json && r.json.items ? r.json.items : [];
};
const create = (col, token, body) => api("POST", `/api/collections/${col}/records`, { token, body });
const update = (col, id, token, body) => api("PATCH", `/api/collections/${col}/records/${id}`, { token, body });
const view = (col, id, token) => api("GET", `/api/collections/${col}/records/${id}`, { token });

// ---------- подготовка ----------
const su = (await api("POST", "/api/collections/_superusers/auth-with-password",
  { body: { identity: "admin@test.local", password: "Adm1nPassw0rd!" } })).json.token;
const settings = (await api("GET", "/api/settings", { token: su })).json;
const labels = settings.rateLimits.rules.map((r) => r.label);
check("ограничения частоты: стандартные правила на месте и добавлены коды и звонки",
  settings.rateLimits.enabled && ["*:auth", "POST /api/ordius/join", "POST /api/ordius/password-reset", "POST /api/ordius/phone/start",
    "POST /api/ordius/phone/verify", "POST /api/ordius/phone/status", "POST /api/ordius/signup", "POST /api/ordius/lead", "companies:create"]
    .every((l) => labels.includes(l)), labels);
check("в журнале запросов нет IP, хранится 14 дней", settings.logs.logIP === false && settings.logs.maxDays === 14, settings.logs);
await api("PATCH", "/api/settings", { token: su, body: { rateLimits: { enabled: false } } });

const PASS = "Test-passw0rd-123";
// Подтверждение номера. Основной путь: человек звонит на выданный номер → статус «verified» → билет.
const phoneStart = (phone, purpose, token, method) => api("POST", "/api/ordius/phone/start", { token, body: { phone, purpose, method } });
const phoneStatus = (check) => api("POST", "/api/ordius/phone/status", { body: { check } });
const phoneVerify = (check, code) => api("POST", "/api/ordius/phone/verify", { body: { check, code } });
const providerIdOf = async (check) => (await view("phone_checks", check, su)).json.call_id;
async function ticketFor(phone, purpose, token) {
  const s1 = await phoneStart(phone, purpose, token);
  if (!is2xx(s1)) throw new Error(`phone/start ${phone} ${purpose}: ${s1.text}`);
  await callFromPhone(await providerIdOf(s1.json.check));
  const s2 = await phoneStatus(s1.json.check);
  if (!is2xx(s2) || s2.json.status !== "verified") throw new Error(`phone/status ${phone}: ${s2.text}`);
  return s1.json.ticket;
}
async function signup(name, phone) {
  const r = await api("POST", "/api/ordius/signup", { body: { ticket: await ticketFor(phone, "signup"), name, password: PASS, terms: TERMS } });
  if (!is2xx(r)) throw new Error("signup " + name + ": " + r.text);
  return r.json;
}
async function login(identity, password = PASS) {
  const r = await api("POST", "/api/collections/users/auth-with-password", { body: { identity, password } });
  return { status: r.status, token: r.json && r.json.token, id: r.json && r.json.record && r.json.record.id, record: r.json && r.json.record };
}

// ---------- регистрация по номеру с подтверждением звонком ----------
const direct = await create("users", null, { name: "Без звонка", phone: "+79230000099", password: PASS, passwordConfirm: PASS });
check("зарегистрироваться без подтверждения номера нельзя", direct.status === 403 || direct.status === 400, direct.json);
check("неверный номер не принимается", (await phoneStart("12345", "signup")).status === 400);
check("неизвестная цель проверки не принимается", (await phoneStart("+79230000099", "spam")).status === 400);

check("иностранный номер не принимается — нужен российский мобильный", (await phoneStart("+380501234567", "signup")).status === 400);
check("городской номер не принимается", (await phoneStart("+73832000000", "signup")).status === 400);
check("неизвестный способ проверки не принимается", (await phoneStart("+79230000099", "signup", null, "sms")).status === 400);

// основной способ: человек звонит сам
const st = await phoneStart("+7 923 000-00-01", "signup");
check("выдан номер, на который позвонить", is2xx(st) && st.json.method === "callcheck" && st.json.call_phone === "+78005553535" &&
  st.json.call_phone_pretty && st.json.ticket && st.json.ticket.length >= 40, st.json);
const sentAdd = seen.at(-1);
check("запрос к SMS.ru: ключ, номер без «+», без адреса человека", sentAdd.path === "/callcheck/add" && sentAdd.method === "POST" &&
  sentAdd.params.api_id === SMSRU_KEY && sentAdd.params.phone === "79230000001" && sentAdd.params.ip === undefined, sentAdd);
check("до звонка — ждём", (await phoneStatus(st.json.check)).json.status === "waiting");
check("до звонка билет не действует",
  (await api("POST", "/api/ordius/signup", { body: { ticket: st.json.ticket, name: "Иван Петров", password: PASS, terms: TERMS } })).status === 400);
const polls = seen.length;
await phoneStatus(st.json.check);
check("SMS.ru опрашивается не чаще раза в 2 секунды", seen.length === polls);
await callFromPhone(await providerIdOf(st.json.check));
await new Promise((r) => setTimeout(r, 2100));
check("после звонка — подтверждено", (await phoneStatus(st.json.check)).json.status === "verified");
check("по проверке «звонок с кодом» цифры не принимаются", (await phoneVerify(st.json.check, TEST_CODE)).status === 400);
check("регистрация по чужому билету не проходит",
  (await api("POST", "/api/ordius/signup", { body: { ticket: "x".repeat(40), name: "Иван", password: PASS, terms: TERMS } })).status === 400);
check("короткий пароль не принимается",
  (await api("POST", "/api/ordius/signup", { body: { ticket: st.json.ticket, name: "Иван Петров", password: "123", terms: TERMS } })).status === 400);
check("без принятия условий не зарегистрироваться",
  (await api("POST", "/api/ordius/signup", { body: { ticket: st.json.ticket, name: "Иван Петров", password: PASS } })).status === 400);
check("со старой редакцией условий не зарегистрироваться — просим обновить страницу",
  /обновите страницу/.test((await api("POST", "/api/ordius/signup", { body: { ticket: st.json.ticket, name: "Иван Петров", password: PASS, terms: "2026-01-01" } })).text));
const regA = await api("POST", "/api/ordius/signup", { body: { ticket: st.json.ticket, name: "Иван Петров", password: PASS, terms: TERMS } });
check("регистрация по подтверждённому номеру — сразу вход", is2xx(regA) && regA.json.token && regA.json.record.phone === "+79230000001", regA.json);
check("у пользователя записано, какие условия и когда он принял", regA.json.record.terms_version === TERMS && !!regA.json.record.terms_at, regA.json.record);
check("билет одноразовый",
  (await api("POST", "/api/ordius/signup", { body: { ticket: st.json.ticket, name: "Иван Второй", password: PASS, terms: TERMS } })).status === 400);
check("на занятый номер второй раз не зарегистрироваться", (await phoneStart("89230000001", "signup")).status === 400);
const stx = await phoneStart("+79230000096", "signup");
await fetch(`${MOCK}/__expire?check_id=${encodeURIComponent(await providerIdOf(stx.json.check))}`);
check("не позвонил вовремя — проверка сгорела", (await phoneStatus(stx.json.check)).json.status === "expired");
check("по сгоревшей проверке не зарегистрироваться",
  (await api("POST", "/api/ordius/signup", { body: { ticket: stx.json.ticket, name: "Опоздал", password: PASS, terms: TERMS } })).status === 400);

// запасной способ: робот звонит, человек вводит последние 4 цифры
const sc = await phoneStart("+79230000095", "signup", null, "call");
check("робот позвонил, в ответе нет кода и билета", is2xx(sc) && sc.json.method === "call" && sc.json.digits === 4 &&
  !sc.json.ticket && !JSON.stringify(sc.json).includes(TEST_CODE), sc.json);
const sentCall = seen.at(-1);
check("звонок с кодом: ключ, номер, адрес человека", sentCall.path === "/code/call" && sentCall.params.api_id === SMSRU_KEY &&
  sentCall.params.phone === "79230000095" && sentCall.params.ip === "127.0.0.1", sentCall);
check("чужие цифры не подходят", (await phoneVerify(sc.json.check, "0000")).status === 400);
const okv = await phoneVerify(sc.json.check, TEST_CODE);
check("верные цифры дают билет", is2xx(okv) && okv.json.ticket && okv.json.phone === "+79230000095", okv.json);
check("код одноразовый", (await phoneVerify(sc.json.check, TEST_CODE)).status === 400);
check("регистрация по билету после звонка с кодом", is2xx(await api("POST", "/api/ordius/signup",
  { body: { ticket: okv.json.ticket, name: "Олег Запасной", password: PASS, terms: TERMS } })));
check("у проверки «звонок с кодом» статуса звонка нет", (await phoneStatus(sc.json.check)).status === 404);

// попытки: после 5 неверных проверка сгорает
const st5 = await phoneStart("+79230000098", "signup", null, "call");
for (let i = 0; i < 5; i++) await phoneVerify(st5.json.check, "1111");
check("после 5 неверных попыток верный код уже не принимается", (await phoneVerify(st5.json.check, TEST_CODE)).status === 400);
// лимит на один номер: не больше 3 проверок в час
await phoneStart("+79230000098", "signup");
await phoneStart("+79230000098", "signup");
check("не больше 3 проверок на номер в час", (await phoneStart("+79230000098", "signup")).status === 429);

await signup("Пётр Лютиков", "+79230000002");
await signup("Дмитрий Водитель", "8 (923) 000-00-03");
await signup("Денис Второй", "+79230000004");
await signup("Анна Бухгалтер", "+79230000005");
await signup("Михаил Механик", "+79230000006");
await signup("Мария Руководитель", "+79230000007");
// почту человеку может добавить администратор — вход по ней тоже работает
await api("PATCH", `/api/collections/users/records/${regA.json.record.id}`, { token: su, body: { email: "ivan@test.local" } });

const A = await login("+79230000001");
check("вход по телефону", !!A.token, A);
check("вход по почте", !!(await login("ivan@test.local")).token);
const D1 = await login("8 923 000 00 03");
check("вход по телефону в другом написании", !!D1.token, D1);
check("телефон сохранён в виде +7…", D1.record && D1.record.phone === "+79230000003", D1.record);
const B = await login("+79230000002");
const D2u = await login("+79230000004");
const ACC = await login("+79230000005");
const MECH = await login("+79230000006");
const MGR = await login("+79230000007");

// ---------- компании ----------
const cA = await create("companies", A.token, { terms: TERMS, name: "ООО «Ромашка»", inn: "5406000000" });
check("владелец создаёт компанию", is2xx(cA), cA.json);
check("у компании записано, кто и когда принял условия с поручением", cA.json.terms_version === TERMS && !!cA.json.terms_at && cA.json.created_by === A.id, cA.json);
const noTerms = await create("companies", A.token, { name: "Без условий" });
check("без принятия условий компанию не создать", noTerms.status === 400 && /условия/.test(noTerms.text), noTerms.json);
check("принятую редакцию у компании не подделать", (await update("companies", cA.json.id, A.token, { terms_version: "2030-01-01" })).status === 400);
check("принятую редакцию у себя не подделать", (await update("users", A.id, A.token, { terms_version: "2030-01-01" })).status >= 400);
const companyA = cA.json.id;
check("у компании есть код вступления", /^[A-Z2-9]{8}$/.test(cA.json.join_code || ""), cA.json);
check("тариф по умолчанию — пилот", cA.json.plan === "pilot");
const forgedCode = await create("companies", A.token, { terms: TERMS, name: "X", join_code: "AAAAAAAA" });
check("код вступления клиент не задаёт", forgedCode.status === 400, forgedCode.json);
const freePlan = await create("companies", A.token, { terms: TERMS, name: "Y", plan: "business" });
check("тариф клиент себе не выставляет", freePlan.status === 400, freePlan.json);
check("тариф не поменять правкой", (await update("companies", companyA, A.token, { plan: "business" })).status === 400);
check("владелец переименовывает компанию", is2xx(await update("companies", companyA, A.token, { name: "ООО «Ромашка-Сервис»" })));
// коды подключения: на пилоте компанию создаёт только тот, кому администратор выдал код
const meA = (await api("GET", "/api/ordius/me", { token: A.token })).json;
const meB = (await api("GET", "/api/ordius/me", { token: B.token })).json;
check("администратор Ordius — по номеру из настроек сервера, код ему не нужен",
  meA.platform_admin === true && meA.company_code_required === false && meB.platform_admin === false && meB.company_code_required === true, { meA, meB });
const noCode = await create("companies", B.token, { terms: TERMS, name: "ИП Лютиков" });
check("без кода подключения компанию не создать", noCode.status === 400 && /код подключения/.test(noCode.text), noCode.json);
check("с выдуманным кодом — тоже", (await create("companies", B.token, { terms: TERMS, name: "ИП Лютиков", connect_key: "ZZZZZZZZ" })).status === 400);
check("коды видит только администратор", (await api("GET", "/api/ordius/connect-codes", { token: B.token })).status === 403);
check("выдаёт коды только администратор",
  (await api("POST", "/api/ordius/connect-codes", { token: B.token, body: { note: "сам себе" } })).status === 403);
check("без пометки «кому» код не выдаётся", (await api("POST", "/api/ordius/connect-codes", { token: A.token, body: { note: "" } })).status === 400);
const code1 = (await api("POST", "/api/ordius/connect-codes", { token: A.token, body: { note: "ИП Лютиков", max_uses: 5 } })).json;
check("администратор выдал код на 5 компаний", /^[A-Z2-9]{8}$/.test(code1.code || "") && code1.max_uses === 5 && code1.used === 0 && !!code1.expires, code1);
const cB = await create("companies", B.token, { terms: TERMS, name: "ИП Лютиков", connect_key: " " + code1.code.toLowerCase().slice(0, 4) + "-" + code1.code.slice(4) + " " });
check("с кодом (в любом написании) компания создаётся и помнит код", is2xx(cB) && cB.json.connect_code === code1.id, cB.json);
check("код подключения у компании не подменить", (await update("companies", cB.json.id, B.token, { connect_code: "" })).status === 400);
const codesAfter = (await api("GET", "/api/ordius/connect-codes", { token: A.token })).json.items;
check("в списке кодов видно, кто подключился", codesAfter.some((c) => c.id === code1.id && c.used === 1 &&
  c.companies.length === 1 && c.companies[0].name === "ИП Лютиков"), codesAfter);
const companyB = cB.json.id;

const myA = await list("memberships", A.token, `company = "${companyA}"`);
check("создатель стал владельцем", myA.length === 1 && myA[0].roles.includes("owner") && myA[0].status === "active", myA);
const ownerMembership = myA[0].id;

check("чужую компанию не видно в списке", (await list("companies", B.token)).every((c) => c.id !== companyA));
check("чужую компанию не открыть по id", (await view("companies", companyA, B.token)).status === 404);
const anon = await list("companies", null);
check("без входа компаний не видно", anon.length === 0);

// ---------- вступление по коду компании ----------
const joinBad = await api("POST", "/api/ordius/join", { token: D1.token, body: { code: "ZZZZZZZZ" } });
check("неверный код — отказ", joinBad.status === 404, joinBad.json);
const j1 = await api("POST", "/api/ordius/join", { token: D1.token, body: { code: cA.json.join_code.toLowerCase() } });
check("водитель вступает по коду (заявка)", is2xx(j1) && j1.json.status === "pending", j1.json);
const d1Membership = j1.json.membership;

const veh0 = await create("vehicles", A.token, { company: companyA, name: "Шакман А123ВС", plate: "А123ВС154", kind: "dump_truck", active: true });
check("владелец заводит технику", is2xx(veh0), veh0.json);
const vehicle1 = veh0.json.id;
check("заявитель до одобрения технику не видит", (await list("vehicles", D1.token)).length === 0);

const approve = await update("memberships", d1Membership, A.token, { status: "active", personnel_no: "001" });
check("владелец одобряет заявку", is2xx(approve), approve.json);
check("после одобрения водитель видит технику", (await list("vehicles", D1.token)).length === 1);

for (const [who, code] of [[ACC, "acc"], [MECH, "mech"], [MGR, "mgr"]]) {
  const j = await api("POST", "/api/ordius/join", { token: who.token, body: { code: cA.json.join_code } });
  const roles = code === "acc" ? ["accountant"] : code === "mech" ? ["mechanic"] : ["manager"];
  const u = await update("memberships", j.json.membership, A.token, { status: "active", roles });
  who.membership = j.json.membership;
  if (!is2xx(u)) check("одобрение " + code, false, u.json);
}

// ---------- личное приглашение для заведённого человека ----------
const pre = await create("memberships", A.token, { company: companyA, display_name: "Денис Второй", phone: "+7 923 000 00 04", roles: ["driver"], status: "active" });
check("руководитель заводит водителя без аккаунта", is2xx(pre), pre.json);
check("телефон участника приведён к +7", pre.json.phone === "+79230000004", pre.json.phone);
const forgedPending = await create("memberships", A.token, { company: companyA, display_name: "X", roles: ["driver"], status: "pending" });
check("заявку «pending» руками не создать", !is2xx(forgedPending));
const inv = await api("POST", `/api/ordius/memberships/${pre.json.id}/invite`, { token: A.token });
check("личный код приглашения выдаётся", is2xx(inv) && /^[A-Z2-9]{8}$/.test(inv.json.code), inv.json);
const invByDriver = await api("POST", `/api/ordius/memberships/${pre.json.id}/invite`, { token: D1.token });
check("водитель приглашений не выдаёт", invByDriver.status === 403, invByDriver.json);
check("код приглашения не виден в API", (await view("memberships", pre.json.id, A.token)).json.invite_code === undefined);
const invList = await api("GET", "/api/ordius/invitations", { token: D2u.token });
check("человек видит приглашение по своему номеру", is2xx(invList) && invList.json.items.some((i) => i.membership === pre.json.id && i.company_name), invList.json);
check("чужое приглашение по номеру не видно", (await api("GET", "/api/ordius/invitations", { token: MECH.token })).json.items.length === 0);
check("чужое приглашение не принять", (await api("POST", `/api/ordius/invitations/${pre.json.id}/accept`, { token: MECH.token })).status === 404);
const j2 = await api("POST", "/api/ordius/join", { token: D2u.token, body: { code: inv.json.code } });
check("по личному коду — сразу в работу", is2xx(j2) && j2.json.status === "active" && j2.json.membership === pre.json.id, j2.json);
const reuse = await api("POST", "/api/ordius/join", { token: MECH.token, body: { code: inv.json.code } });
check("личный код одноразовый", !is2xx(reuse) || reuse.json.membership !== pre.json.id, reuse.json);
const d2Membership = pre.json.id;

// ---------- справочники и изоляция ----------
const cust = await create("customers", A.token, { company: companyA, name: "МКУ «Первомайское»", active: true });
const site = await create("sites", A.token, { company: companyA, name: "Ул. Первомайская", customer: cust.json.id, active: true });
check("заказчик и объект заводятся", is2xx(cust) && is2xx(site), [cust.json, site.json]);
const vehByDriver = await create("vehicles", D1.token, { company: companyA, name: "Левая техника" });
check("водитель не заводит технику", !is2xx(vehByDriver));
const vehInForeign = await create("vehicles", B.token, { company: companyA, name: "Чужая" });
check("в чужую компанию технику не добавить", !is2xx(vehInForeign));
check("чужую технику не видно", (await list("vehicles", B.token)).length === 0);
const vB = await create("vehicles", B.token, { company: companyB, name: "Камаз Б" });
const vehicle2 = (await create("vehicles", A.token, { company: companyA, name: "Погрузчик", kind: "loader", active: true })).json.id;

// ---------- ставки ----------
const R = async (body) => {
  const r = await create("rates", A.token, { company: companyA, valid_from: "2026-01-01", ...body });
  if (!is2xx(r)) check("ставка " + JSON.stringify(body), false, r.json);
  return r.json;
};
await R({ name: "Смена", unit: "shift", amount_kop: 600000 });
await R({ name: "Час погрузчика", unit: "hour", amount_kop: 60000, vehicle: vehicle2 });
await R({ name: "Т·км", unit: "tkm", amount_kop: 700 });
await R({ name: "Рейс", unit: "trip", amount_kop: 350000 });
await R({ name: "Оклад Дмитрия", unit: "month", amount_kop: 3000000, member: d1Membership, valid_from: "2026-10-01" });
await R({ name: "Смена с ноября", unit: "shift", amount_kop: 700000, valid_from: "2026-11-01" });
await create("rate_factors", A.token, { company: companyA, kind: "night", factor_permille: 1200, valid_from: "2026-01-01" });
await create("rate_factors", A.token, { company: companyA, kind: "holiday", factor_permille: 2000, valid_from: "2026-01-01" });
const rateByDriver = await create("rates", D1.token, { company: companyA, unit: "shift", amount_kop: 1, valid_from: "2026-01-01" });
check("водитель ставки не меняет", !is2xx(rateByDriver));
const foreignVehRate = await create("rates", A.token, { company: companyA, unit: "hour", amount_kop: 1, vehicle: vB.json.id, valid_from: "2026-01-01" });
check("ставку на чужую технику не создать", !is2xx(foreignVehRate));
check("водитель видит только свои ставки", (await list("rates", D1.token)).every((r) => r.member === d1Membership));
check("бухгалтер видит ставки", (await list("rates", ACC.token)).length >= 5);
check("механик ставок не видит", (await list("rates", MECH.token)).length === 0);

// ---------- смены ----------
const s1 = await create("shifts", D1.token, { company: companyA, member: d1Membership, date: "2026-10-15", site: site.json.id, customer: cust.json.id, status: "submitted" });
check("водитель создаёт свою смену", is2xx(s1), s1.json);
const shift1 = s1.json.id;
const fakeAmount = await create("shifts", D1.token, { company: companyA, member: d1Membership, date: "2026-10-15", status: "draft", amount_kop: 99999999 });
check("сумму смены клиент не задаёт", fakeAmount.status === 400, fakeAmount.json);
const forOther = await create("shifts", D1.token, { company: companyA, member: d2Membership, date: "2026-10-15", status: "submitted" });
check("водитель не создаёт смену за другого", !is2xx(forOther));
const confirmedAtOnce = await create("shifts", A.token, { company: companyA, member: d1Membership, date: "2026-10-15", status: "confirmed" });
check("сразу подтверждённую смену не создать", !is2xx(confirmedAtOnce));

const E = async (token, body) => create("shift_entries", token, { company: companyA, ...body });
check("строка «смена»", is2xx(await E(D1.token, { shift: shift1, vehicle: vehicle1, unit: "shift", quantity: 1 })));
check("строка «т·км»", is2xx(await E(D1.token, { shift: shift1, vehicle: vehicle1, unit: "tkm", tons: 15, km: 80 })));
const badTkm = await E(D1.token, { shift: shift1, unit: "tkm", tons: 15 });
check("т·км без километров не принимается", badTkm.status === 400, badTkm.json);

check("второй водитель чужую смену не видит", (await list("shifts", D2u.token)).length === 0 && (await view("shifts", shift1, D2u.token)).status === 404);
check("бухгалтер видит смену", (await view("shifts", shift1, ACC.token)).status === 200);
check("механик смену не видит", (await view("shifts", shift1, MECH.token)).status === 404);
check("бухгалтер смену не подтверждает", !is2xx(await update("shifts", shift1, ACC.token, { status: "confirmed" })));
check("водитель сам не подтверждает", !is2xx(await update("shifts", shift1, D1.token, { status: "confirmed" })));
check("чужой владелец не подтверждает", !is2xx(await update("shifts", shift1, B.token, { status: "confirmed" })));

const conf = await update("shifts", shift1, A.token, { status: "confirmed" });
check("владелец подтверждает смену", is2xx(conf), conf.json);
check("расчёт: 6 000 ₽ смена + 15 т × 80 км × 7 ₽ = 14 400 ₽", conf.json && conf.json.amount_kop === 1440000, conf.json && conf.json.amount_kop);
check("в расчёте две строки и ставки", conf.json && conf.json.calc && conf.json.calc.lines.length === 2, conf.json && conf.json.calc);
check("кто подтвердил — записано", conf.json && conf.json.confirmed_by === A.id);
check("подтверждённую смену водитель не правит", !is2xx(await update("shifts", shift1, D1.token, { note: "правка" })));
check("в подтверждённую смену строку не добавить", !is2xx(await E(D1.token, { shift: shift1, unit: "trip", quantity: 1 })));
check("подтверждённую смену не удалить", !is2xx(await api("DELETE", `/api/collections/shifts/records/${shift1}`, { token: A.token })));

// Ночная смена на погрузчике: 10 ч × 600 ₽ × 1,2 = 7 200 ₽
const s2 = await create("shifts", D1.token, { company: companyA, member: d1Membership, date: "2026-10-16", status: "submitted", night: true });
await E(D1.token, { shift: s2.json.id, vehicle: vehicle2, unit: "hour", quantity: 10 });
const conf2 = await update("shifts", s2.json.id, A.token, { status: "confirmed" });
check("ночная смена ×1,2: 7 200 ₽", conf2.json && conf2.json.amount_kop === 720000, conf2.json);

// Нет ставки — подтвердить нельзя
const s3 = await create("shifts", D1.token, { company: companyA, member: d1Membership, date: "2026-10-17", status: "submitted" });
await E(D1.token, { shift: s3.json.id, vehicle: vehicle1, unit: "hour", quantity: 8 });
const conf3 = await update("shifts", s3.json.id, A.token, { status: "confirmed" });
check("без ставки смена не подтверждается и объясняется почему", conf3.status === 400 && /ставки/.test(conf3.text), conf3.json);
check("возврат без причины не принимается", (await update("shifts", s3.json.id, A.token, { status: "rejected" })).status === 400);
check("возврат с причиной", is2xx(await update("shifts", s3.json.id, A.token, { status: "rejected", reject_reason: "Нет ставки на час Шакмана" })));
check("водитель исправляет возвращённую смену", is2xx(await update("shifts", s3.json.id, D1.token, { status: "submitted", note: "исправил" })));

// Новая ставка с ноября не меняет октябрь
const s4 = await create("shifts", D1.token, { company: companyA, member: d1Membership, date: "2026-11-02", status: "submitted" });
await E(D1.token, { shift: s4.json.id, vehicle: vehicle1, unit: "shift", quantity: 1 });
const conf4 = await update("shifts", s4.json.id, A.token, { status: "confirmed" });
check("ноябрьская смена по новой ставке 7 000 ₽", conf4.json && conf4.json.amount_kop === 700000, conf4.json);
check("октябрьская смена осталась по старой ставке", (await view("shifts", shift1, A.token)).json.amount_kop === 1440000);

// Снятие подтверждения
const unc = await update("shifts", s4.json.id, A.token, { status: "submitted" });
check("снятие подтверждения обнуляет расчёт", is2xx(unc) && !unc.json.amount_kop && !unc.json.confirmed_by, unc.json);
const reconf = await update("shifts", s4.json.id, MGR.token, { status: "confirmed" });
check("руководитель тоже подтверждает", is2xx(reconf) && reconf.json.amount_kop === 700000, reconf.json);

// ---------- удержания и выплаты ----------
const fine = await create("adjustments", A.token, { company: companyA, member: d1Membership, date: "2026-10-20", kind: "fine", amount_kop: -50000, note: "Штраф ГИБДД" });
check("удержание вносится", is2xx(fine), fine.json);
check("водитель видит своё удержание", (await list("adjustments", D1.token)).length === 1);
check("другой водитель его не видит", (await list("adjustments", D2u.token)).length === 0);
const adv = await create("payouts", A.token, { company: companyA, member: d1Membership, kind: "advance", amount_kop: 500000, status: "paid", paid_on: "2026-10-20", period_from: "2026-10-01", period_to: "2026-10-31", method: "card", issued_by: "Иван Петров" });
check("аванс вносится", is2xx(adv), adv.json);
const conf5 = await update("payouts", adv.json.id, D1.token, { member_confirmed: true });
check("водитель подтверждает получение", is2xx(conf5) && conf5.json.member_confirmed && conf5.json.member_confirmed_at, conf5.json);
check("водитель не меняет сумму выплаты", !is2xx(await update("payouts", adv.json.id, D1.token, { amount_kop: 1 })));
check("бухгалтер выплату не меняет", !is2xx(await update("payouts", adv.json.id, ACC.token, { note: "x" })));

// ---------- ведомость ----------
const pr = await api("GET", `/api/ordius/payroll?company=${companyA}&from=2026-10-01&to=2026-10-31`, { token: ACC.token });
check("бухгалтер получает ведомость", is2xx(pr), pr.json);
const d1row = pr.json && pr.json.rows.find((r) => r.member === d1Membership);
check("ведомость: смены 14 400 + 7 200, оклад 30 000, штраф −500, аванс 5 000 → к выплате 46 100 ₽",
  d1row && d1row.earned_kop === 2160000 && d1row.salary_kop === 3000000 && d1row.deductions_kop === 50000 &&
  d1row.paid_kop === 500000 && d1row.due_kop === 4610000 && d1row.shifts_confirmed === 2 && d1row.shifts_pending === 1, d1row);
const prD = await api("GET", `/api/ordius/payroll?company=${companyA}&from=2026-10-01&to=2026-10-31`, { token: D1.token });
check("водитель видит в ведомости только себя", is2xx(prD) && prD.json.rows.length === 1 && prD.json.rows[0].member === d1Membership, prD.json);
const prHalf = await api("GET", `/api/ordius/payroll?company=${companyA}&from=2026-10-01&to=2026-10-15&member=${d1Membership}`, { token: A.token });
check("оклад за полмесяца — пропорционально дням", prHalf.json && prHalf.json.rows[0].salary_kop === Math.round(3000000 * 15 / 31), prHalf.json);
check("чужая компания ведомость не получает", (await api("GET", `/api/ordius/payroll?company=${companyA}&from=2026-10-01&to=2026-10-31`, { token: B.token })).status === 403);
const csv = await api("GET", `/api/ordius/payroll?company=${companyA}&from=2026-10-01&to=2026-10-31&format=csv`, { token: ACC.token });
check("выгрузка для бухгалтерии в CSV", csv.status === 200 && csv.text.includes("К выплате") && csv.text.includes("46100,00"), csv.text.slice(0, 300));

// ---------- контракты заказчиков и выручка ----------
const veh3 = await create("vehicles", A.token, { company: companyA, name: "МК-1000", plate: "Е777КХ154", kind: "road_sweeper", active: true });
const vehicle3 = veh3.json.id;
await R({ name: "Час на подметальной", unit: "hour", amount_kop: 50000, vehicle: vehicle3 });
const ct = await create("contracts", A.token, { company: companyA, customer: cust.json.id, number: "0151300000126000123",
  title: "Уборка улиц Первомайского района", status: "active", limit_kop: 100000000 });
check("владелец заводит контракт заказчика", is2xx(ct), ct.json);
const contract1 = ct.json.id;
const CI = async (body) => {
  const r = await create("contract_items", A.token, { company: companyA, contract: contract1, active: true, ...body });
  if (!is2xx(r)) check("позиция " + body.name, false, r.json);
  return r.json.id;
};
const itSweep = await CI({ name: "Механизированное подметание", unit: "lin_m", vehicle_kind: "road_sweeper" });
const itLoader = await CI({ name: "Работа погрузчика", unit: "hour", vehicle_kind: "loader" });
const itFee = await CI({ name: "Дежурство техники", unit: "month" });
const CP = (item, price_kop, extra = {}) => create("contract_prices", A.token, { company: companyA, item, price_kop, valid_from: "2026-01-01", ...extra });
check("цены позиций вносятся", is2xx(await CP(itSweep, 1500, { vat: "22" })) && is2xx(await CP(itLoader, 250000)) && is2xx(await CP(itFee, 3100000)));
check("цену вносит только руководство", !is2xx(await create("contract_prices", ACC.token, { company: companyA, item: itSweep, price_kop: 1, valid_from: "2026-01-01" })));
check("объект привязан к контракту", is2xx(await update("sites", site.json.id, A.token, { contract: contract1 })));

check("водитель видит позиции контракта", (await list("contract_items", D1.token)).length === 3);
check("водитель не видит цен заказчика", (await list("contract_prices", D1.token)).length === 0);
check("водитель не видит контракты", (await list("contracts", D1.token)).length === 0);
check("механик не видит цен", (await list("contract_prices", MECH.token)).length === 0);
check("бухгалтер видит цены и контракт", (await list("contract_prices", ACC.token)).length === 3 && (await list("contracts", ACC.token)).length === 1);
check("чужая компания не видит ни позиций, ни цен", (await list("contract_items", B.token)).length === 0 && (await list("contract_prices", B.token)).length === 0);
check("в чужой компании контракт на нашего заказчика не завести",
  !is2xx(await create("contracts", B.token, { company: companyB, customer: cust.json.id, title: "Чужой", status: "active" })));

const sb1 = await create("shifts", D1.token, { company: companyA, member: d1Membership, date: "2026-12-01", site: site.json.id, status: "submitted" });
check("контракт и заказчик в смену подставились по объекту", is2xx(sb1) && sb1.json.contract === contract1 && sb1.json.customer === cust.json.id, sb1.json);
check("строка: водителю 8 ч, заказчику 2 000 п.м.", is2xx(await E(D1.token, { shift: sb1.json.id, vehicle: vehicle3, unit: "hour", quantity: 8,
  contract_item: itSweep, bill_qty: 2000, waybill_no: "000123", odometer_start: 15230, odometer_end: 15302, engine_hours_start: 4210, engine_hours_end: 4218 })));
check("строка погрузчика: позиция подберётся сама", is2xx(await E(D1.token, { shift: sb1.json.id, vehicle: vehicle2, unit: "hour", quantity: 10 })));
const cb1 = await update("shifts", sb1.json.id, A.token, { status: "confirmed" });
check("оплата людям: 8 × 500 + 10 × 600 = 10 000 ₽", is2xx(cb1) && cb1.json.amount_kop === 1000000, cb1.json);
const bills1 = await list("shift_bills", ACC.token, `shift = "${sb1.json.id}"`);
check("выручка: 2 000 п.м. × 15 + 10 ч × 2 500 = 55 000 ₽", bills1.length === 1 && bills1[0].amount_kop === 5500000 && bills1[0].status === "ok", bills1);
check("водитель выручку не видит", (await list("shift_bills", D1.token)).length === 0);
check("в смене водителя цен заказчика нет", !JSON.stringify((await view("shifts", sb1.json.id, D1.token)).json).includes("250000"));

const sb2 = await create("shifts", D1.token, { company: companyA, member: d1Membership, date: "2026-12-02", site: site.json.id, status: "submitted" });
await E(D1.token, { shift: sb2.json.id, vehicle: vehicle1, unit: "trip", quantity: 3 });
const cb2 = await update("shifts", sb2.json.id, A.token, { status: "confirmed" });
check("нет позиции в контракте — смена всё равно подтверждается", is2xx(cb2) && cb2.json.amount_kop === 1050000, cb2.json);
const bills2 = await list("shift_bills", ACC.token, `shift = "${sb2.json.id}"`);
check("…а выручка помечена «не выставлено» с причиной", bills2.length === 1 && bills2[0].status === "incomplete" && /нет позиции/.test(JSON.stringify(bills2[0].missing)), bills2);

const reg = await api("GET", `/api/ordius/registry?company=${companyA}&contract=${contract1}&from=2026-12-01&to=2026-12-31`, { token: ACC.token });
check("реестр: 30 000 + 25 000 + дежурство 31 000 = 86 000 ₽, НДС 22% с подметания",
  is2xx(reg) && reg.json && reg.json.total_kop === 8600000 && reg.json.lines.length === 3 && reg.json.vat_kop === Math.round(3000000 * 22 / 122) && reg.json.missing.length === 1, reg.json);
check("реестр показывает водителя, технику и объект", reg.json && reg.json.lines.some((l) => l.driver === "Дмитрий Водитель" && /МК-1000/.test(l.vehicle) && l.site === "Ул. Первомайская"), reg.json && reg.json.lines);
const regCsv = await api("GET", `/api/ordius/registry?company=${companyA}&contract=${contract1}&from=2026-12-01&to=2026-12-31&format=csv`, { token: ACC.token });
check("реестр в CSV для Excel: итог и «не выставлено»", regCsv.status === 200 && regCsv.text.includes("86000,00") && regCsv.text.includes("Не выставлено") && regCsv.text.includes("Механизированное подметание"), regCsv.text.slice(0, 400));
check("водитель реестр не получает", (await api("GET", `/api/ordius/registry?company=${companyA}&contract=${contract1}&from=2026-12-01&to=2026-12-31`, { token: D1.token })).status === 403);

const itTrip = await CI({ name: "Вывоз смёта, рейс", unit: "trip" });
await CP(itTrip, 400000);
const rc = await api("POST", "/api/ordius/bills/recalc", { token: A.token, body: { company: companyA, from: "2026-12-01", to: "2026-12-31" } });
check("после внесения цены пересчёт закрывает пробел", is2xx(rc) && rc.json.shifts === 2 && rc.json.incomplete === 0, rc.json);
check("бухгалтер пересчитывать не может", (await api("POST", "/api/ordius/bills/recalc", { token: ACC.token, body: { company: companyA, from: "2026-12-01", to: "2026-12-31" } })).status === 403);
const reg2 = await api("GET", `/api/ordius/registry?company=${companyA}&contract=${contract1}&from=2026-12-01&to=2026-12-31`, { token: A.token });
check("реестр после пересчёта: 98 000 ₽, пробелов нет", reg2.json && reg2.json.total_kop === 9800000 && reg2.json.missing.length === 0, reg2.json && reg2.json.total_kop);

const rv = await api("GET", `/api/ordius/revenue?company=${companyA}&from=2026-12-01&to=2026-12-31&group=vehicle`, { token: ACC.token });
const rvRow = (id) => rv.json && rv.json.rows.find((r) => r.key === id);
check("по технике: подметальная 30 000 − 4 000, погрузчик 25 000 − 6 000, самосвал 12 000 − 10 500",
  rvRow(vehicle3) && rvRow(vehicle3).bill_kop === 3000000 && rvRow(vehicle3).pay_kop === 400000 && rvRow(vehicle3).margin_kop === 2600000 &&
  rvRow(vehicle2).bill_kop === 2500000 && rvRow(vehicle2).pay_kop === 600000 && rvRow(vehicle1).bill_kop === 1200000 && rvRow(vehicle1).pay_kop === 1050000, rv.json);
const rvc = await api("GET", `/api/ordius/revenue?company=${companyA}&from=2026-12-01&to=2026-12-31&group=customer`, { token: A.token });
check("по заказчику: выручка 67 000, люди 20 500, разница 46 500", rvc.json && rvc.json.total.bill_kop === 6700000 && rvc.json.total.pay_kop === 2050000 && rvc.json.total.margin_kop === 4650000, rvc.json);
check("водитель деньги компании не видит", (await api("GET", `/api/ordius/revenue?company=${companyA}&from=2026-12-01&to=2026-12-31`, { token: D1.token })).status === 403);

check("снятие подтверждения убирает выручку", is2xx(await update("shifts", sb2.json.id, A.token, { status: "submitted" })) &&
  (await list("shift_bills", ACC.token, `shift = "${sb2.json.id}"`)).length === 0);
const ct2 = await create("contracts", A.token, { company: companyA, customer: cust.json.id, title: "Другой контракт", status: "active" });
const itOther = (await create("contract_items", A.token, { company: companyA, contract: ct2.json.id, name: "Чужая позиция", unit: "hour", active: true })).json.id;
check("позицию из другого контракта в смену не поставить", (await E(D1.token, { shift: sb2.json.id, vehicle: vehicle2, unit: "hour", quantity: 1, contract_item: itOther })).status === 400);
const cust2 = await create("customers", A.token, { company: companyA, name: "ДЭУ №3", active: true });
check("контракт одного заказчика в смене другого — нельзя",
  (await create("shifts", D1.token, { company: companyA, member: d1Membership, date: "2026-12-03", customer: cust2.json.id, contract: contract1, status: "draft" })).status === 400);

// ---------- ЭПЛ и ЭТрН: заготовка ----------
const etrn = await create("documents", MGR.token, { company: companyA, kind: "etrn", number: "ЭТрН-15", doc_date: "2026-12-01", external_id: "a1b2c3", external_status: "signed", shift: sb1.json.id });
check("электронная накладная — без фото, с номером и ID из ГИС ЭПД", is2xx(etrn), etrn.json);

// ---------- топливные карты ----------
const fc = await create("fuel_cards", A.token, { company: companyA, number: "7005830012345678", provider: "Газпромнефть", vehicle: vehicle1, holder: d1Membership, active: true });
check("руководство заводит топливную карту", is2xx(fc) && fc.json.pin_set === false, fc.json);
const pinUrl = `/api/ordius/fuel-cards/${fc.json.id}/pin`;
check("водитель ПИН не задаёт", (await api("POST", pinUrl, { token: D1.token, body: { pin: "1111" } })).status === 403);
check("ПИН — только цифры", (await api("POST", pinUrl, { token: A.token, body: { pin: "12a4" } })).status === 400);
check("владелец задаёт ПИН", is2xx(await api("POST", pinUrl, { token: A.token, body: { pin: "4321" } })));
const fcView = await view("fuel_cards", fc.json.id, D1.token);
check("в карточке карты ПИН не отдаётся", fcView.json.pin_set === true && fcView.json.pin_enc === undefined && !JSON.stringify(fcView.json).includes("4321"), fcView.json);
const pinD1 = await api("GET", pinUrl, { token: D1.token });
check("водитель, за которым карта, видит ПИН", is2xx(pinD1) && pinD1.json.pin === "4321", pinD1.json);
check("механик ПИН не видит", (await api("GET", pinUrl, { token: MECH.token })).status === 403);
check("чужая компания ПИН не видит", (await api("GET", pinUrl, { token: B.token })).status !== 200);
const fcSu = await view("fuel_cards", fc.json.id, su);
check("в базе ПИН зашифрован", fcSu.json.pin_enc && fcSu.json.pin_enc !== "4321" && !fcSu.json.pin_enc.includes("4321"), fcSu.json.pin_enc);
check("отметку «ПИН задан» клиент не ставит", (await update("fuel_cards", fc.json.id, A.token, { pin_set: false })).status === 400);
check("каждый просмотр ПИН — в журнале", (await list("audit_log", A.token, `collection_name = "fuel_cards" && action = "view"`)).length === 1);

// ---------- график вахт ----------
const rot = await create("rotations", MGR.token, { company: companyA, member: d1Membership, site: site.json.id, date_from: "2026-12-10", date_to: "2027-01-23", status: "planned" });
check("руководитель ставит вахту 45 дней", is2xx(rot) && rot.json.created_by === MGR.id, rot.json);
check("водитель видит график", (await list("rotations", D1.token)).length === 1);
check("водитель график не правит", !is2xx(await create("rotations", D1.token, { company: companyA, member: d1Membership, date_from: "2027-03-01", date_to: "2027-04-14", status: "planned" })));
check("вахты одного человека не накладываются",
  (await create("rotations", MGR.token, { company: companyA, member: d1Membership, date_from: "2027-01-01", date_to: "2027-02-14", status: "planned" })).status === 400);
check("конец вахты раньше начала — нельзя",
  (await create("rotations", MGR.token, { company: companyA, member: d1Membership, date_from: "2027-05-10", date_to: "2027-05-01", status: "planned" })).status === 400);
check("чужая компания график не видит", (await list("rotations", B.token)).length === 0);

// ---------- сообщения ----------
const m1 = await create("messages", D1.token, { company: companyA, site: site.json.id, text: "На Первомайской сегодня снег, выезжаем в 6:00" });
check("сообщение в чат бригады, автор — сам человек", is2xx(m1) && m1.json.author === D1.id, m1.json);
check("подделать автора нельзя", (await create("messages", D1.token, { company: companyA, text: "x", author: A.id })).status === 400);
check("чат бригады видят в компании", (await list("messages", MECH.token)).some((m) => m.id === m1.json.id));
const m2 = await create("messages", D1.token, { company: companyA, shift: sb1.json.id, text: "Путевой сфотографировал, гляньте" });
check("обсуждение своей смены", is2xx(m2), m2.json);
check("обсуждение смены видит офис", (await list("messages", ACC.token, `shift = "${sb1.json.id}"`)).length === 1);
check("…но не другой водитель", (await list("messages", D2u.token, `shift = "${sb1.json.id}"`)).length === 0);
check("в чужую смену не написать", !is2xx(await create("messages", D2u.token, { company: companyA, shift: sb1.json.id, text: "x" })));
check("чужая компания сообщения не видит", (await list("messages", B.token)).length === 0);

// ---------- вахта: рейсы, суточные, дорога; ведомость «на руки» и с НДФЛ ----------
const D2m = pre.json.id;
await R({ name: "Суточные на вахте", unit: "per_diem", amount_kop: 70000 });
await R({ name: "Рейс Досатуй", unit: "trip", amount_kop: 600000, member: D2m });
const rotDone = await create("rotations", MGR.token, { company: companyA, member: D2m, site: site.json.id, date_from: "2026-11-01", date_to: "2026-11-15", status: "done" });
check("вахта 1–15 ноября закончена", is2xx(rotDone), rotDone.json);
check("изменение графика вахт — в журнале", (await list("audit_log", A.token, `collection_name = "rotations" && record_id = "${rotDone.json.id}"`)).length === 1);
const vs = await create("shifts", D2u.token, { company: companyA, member: D2m, date: "2026-11-05", status: "draft" });
const vsE = await E(D2u.token, { shift: vs.json.id, vehicle: vehicle1, unit: "trip", quantity: 2, waybill_no: "Д-15",
  odometer_start: 120000, odometer_end: 120400, fuel_start: 200, fuel_added: 100, fuel_end: 160 });
check("смена на вахте: 2 рейса с показаниями путевого", is2xx(vs) && is2xx(vsE), [vs.json, vsE.json]);
await update("shifts", vs.json.id, D2u.token, { status: "submitted" });
const vsC = await update("shifts", vs.json.id, A.token, { status: "confirmed" });
check("2 рейса по 6 000 ₽ = 12 000 ₽", is2xx(vsC) && vsC.json.amount_kop === 1200000, vsC.json);
check("дорогу вносит руководство", is2xx(await create("adjustments", A.token, { company: companyA, member: D2m, date: "2026-11-15", kind: "travel", amount_kop: 800000, note: "Билеты Новосибирск — Борзя и обратно" })));
const pv = async () => {
  const r = await api("GET", `/api/ordius/payroll?company=${companyA}&from=2026-11-01&to=2026-11-30&member=${D2m}`, { token: ACC.token });
  return r.json && r.json.rows && r.json.rows[0];
};
let v1 = await pv();
check("ведомость вахтовика: рейсы 12 000 + суточные 15 × 700 + дорога 8 000 = 30 500 ₽ на руки",
  v1 && v1.earned_kop === 1200000 && v1.per_diem_days === 15 && v1.per_diem_kop === 1050000 && v1.travel_kop === 800000 &&
  v1.accrued_kop === 3050000, v1);
check("НДФЛ сверху, когда ставки «на руки»: с 12 000 ₽ — около 1 793 ₽; суточные до 700 ₽ и дорога без НДФЛ",
  v1 && Math.abs(v1.ndfl_kop - 179300) <= 100 && v1.gross_kop === v1.accrued_kop + v1.ndfl_kop, v1);
check("водитель не меняет настройку НДФЛ компании", !is2xx(await update("companies", companyA, D2u.token, { rates_basis: "gross" })));
check("руководство переключает: ставки до НДФЛ", is2xx(await update("companies", companyA, A.token, { rates_basis: "gross" })));
v1 = await pv();
check("ставки до НДФЛ: 13 % удерживается из 12 000 ₽",
  v1 && Math.abs(v1.ndfl_kop - 156000) <= 100 && v1.accrued_kop === 1200000 - v1.ndfl_kop + 1050000 + 800000, v1);
await update("companies", companyA, A.token, { rates_basis: "net" });
check("самозанятому НДФЛ не считается", is2xx(await update("memberships", D2m, A.token, { no_ndfl: true })) && (await pv()).ndfl_kop === 0);
await update("memberships", D2m, A.token, { no_ndfl: false });
const vCsv = await api("GET", `/api/ordius/payroll?company=${companyA}&from=2026-11-01&to=2026-11-30&format=csv`, { token: ACC.token });
check("в CSV ведомости — дни вахты, суточные, дорога, НДФЛ, на руки",
  vCsv.status === 200 && ["Дней вахты", "Суточные", "Дорога", "НДФЛ", "На руки"].every((h) => vCsv.text.includes(h)) && vCsv.text.includes("10500,00"), vCsv.text.slice(0, 400));
const plannedOnly = await api("GET", `/api/ordius/payroll?company=${companyA}&from=2026-12-01&to=2026-12-31&member=${d1Membership}`, { token: A.token });
check("запланированная вахта суточных не даёт", plannedOnly.json && plannedOnly.json.rows[0].per_diem_days === 0, plannedOnly.json);

// ---------- показания, ТО по пробегу, заправки ----------
const vh = async () => (await view("vehicles", vehicle1, A.token)).json;
check("показания из путевого попали в карточку машины", (await vh()).odometer_now === 120400, await vh());
check("норма расхода заводится", is2xx(await update("vehicles", vehicle1, A.token, { fuel_norm_100km: 30 })));
const mp = await create("maintenance_plans", MECH.token, { company: companyA, vehicle: vehicle1, name: "ТО-1: масло и фильтры", interval_km: 10000, last_km: 111000, active: true });
check("механик заводит план ТО каждые 10 000 км", is2xx(mp), mp.json);
check("водитель план ТО не заводит", !is2xx(await create("maintenance_plans", D1.token, { company: companyA, vehicle: vehicle1, name: "x", interval_km: 1, active: true })));
check("водитель видит план ТО", (await list("maintenance_plans", D1.token)).length === 1);
const sync1 = await api("POST", "/api/ordius/maintenance/sync", { token: MECH.token, body: { company: companyA } });
const mTasks = () => list("tasks", MECH.token, `maintenance_plan = "${mp.json.id}"`);
let mt = await mTasks();
check("до ТО 600 км — механику задача «скоро»", is2xx(sync1) && sync1.json.created === 1 && mt.length === 1 &&
  mt[0].assignee_role === "mechanic" && mt[0].priority === "normal" && mt[0].vehicle === vehicle1 && /600 км/.test(mt[0].description), [sync1.json, mt]);
check("повторная проверка задачу не дублирует", (await api("POST", "/api/ordius/maintenance/sync", { token: MECH.token, body: { company: companyA } })).json.created === 0);
check("водитель проверку ТО не запускает", (await api("POST", "/api/ordius/maintenance/sync", { token: D1.token, body: { company: companyA } })).status === 403);
check("задачу по ТО вручную не привязать", (await create("tasks", D1.token, { company: companyA, title: "x", status: "new", maintenance_plan: mp.json.id })).status === 400);

const fl = await create("fuel_logs", D1.token, { company: companyA, vehicle: vehicle1, member: d1Membership, card: fc.json.id,
  at: "2026-11-05 10:00:00.000Z", liters: 100, amount_kop: 700000, fuel: "diesel", source: "card", odometer: 121200 });
check("водитель вносит свою заправку, автор — он сам", is2xx(fl) && fl.json.created_by === D1.id, fl.json);
check("…и может её поправить в течение суток", is2xx(await update("fuel_logs", fl.json.id, D1.token, { station: "АЗС №12" })));
check("водитель не вносит заправку за другого", !is2xx(await create("fuel_logs", D1.token, { company: companyA, vehicle: vehicle1, member: D2m, at: "2026-11-05 10:00:00.000Z", liters: 10 })));
check("водитель не вносит заправку без себя", !is2xx(await create("fuel_logs", D1.token, { company: companyA, vehicle: vehicle1, at: "2026-11-05 10:00:00.000Z", liters: 10 })));
check("водитель не переписывает заправку на другого", !is2xx(await update("fuel_logs", fl.json.id, D1.token, { member: D2m })));
check("подделать автора заправки нельзя", (await create("fuel_logs", D1.token, { company: companyA, vehicle: vehicle1, member: d1Membership, at: "2026-11-05 11:00:00.000Z", liters: 5, created_by: A.id })).status === 400);
check("заправку на чужую машину не внести", !is2xx(await create("fuel_logs", A.token, { company: companyA, vehicle: vB.json.id, at: "2026-11-05 10:00:00.000Z", liters: 10 })));
check("пробег с заправки — в карточку машины", (await vh()).odometer_now === 121200);
mt = await mTasks();
check("перепробег 200 км — задача та же, приоритет высокий", mt.length === 1 && mt[0].priority === "high", mt);
const typo = await create("fuel_logs", A.token, { company: companyA, vehicle: vehicle1, at: "2026-11-07 09:00:00.000Z", liters: 50, amount_kop: 350000, source: "cash", odometer: 999999 });
check("опечатка в одометре не становится текущим пробегом", is2xx(typo) && (await vh()).odometer_now === 121200, await vh());
check("механик видит все заправки", (await list("fuel_logs", MECH.token)).length === 2);
check("другой водитель чужих заправок не видит", (await list("fuel_logs", D2u.token)).length === 0);
check("чужая компания заправок не видит", (await list("fuel_logs", B.token)).length === 0);

const ml = await create("maintenance_logs", MECH.token, { company: companyA, vehicle: vehicle1, plan: mp.json.id, date: "2026-11-06",
  kind: "service", description: "Масло ДВС, фильтры масляный и топливный", odometer: 121250, cost_kop: 1500000 });
check("механик вносит выполненное ТО", is2xx(ml) && ml.json.created_by === MECH.id, ml.json);
check("план ТО сдвинулся: следующее на 131 250 км", (await view("maintenance_plans", mp.json.id, MECH.token)).json.last_km === 121250);
mt = await mTasks();
check("задача по ТО закрылась сама, с записью в истории", mt.length === 1 && mt[0].status === "done" &&
  (await list("task_events", MECH.token, `task = "${mt[0].id}" && to_status = "done"`)).length === 1, mt);
check("ТО по плану другой машины не внести", !is2xx(await create("maintenance_logs", MECH.token, { company: companyA, vehicle: vehicle2, plan: mp.json.id, date: "2026-11-06", kind: "service" })));
check("водитель журнал ТО с затратами не видит", (await list("maintenance_logs", D1.token)).length === 0);
const mst = await api("GET", `/api/ordius/maintenance?company=${companyA}`, { token: MECH.token });
check("состояние ТО: после обслуживания — в порядке", is2xx(mst) && mst.json.rows.length === 1 && mst.json.rows[0].status === "ok" &&
  mst.json.rows[0].parts[0].next === 131250, mst.json);
check("водителю сводка ТО не отдаётся", (await api("GET", `/api/ordius/maintenance?company=${companyA}`, { token: D1.token })).status === 403);
const mpDays = await create("maintenance_plans", A.token, { company: companyA, vehicle: vehicle2, name: "Техосмотр", interval_days: 365, last_date: "2025-01-10", active: true });
await api("POST", "/api/ordius/maintenance/sync", { token: A.token, body: { company: companyA } });
check("ТО по сроку: прошёл год — задача механику", is2xx(mpDays) && (await list("tasks", MECH.token, `maintenance_plan = "${mpDays.json.id}"`)).length === 1);

const gsm = await api("GET", `/api/ordius/fuel?company=${companyA}&from=2026-11-01&to=2026-11-30`, { token: ACC.token });
const g1 = gsm.json && gsm.json.rows.find((r) => r.vehicle === vehicle1);
check("ГСМ: 400 км, по путевому 140 л при норме 120 л — перерасход 20 л", g1 && g1.km === 400 && g1.used_l === 140 && g1.norm_l === 120 && g1.overrun_l === 20, gsm.json);
check("ГСМ: по чекам и карте 150 л, в путевых 100 л — 50 л не отражено", g1 && g1.refueled_l === 150 && g1.not_in_waybills_l === 50 && g1.spent_kop === 1050000, g1);
const gsmCsv = await api("GET", `/api/ordius/fuel?company=${companyA}&from=2026-11-01&to=2026-11-30&format=csv`, { token: MECH.token });
check("ГСМ в CSV", gsmCsv.status === 200 && gsmCsv.text.includes("Перерасход") && gsmCsv.text.includes("Шакман"), gsmCsv.text.slice(0, 300));
check("водителю отчёт по ГСМ не отдаётся", (await api("GET", `/api/ordius/fuel?company=${companyA}&from=2026-11-01&to=2026-11-30`, { token: D1.token })).status === 403);

// ---------- офлайн: приложение задаёт id само, повторная отправка не создаёт дубль ----------
const offId = "off" + Date.now().toString(36).slice(-8).padStart(12, "0");
const off1 = await api("POST", "/api/collections/shifts/records", { token: D2u.token, body: { id: offId, company: companyA, member: D2m, date: "2026-11-06", status: "draft" } });
check("смена, созданная без связи, приходит со своим id", is2xx(off1) && off1.json.id === offId, off1.json);
const off2 = await api("POST", "/api/collections/shifts/records", { token: D2u.token, body: { id: offId, company: companyA, member: D2m, date: "2026-11-06", status: "draft" } });
check("повторная отправка той же смены дубль не создаёт", !is2xx(off2) && (await list("shifts", D2u.token, `id = "${offId}"`)).length === 1, off2.json);

// ---------- объявления со сроком ----------
const post8 = await create("posts", A.token, { company: companyA, text: "8 марта — выходной у всех", pinned: true, until: "2027-03-08" });
check("объявление со сроком показа", is2xx(post8) && post8.json.until.startsWith("2027-03-08"), post8.json);

// ---------- роль владельца ----------
check("руководитель не делает себя владельцем", (await update("memberships", MGR.membership, MGR.token, { roles: ["owner"] })).status === 403);
check("руководитель не увольняет владельца", (await update("memberships", ownerMembership, MGR.token, { status: "dismissed" })).status === 403);
check("единственный владелец не снимает с себя роль", (await update("memberships", ownerMembership, A.token, { roles: ["manager"] })).status === 400);
check("водитель не меняет себе роль", !is2xx(await update("memberships", d1Membership, D1.token, { roles: ["manager"] })));

// ---------- задачи ----------
const t = await create("tasks", D1.token, { company: companyA, title: "Нужна замена колеса", assignee_role: "mechanic", vehicle: vehicle1, status: "new" });
check("водитель ставит задачу", is2xx(t) && t.json.created_by === D1.id, t.json);
check("механик видит задачу", (await view("tasks", t.json.id, MECH.token)).status === 200);
check("другой водитель её не видит", (await view("tasks", t.json.id, D2u.token)).status === 404);
const ip = await update("tasks", t.json.id, MECH.token, { status: "in_progress", assignee: MECH.membership });
check("механик берёт в работу", is2xx(ip), ip.json);
const evs = await list("task_events", D1.token, `task = "${t.json.id}"`);
check("смена статуса и исполнителя записана в историю", evs.some((e) => e.kind === "status" && e.to_status === "in_progress") && evs.some((e) => e.kind === "assign"), evs);
check("автор комментирует задачу", is2xx(await create("task_events", D1.token, { company: companyA, task: t.json.id, kind: "comment", text: "Колесо заднее левое" })));
check("подделать запись о статусе нельзя", !is2xx(await create("task_events", D1.token, { company: companyA, task: t.json.id, kind: "status", to_status: "done" })));
const done = await update("tasks", t.json.id, MECH.token, { status: "done" });
check("закрытие задачи ставит время", is2xx(done) && !!done.json.closed_at, done.json);

// ---------- документы ----------
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const fd = new FormData();
fd.append("company", companyA); fd.append("kind", "waybill"); fd.append("shift", s3.json.id);
fd.append("files", new Blob([jpeg], { type: "image/jpeg" }), "putevoy.jpg");
const doc = await api("POST", "/api/collections/documents/records", { token: D1.token, form: fd });
check("водитель прикладывает фото путевого к смене", is2xx(doc) && doc.json.uploaded_by === D1.id && doc.json.files.length === 1, doc.json);
const fileUrl = `/api/files/documents/${doc.json.id}/${doc.json.files[0]}`;
check("фото без доступа не скачать", (await api("GET", fileUrl)).status !== 200);
const ft = (await api("POST", "/api/files/token", { token: A.token })).json.token;
check("руководитель скачивает фото", (await api("GET", `${fileUrl}?token=${ft}`)).status === 200);
const ftB = (await api("POST", "/api/files/token", { token: B.token })).json.token;
check("чужой владелец фото не скачает", (await api("GET", `${fileUrl}?token=${ftB}`)).status !== 200);
const docForeign = new FormData();
docForeign.append("company", companyB); docForeign.append("kind", "waybill"); docForeign.append("shift", s3.json.id);
docForeign.append("files", new Blob([jpeg], { type: "image/jpeg" }), "x.jpg");
check("документ к чужой смене не прикрепить", !is2xx(await api("POST", "/api/collections/documents/records", { token: B.token, form: docForeign })));

// ---------- люди ----------
const colleague = await view("users", A.id, D1.token);
check("коллегу по компании видно", colleague.status === 200);
check("телефон коллеги в профиле не отдаётся", colleague.json && colleague.json.phone === undefined, colleague.json);
check("свой телефон человек видит", (await view("users", D1.id, D1.token)).json.phone === "+79230000003");
check("номер напрямую не сменить", (await update("users", D1.id, D1.token, { phone: "+79230000033" })).status === 400);
check("имя без смены номера правится", is2xx(await update("users", D1.id, D1.token, { name: "Дмитрий Водитель", phone: "+79230000003" })));
check("смена на занятый номер — без звонка", (await phoneStart("+79230000001", "change", D1.token)).status === 400);
check("смена номера без входа — нельзя", (await phoneStart("+79230000033", "change")).status === 401);
const chTicket = await ticketFor("8-923-000-00-33", "change", D1.token);
check("чужой билет на смену номера не подходит", (await api("POST", "/api/ordius/phone/change", { token: D2u.token, body: { ticket: chTicket } })).status === 400);
const ch = await api("POST", "/api/ordius/phone/change", { token: D1.token, body: { ticket: chTicket } });
check("номер меняется после звонка на новый", is2xx(ch) && ch.json.phone === "+79230000033", ch.json);
check("вход по новому номеру", !!(await login("89230000033")).token);
check("в карточке сотрудника тоже новый номер", (await view("memberships", d1Membership, A.token)).json.phone === "+79230000033");

// вход без пароля и новый пароль — по звонку
check("вход по звонку на незарегистрированный номер — без звонка", (await phoneStart("+79230000097", "login")).status === 400);
const byCall = await api("POST", "/api/ordius/phone/login", { body: { ticket: await ticketFor("+79230000002", "login") } });
check("вход по звонку без пароля", is2xx(byCall) && byCall.json.record.id === B.id && !!byCall.json.token, byCall.json);
const resetTicket = await ticketFor("+79230000002", "reset");
check("билет на вход не годится для смены пароля", (await api("POST", "/api/ordius/phone/login", { body: { ticket: resetTicket } })).status === 400);
check("новый пароль по звонку", is2xx(await api("POST", "/api/ordius/password-reset", { body: { ticket: resetTicket, password: "Drugoi-parol-99" } })));
check("вход с новым паролем после звонка", !!(await login("+79230000002", "Drugoi-parol-99")).token);
B.token = (await login("+79230000002", "Drugoi-parol-99")).token;
check("человека из чужой компании не видно", (await view("users", B.id, D1.token)).status === 404);

// ---------- увольнение ----------
check("владелец увольняет водителя", is2xx(await update("memberships", d2Membership, A.token, { status: "dismissed" })));
check("уволенный больше не видит данные компании", (await list("vehicles", D2u.token)).length === 0 && (await list("companies", D2u.token)).length === 0);
check("дата увольнения проставлена", !!(await view("memberships", d2Membership, A.token)).json.dismissed_on);

// ---------- код компании и журнал ----------
const newCode = await api("POST", `/api/ordius/companies/${companyA}/join-code`, { token: MGR.token });
check("руководитель меняет код вступления", is2xx(newCode) && newCode.json.join_code !== cA.json.join_code, newCode.json);
check("водитель код не меняет", (await api("POST", `/api/ordius/companies/${companyA}/join-code`, { token: D1.token })).status === 403);
check("старый код больше не работает", (await api("POST", "/api/ordius/join", { token: B.token, body: { code: cA.json.join_code } })).status === 404);
const audit = await list("audit_log", A.token);
check("журнал: подтверждения смен и выплаты записаны", audit.some((a) => a.collection_name === "shifts" && a.data && a.data.status && a.data.status.to === "confirmed") && audit.some((a) => a.collection_name === "payouts"), audit.length);
check("водитель журнал не видит", (await list("audit_log", D1.token)).length === 0);
const auditB = await list("audit_log", B.token);
check("чужой владелец журнал не видит", auditB.length > 0 && auditB.every((a) => a.company === companyB), auditB.map((a) => a.company));
check("в журнале нет кодов приглашений", audit.every((a) => !a.data || !a.data.after || a.data.after.invite_code === undefined));

// ---------- целостность ссылок между компаниями ----------
const cB2 = await create("customers", B.token, { company: companyB, name: "Заказчик Б" });
const s5 = await create("shifts", D1.token, { company: companyA, member: d1Membership, date: "2026-10-21", status: "draft" });
check("свою смену водитель создаёт черновиком", is2xx(s5), s5.json);
const crossSite = await update("shifts", s5.json.id, D1.token, { customer: cB2.json.id });
check("в смену не подставить заказчика чужой компании", crossSite.status === 400, crossSite.json);
const moveCompany = await update("memberships", d1Membership, A.token, { company: companyB });
check("участника не перенести в другую компанию", !is2xx(moveCompany), moveCompany.json);
const relink = await update("memberships", d1Membership, A.token, { user: B.id });
check("к участнику не привязать чужой аккаунт", !is2xx(relink), relink.json);
const preLinked = await create("memberships", A.token, { company: companyA, display_name: "Б", user: B.id, roles: ["driver"], status: "active" });
check("руководитель не добавляет чужой аккаунт без кода", !is2xx(preLinked), preLinked.json);
const planned = await create("payouts", A.token, { company: companyA, member: d1Membership, kind: "salary", amount_kop: 100000, status: "planned" });
const confPlanned = await update("payouts", planned.json.id, D1.token, { member_confirmed: true });
check("неполученную выплату не подтвердить", confPlanned.status === 400, confPlanned.json);
const docOther = new FormData();
docOther.append("company", companyA); docOther.append("kind", "waybill"); docOther.append("shift", s5.json.id);
docOther.append("files", new Blob([jpeg], { type: "image/jpeg" }), "y.jpg");
check("к чужой смене своей компании документ не приложить", !is2xx(await api("POST", "/api/collections/documents/records", { token: MECH.token, form: docOther })));

// ---------- приглашение по номеру для нового человека ----------
const egorM = await create("memberships", A.token, { company: companyA, display_name: "Егор Новый", phone: "89230000008", roles: ["driver"], status: "active", personnel_no: "015" });
const egor = await signup("Егор Новый", "+79230000008");
const egorInv = await api("GET", "/api/ordius/invitations", { token: egor.token });
check("после регистрации новичок видит приглашение", egorInv.json.items.length === 1 && egorInv.json.items[0].membership === egorM.json.id, egorInv.json);
check("до принятия данные компании не видны", (await list("vehicles", egor.token)).length === 0);
const acc = await api("POST", `/api/ordius/invitations/${egorM.json.id}/accept`, { token: egor.token });
check("принял приглашение — сразу в работе со своим табельным", is2xx(acc) && acc.json.status === "active", acc.json);
check("после принятия техника компании видна", (await list("vehicles", egor.token)).length > 0);
check("приглашение второй раз не принять", (await api("POST", `/api/ordius/invitations/${egorM.json.id}/accept`, { token: egor.token })).status === 404);

// ---------- смена пароля по коду руководителя ----------
const pc = (id, token) => api("POST", `/api/ordius/memberships/${id}/password-code`, { token });
check("водитель код смены пароля не выдаёт", (await pc(MGR.membership, D1.token)).status === 403);
check("руководитель не выдаёт код владельцу", (await pc(ownerMembership, MGR.token)).status === 403);
check("руководитель не выдаёт код другому руководителю (только владелец)", !is2xx(await pc(MGR.membership, MGR.token)));
const joinB = await api("POST", "/api/ordius/join", { token: ACC.token, body: { code: (await view("companies", companyB, B.token)).json.join_code } });
check("бухгалтер подал заявку и во вторую компанию", is2xx(joinB) && joinB.json.status === "pending", joinB.json);
const accCode = await pc(ACC.membership, MGR.token);
check("человеку из двух компаний код не выдаётся", accCode.status === 400 && /другой компании/.test(accCode.text), accCode.json);
const d1Code = await pc(d1Membership, MGR.token);
check("руководитель выдаёт код водителю", is2xx(d1Code) && /^[A-Z2-9]{8}$/.test(d1Code.json.code), d1Code.json);
check("код смены пароля не виден в API", (await view("memberships", d1Membership, A.token)).json.reset_code === undefined);
const NEWPASS = "Novyi-parol-2026";
const reset = (code, phone = "+79230000033") => api("POST", "/api/ordius/password-reset", { body: { phone, code, password: NEWPASS } });
check("неверный код не подходит", (await reset("ZZZZZZZZ")).status === 400);
check("код к чужому телефону не подходит", (await reset(d1Code.json.code, "+79230000005")).status === 400);
const r1 = await reset(d1Code.json.code.toLowerCase());
check("водитель задаёт новый пароль по коду", is2xx(r1), r1.json);
check("старый вход водителя больше не действует", (await api("POST", "/api/collections/users/auth-refresh", { token: D1.token })).status === 401);
const relog = await api("POST", "/api/collections/users/auth-with-password", { body: { identity: "89230000033", password: NEWPASS } });
check("вход с новым паролем", relog.status === 200 && !!relog.json.token, relog.json);
check("код одноразовый", (await reset(d1Code.json.code)).status === 400);

// ---------- заявки с формы на ordius.ru ----------
const mails = [];
const smtp = net.createServer((sock) => {
  sock.setEncoding("utf8");
  let buf = "", inData = false, data = "";
  const w = (l) => sock.write(l + "\r\n");
  w("220 test ESMTP");
  sock.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\r\n")) !== -1) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (inData) {
        if (line === ".") { inData = false; mails.push(data); data = ""; w("250 OK"); } else data += line + "\n";
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === "EHLO") sock.write("250-test\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n");
      else if (cmd === "AUTH") w("235 OK");
      else if (cmd === "DATA") { inData = true; w("354 go"); }
      else if (cmd === "QUIT") { w("221 bye"); sock.end(); }
      else w("250 OK");
    }
  });
});
const smtpPort = await freePort();
await new Promise((r) => smtp.listen(smtpPort, "127.0.0.1", r));
const leadForm = (fields) => new URLSearchParams({ name: "Иван Петров", phone: "8 (913) 000-11-22", company: "ИП Петров",
  fleet: "b", method: "x", comment: "Есть два самосвала", website: "", consent: "yes", elapsed: "8000", ...fields });
const postLead = async (fields, origin = "https://ordius.ru") => {
  const headers = {};
  if (origin) headers.Origin = origin;
  const r = await fetch(BASE + "/api/ordius/lead", { method: "POST", headers, body: leadForm(fields) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text };
};
const leadsNow = async () => (await api("GET", "/api/collections/leads/records?perPage=200&sort=created", { token: su })).json.items;

check("заявку с чужого сайта не принимаем", (await postLead({}, "https://evil.example")).status === 403);
check("заявку без адреса сайта не принимаем", (await postLead({}, null)).status === 403);
const botTrap = await postLead({ website: "http://spam" });
const botFast = await postLead({ elapsed: "300" });
check("бот (ловушка, слишком быстро) получает «принято», но ничего не сохраняется",
  botTrap.json.ok === true && botFast.json.ok === true && (await leadsNow()).length === 0);
const badLead = await postLead({ name: "", phone: "123", fleet: "z", method: "", consent: "" });
check("неверные поля — список полей", badLead.status === 400 &&
  ["name", "phone", "fleet", "method", "consent"].every((f) => badLead.json.fields.includes(f)), badLead.json);
const okLead = await postLead({});
check("заявка принята, есть номер", okLead.status === 200 && /^[A-Z2-9]{6}$/.test(okLead.json.ref || ""), okLead.json);
const saved = (await leadsNow())[0];
check("заявка записана с отметкой о согласии, телефон в едином виде", saved && saved.ref === okLead.json.ref &&
  saved.phone === "+79130001122" && saved.fleet === "6–15" && saved.method === "Excel" && saved.consent_version &&
  !!saved.consent_at && saved.mailed === false, saved);
check("в заявке нет IP-адреса", saved && !JSON.stringify(saved).includes("127.0.0.1"));
check("заявки не видны пользователям", (await api("GET", "/api/collections/leads/records", { token: A.token })).status === 403);
check("заявки не видны без входа", (await api("GET", "/api/collections/leads/records", {})).status === 403);
check("заявку не создать в обход формы", (await create("leads", A.token, { ref: "AAAAAA", name: "X", phone: "+79130000000",
  consent_version: "x", consent_at: "2026-01-01 00:00:00.000Z" })).status >= 400);
await api("PATCH", "/api/settings", { token: su, body: {
  meta: { senderName: "Ordius", senderAddress: "ordius.info@test.local" },
  smtp: { enabled: true, host: "127.0.0.1", port: smtpPort, username: "u", password: "p", tls: false, authMethod: "PLAIN" } } });
const mailedLead = await postLead({ name: "Анна Почтовая" });
const mailedRec = (await leadsNow()).find((l) => l.ref === mailedLead.json.ref);
check("почта настроена — карточка заявки уходит письмом", mailedLead.status === 200 && mails.length === 1 &&
  mails[0].includes(mailedLead.json.ref) && mailedRec && mailedRec.mailed === true, { mails: mails.length, rec: mailedRec });
smtp.close();
await api("PATCH", "/api/settings", { token: su, body: { smtp: { enabled: false } } });
const deadMail = await postLead({ name: "Без почты" });
check("почта не работает — заявка всё равно сохраняется", deadMail.status === 200 && (await leadsNow()).some((l) => l.ref === deadMail.json.ref));

// ---------- Кабинет Ordius ----------
check("кабинет закрыт для всех, кроме администратора",
  (await api("GET", "/api/ordius/admin/summary", { token: B.token })).status === 403 &&
  (await api("GET", "/api/ordius/admin/companies", { token: B.token })).status === 403 &&
  (await api("GET", "/api/ordius/admin/leads", { token: B.token })).status === 403 &&
  (await api("POST", `/api/ordius/admin/companies/${companyB}/plan`, { token: B.token, body: { plan: "business" } })).status === 403);
const sum = (await api("GET", "/api/ordius/admin/summary", { token: A.token })).json;
check("сводка: компании, люди, смены за неделю, новые заявки", sum.companies >= 2 && sum.users >= 5 && sum.people_active >= 2 &&
  sum.shifts7 >= 1 && sum.leads_new >= 3, sum);
const cab = (await api("GET", "/api/ordius/admin/companies", { token: A.token })).json.items;
const cabA = cab.find((c) => c.id === companyA), cabB = cab.find((c) => c.id === companyB);
check("компании: владелец с телефоном, люди, техника, смены, код подключения", cabA && cabB &&
  cabA.owner_name === "Иван Петров" && cabA.owner_phone === "+79230000001" && cabA.people >= 2 && cabA.vehicles >= 1 &&
  cabA.shifts30 >= 1 && !!cabA.last_shift && !!cabA.terms_at && cabB.code_note === "ИП Лютиков" && cabB.plan === "pilot", { cabA, cabB });
check("в кабинете нет денег и данных работников клиента", !/amount|_kop|phone":"\+7923000000[3-9]/.test(JSON.stringify(cab)));
check("администратор меняет тариф компании",
  is2xx(await api("POST", `/api/ordius/admin/companies/${companyB}/plan`, { token: A.token, body: { plan: "start" } })) &&
  (await view("companies", companyB, B.token)).json.plan === "start");
check("неизвестный тариф не ставится",
  (await api("POST", `/api/ordius/admin/companies/${companyB}/plan`, { token: A.token, body: { plan: "vip" } })).status === 400);
const cabLeads = (await api("GET", "/api/ordius/admin/leads", { token: A.token })).json.items;
check("заявки с сайта видны в кабинете, новые — «new»", cabLeads.length >= 3 && cabLeads.every((l) => l.status === "new"), cabLeads.length);
const upd = await api("POST", `/api/ordius/admin/leads/${cabLeads[0].id}`, { token: A.token, body: { status: "in_work", admin_note: "Позвонить в пятницу" } });
const cabLeads2 = (await api("GET", "/api/ordius/admin/leads", { token: A.token })).json.items;
check("статус и заметка заявки сохраняются", is2xx(upd) && cabLeads2.find((l) => l.id === cabLeads[0].id).status === "in_work" &&
  cabLeads2.find((l) => l.id === cabLeads[0].id).admin_note === "Позвонить в пятницу");
check("неизвестный статус заявки не ставится",
  (await api("POST", `/api/ordius/admin/leads/${cabLeads[0].id}`, { token: A.token, body: { status: "spam" } })).status === 400);

// ---------- защита от засорения ----------
for (let i = 0; i < 4; i++) await create("companies", B.token, { terms: TERMS, name: "Б-" + i, connect_key: code1.code });
const spent = await create("companies", B.token, { terms: TERMS, name: "Б-лишняя", connect_key: code1.code });
check("код на 5 компаний после пятой не действует", spent.status === 400 && /код подключения/.test(spent.text), spent.json);
const code2 = (await api("POST", "/api/ordius/connect-codes", { token: A.token, body: { note: "Лютиков, ещё одна", days: 7 } })).json;
const sixth = await create("companies", B.token, { terms: TERMS, name: "Б-лишняя", connect_key: code2.code });
check("не больше 5 компаний на человека", sixth.status === 400 && /5 компаний/.test(sixth.text), sixth.json);
const code2now = (await api("GET", "/api/ordius/connect-codes", { token: A.token })).json.items.find((c) => c.id === code2.id);
check("неудачная попытка код не тратит", code2now && code2now.used === 0, code2now);
const revoked = await api("POST", `/api/ordius/connect-codes/${code2.id}/revoke`, { token: A.token });
check("администратор отзывает код", is2xx(revoked) && revoked.json.expires, revoked.json);
const egorCo = await create("companies", egor.token, { terms: TERMS, name: "Егор и Ко", connect_key: code2.code });
check("отозванный код не действует", egorCo.status === 400 && /код подключения/.test(egorCo.text), egorCo.json);

// ---------- удаление компании (кабинет администратора) ----------
// Компания A к этому месту набрала данные почти во всех разделах: смены, деньги, контракты, задачи, топливо, чат.
const allCols = (await api("GET", "/api/collections?perPage=200", { token: su })).json.items;
const companyCols = allCols.filter((c) => c.type === "base" &&
  c.fields.some((f) => f.name === "company" && f.type === "relation")).map((c) => c.name);
const countIn = async (col, company) => (await api("GET",
  `/api/collections/${col}/records?perPage=1&filter=${encodeURIComponent(`company = "${company}"`)}`, { token: su })).json.totalItems;
const snapshot = async (company) => { const o = {}; for (const col of companyCols) o[col] = await countIn(col, company); return o; };
const totalOf = async (col) => (await api("GET", `/api/collections/${col}/records?perPage=1`, { token: su })).json.totalItems;
const beforeA = await snapshot(companyA), beforeB = await snapshot(companyB);
const entriesBefore = await totalOf("shift_entries");
check("у компании A есть данные во многих разделах", Object.values(beforeA).filter((n) => n > 0).length >= 12, beforeA);
const nameA = (await view("companies", companyA, su)).json.name;
check("удалить компанию может только администратор Ordius",
  (await api("POST", `/api/ordius/admin/companies/${companyA}/delete`, { token: B.token, body: { confirm: nameA } })).status === 403);
check("без точного названия компания не удаляется",
  (await api("POST", `/api/ordius/admin/companies/${companyA}/delete`, { token: A.token, body: { confirm: nameA.slice(0, -1) } })).status === 400 &&
  (await view("companies", companyA, su)).status === 200);
const delA = await api("POST", `/api/ordius/admin/companies/${companyA}/delete`, { token: A.token, body: { confirm: ` ${nameA} ` } });
check("администратор удаляет компанию", is2xx(delA) && (await view("companies", companyA, su)).status === 404, delA.json);
const afterA = await snapshot(companyA);
check("от компании не осталось записей ни в одном разделе", Object.values(afterA).every((n) => n === 0), afterA);
check("строки смен удалены вместе со сменами", (await totalOf("shift_entries")) < entriesBefore);
check("данные другой компании не тронуты", JSON.stringify(await snapshot(companyB)) === JSON.stringify(beforeB));
check("аккаунты людей остаются", (await view("users", A.id, su)).status === 200);
check("удалённой компании нет в кабинете",
  !(await api("GET", "/api/ordius/admin/companies", { token: A.token })).json.items.some((c) => c.id === companyA));
check("повторное удаление — «не найдена»",
  (await api("POST", `/api/ordius/admin/companies/${companyA}/delete`, { token: A.token, body: { confirm: nameA } })).status === 404);

// ---------- сервер без ключа SMS.ru и с неверным ключом ----------
// Поднимаем ещё два PocketBase: без ключа и с ключом, который «SMS.ru» не принимает.
async function extraServer(extraEnv, extraArgs = []) {
  const d = mkdtempSync(join(tmpdir(), "ordius-pb-"));
  const p = await freePort();
  const a = [`--dir=${d}/pb_data`, `--migrationsDir=${ROOT}/pb_migrations`, `--hooksDir=${ROOT}/pb_hooks`, "--encryptionEnv=PB_ENCRYPTION_KEY", ...extraArgs];
  const en = { ...process.env, PB_ENCRYPTION_KEY: "abcdefghijklmnopqrstuvwxyz012345", ...extraEnv };
  const proc = spawn(PB, ["serve", `--http=127.0.0.1:${p}`, ...a], { env: en, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${p}/api/health`)).ok) break; } catch (_) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const call = async (path, body) => {
    const r = await fetch(`http://127.0.0.1:${p}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (_) {}
    return { status: r.status, json, text };
  };
  const raw = (path, init) => fetch(`http://127.0.0.1:${p}${path}`, init);
  return { call, raw, stop: () => { try { proc.kill(); } catch (_) {} rmSync(d, { recursive: true, force: true }); } };
}

// ---------- форма на ordius.ru и сервер, запущенный как в бою: --origins=https://app.ordius.ru ----------
// Общий CORS PocketBase пускает только приложение; ответ на заявку сайт должен прочитать сам,
// иначе браузер покажет «не получилось», хотя заявка сохранена, и человек отправит её повторно.
const prod = await extraServer({}, ["--origins=https://app.ordius.ru"]);
const sendLead = (origin, fields = {}) => prod.raw("/api/ordius/lead", { method: "POST",
  headers: origin ? { Origin: origin } : {}, body: leadForm({ name: "Сайт Проверка", ...fields }) });
const siteLead = await sendLead("https://ordius.ru");
const siteLeadJson = await siteLead.json().catch(() => ({}));
check("сервер как в бою: ordius.ru читает ответ на заявку", siteLead.status === 200 && siteLeadJson.ok === true &&
  siteLead.headers.get("access-control-allow-origin") === "https://ordius.ru", { status: siteLead.status, acao: siteLead.headers.get("access-control-allow-origin") });
const wwwLead = await sendLead("https://www.ordius.ru", { phone: "8 (913) 000-11-33" });
check("и www.ordius.ru тоже", wwwLead.headers.get("access-control-allow-origin") === "https://www.ordius.ru");
const badFields = await sendLead("https://ordius.ru", { name: "" });
check("ошибку в полях сайт тоже может прочитать", badFields.status === 400 &&
  badFields.headers.get("access-control-allow-origin") === "https://ordius.ru");
const evilLead = await sendLead("https://evil.example");
check("чужому сайту доступ к ответу не открываем", evilLead.status === 403 && !evilLead.headers.get("access-control-allow-origin"));
const otherApi = await prod.raw("/api/health", { headers: { Origin: "https://ordius.ru" } });
check("остальной API для ordius.ru по-прежнему закрыт", !otherApi.headers.get("access-control-allow-origin"));
prod.stop();

const noKey = await extraServer({ ORDIUS_SMSRU_BASE: MOCK });
const nk = await noKey.call("/api/ordius/phone/start", { phone: "+79231112233", purpose: "signup" });
check("без ключа SMS.ru сервер честно отвечает «не настроено»", nk.status === 503, nk.json);
const nkc = await noKey.call("/api/ordius/phone/start", { phone: "+79231112233", purpose: "signup", method: "call" });
check("без ключа и звонок с кодом не притворяется, что звонит", nkc.status === 503, nkc.json);
noKey.stop();
// здесь ограничения частоты включены, как на сервере: ожидание звонка не должно упираться в лимит
const limited = await extraServer({ SMSRU_API_ID: SMSRU_KEY, ORDIUS_SMSRU_BASE: MOCK });
const ls = await limited.call("/api/ordius/phone/start", { phone: "+79231112244", purpose: "signup" });
let pollsOk = is2xx(ls);
for (let i = 0; i < 60 && pollsOk; i++) pollsOk = (await limited.call("/api/ordius/phone/status", { check: ls.json.check })).status === 200;
check("ожидание звонка (60 опросов подряд) не упирается в лимит частоты", pollsOk, ls.json);
let startsLimited = false;
for (let i = 0; i < 25 && !startsLimited; i++) {
  startsLimited = (await limited.call("/api/ordius/phone/start", { phone: `+7923111${String(3000 + i)}`, purpose: "signup" })).status === 429;
}
check("с одного адреса — не больше 20 проверок подряд", startsLimited);
limited.stop();
const badKey = await extraServer({ SMSRU_API_ID: "WRONG", ORDIUS_SMSRU_BASE: MOCK });
const bk = await badKey.call("/api/ordius/phone/start", { phone: "+79231112233", purpose: "signup" });
check("SMS.ru отказал — понятная ошибка, проверка не создана", bk.status === 400 && /Не получилось/.test(bk.text), bk.json);
badKey.stop();

console.log(`\n${passed} проверок прошло, ${failed} не прошло`);
if (failed) console.log("\n--- журнал PocketBase (конец) ---\n" + srvLog.slice(-4000));
stop();
process.exit(failed ? 1 : 0);
