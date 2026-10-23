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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PB = process.env.PB_BIN;
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

const dir = mkdtempSync(join(tmpdir(), "ordius-pb-"));
const port = await freePort();
const BASE = `http://127.0.0.1:${port}`;
const env = { ...process.env, PB_ENCRYPTION_KEY: "abcdefghijklmnopqrstuvwxyz012345" };
const args = [`--dir=${dir}/pb_data`, `--migrationsDir=${ROOT}/pb_migrations`, `--hooksDir=${ROOT}/pb_hooks`, "--encryptionEnv=PB_ENCRYPTION_KEY"];
execFileSync(PB, ["superuser", "upsert", "admin@test.local", "Adm1nPassw0rd!", ...args], { env, stdio: "ignore" });
const srv = spawn(PB, ["serve", `--http=127.0.0.1:${port}`, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
let srvLog = "";
srv.stdout.on("data", (d) => { srvLog += d; });
srv.stderr.on("data", (d) => { srvLog += d; });
const stop = () => { try { srv.kill(); } catch (_) {} rmSync(dir, { recursive: true, force: true }); };
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
check("ограничения частоты: стандартные правила на месте и добавлены коды",
  settings.rateLimits.enabled && labels.includes("*:auth") && labels.includes("POST /api/ordius/join") && labels.includes("POST /api/ordius/password-reset"), labels);
check("в журнале запросов нет IP, хранится 14 дней", settings.logs.logIP === false && settings.logs.maxDays === 14, settings.logs);
await api("PATCH", "/api/settings", { token: su, body: { rateLimits: { enabled: false } } });

const PASS = "Test-passw0rd-123";
async function signup(name, phone, email) {
  const r = await create("users", null, { name, phone, email, password: PASS, passwordConfirm: PASS });
  if (!is2xx(r)) throw new Error("signup " + name + ": " + r.text);
  return r.json.id;
}
async function login(identity) {
  const r = await api("POST", "/api/collections/users/auth-with-password", { body: { identity, password: PASS } });
  return { status: r.status, token: r.json && r.json.token, id: r.json && r.json.record && r.json.record.id, record: r.json && r.json.record };
}

const ownerAId = await signup("Иван Петров", "+7 923 000-00-01", "ivan@test.local");
await signup("Пётр Лютиков", "+79230000002");
await signup("Дмитрий Водитель", "8 (923) 000-00-03");
await signup("Денис Второй", "+79230000004");
await signup("Анна Бухгалтер", "+79230000005");
await signup("Михаил Механик", "+79230000006");
await signup("Мария Руководитель", "+79230000007");

const dupPhone = await create("users", null, { name: "Двойник", phone: "89230000003", password: PASS, passwordConfirm: PASS });
check("телефон уникален в любом написании", !is2xx(dupPhone), dupPhone.json);
const badPhone = await create("users", null, { name: "Ошибка", phone: "12345", password: PASS, passwordConfirm: PASS });
check("неверный телефон не принимается", badPhone.status === 400, badPhone.json);

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
const cA = await create("companies", A.token, { name: "ООО «Ромашка»", inn: "5406000000" });
check("владелец создаёт компанию", is2xx(cA), cA.json);
const companyA = cA.json.id;
check("у компании есть код вступления", /^[A-Z2-9]{8}$/.test(cA.json.join_code || ""), cA.json);
check("тариф по умолчанию — пилот", cA.json.plan === "pilot");
const forgedCode = await create("companies", A.token, { name: "X", join_code: "AAAAAAAA" });
check("код вступления клиент не задаёт", forgedCode.status === 400, forgedCode.json);
const freePlan = await create("companies", A.token, { name: "Y", plan: "business" });
check("тариф клиент себе не выставляет", freePlan.status === 400, freePlan.json);
check("тариф не поменять правкой", (await update("companies", companyA, A.token, { plan: "business" })).status === 400);
check("владелец переименовывает компанию", is2xx(await update("companies", companyA, A.token, { name: "ООО «Ромашка-Сервис»" })));
const cB = await create("companies", B.token, { name: "ИП Лютиков" });
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
check("сменить телефон на чужой нельзя", !is2xx(await update("users", D1.id, D1.token, { phone: "+79230000001" })));
check("телефон меняется и приводится к +7", (await update("users", D1.id, D1.token, { phone: "8-923-000-00-33" })).json.phone === "+79230000033");
check("вход по новому телефону", !!(await login("89230000033")).token);
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

// ---------- защита от засорения ----------
for (let i = 0; i < 4; i++) await create("companies", B.token, { name: "Б-" + i });
const sixth = await create("companies", B.token, { name: "Б-лишняя" });
check("не больше 5 компаний на человека", sixth.status === 400 && /5 компаний/.test(sixth.text), sixth.json);

console.log(`\n${passed} проверок прошло, ${failed} не прошло`);
if (failed) console.log("\n--- журнал PocketBase (конец) ---\n" + srvLog.slice(-4000));
stop();
process.exit(failed ? 1 : 0);
