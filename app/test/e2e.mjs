// Сквозная проверка приложения на настоящем PocketBase: регистрация водителя звонком, смена с фото,
// смена без связи (очередь), подтверждение руководителем, деньги водителя.
//   PB_BIN=/путь/к/pocketbase node app/test/e2e.mjs   (перед этим: cd app && npm run build)
// Скриншоты — в SHOTS (по умолчанию app/test/shots).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';
import { TERMS_VERSION } from '../src/lib/legal.js';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PB = process.env.PB_BIN;
const SHOTS = process.env.SHOTS || join(HERE, 'shots');
mkdirSync(SHOTS, { recursive: true });
if (!PB) { console.error('Укажите PB_BIN'); process.exit(2); }

let failed = 0;
const check = (name, ok, detail) => {
  console.log(ok ? 'ok  -' : 'FAIL:', name, ok || detail === undefined ? '' : JSON.stringify(detail).slice(0, 300));
  if (!ok) failed++;
};
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

// заглушка SMS.ru
const called = new Set();
let seq = 0;
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = Object.fromEntries(new URLSearchParams(b));
    res.setHeader('Content-Type', 'application/json');
    if (u.pathname === '/__call') { called.add(u.searchParams.get('check_id')); return res.end('{}'); }
    if (u.pathname === '/callcheck/add') return res.end(JSON.stringify({ status: 'OK', check_id: 'c' + (++seq), call_phone: '78005553535', call_phone_pretty: '+7 (800) 555-35-35' }));
    if (u.pathname === '/callcheck/status') return res.end(JSON.stringify({ status: 'OK', check_status: called.has(p.check_id) ? 401 : 400 }));
    res.end(JSON.stringify({ status: 'ERROR' }));
  });
});
const mockPort = await freePort();
await new Promise((r) => mock.listen(mockPort, '127.0.0.1', r));

const dir = mkdtempSync(join(tmpdir(), 'ordius-e2e-'));
const port = await freePort();
const BASE = `http://127.0.0.1:${port}`;
const env = { ...process.env, PB_ENCRYPTION_KEY: 'abcdefghijklmnopqrstuvwxyz012345', SMSRU_API_ID: 'K', ORDIUS_SMSRU_BASE: `http://127.0.0.1:${mockPort}`, ORDIUS_PHONE_IP_HOURLY: '1000' };
const args = [`--dir=${dir}/pb_data`, `--migrationsDir=${ROOT}/backend/pb_migrations`, `--hooksDir=${ROOT}/backend/pb_hooks`, `--publicDir=${ROOT}/app/dist`, '--encryptionEnv=PB_ENCRYPTION_KEY'];
execFileSync(PB, ['superuser', 'upsert', 'admin@test.local', 'Adm1nPassw0rd!', ...args], { env, stdio: 'ignore' });
const srv = spawn(PB, ['serve', `--http=127.0.0.1:${port}`, ...args], { env, stdio: 'ignore' });
let browser;
const stop = () => { try { srv.kill(); } catch (_) {} try { mock.close(); } catch (_) {} rmSync(dir, { recursive: true, force: true }); };
process.on('exit', stop);
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (_) {} await new Promise((r) => setTimeout(r, 100)); }

async function api(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch (_) {}
  if (!r.ok) throw new Error(`${method} ${path}: ${t}`);
  return j;
}
const su = (await api('POST', '/api/collections/_superusers/auth-with-password', null, { identity: 'admin@test.local', password: 'Adm1nPassw0rd!' })).token;
await api('PATCH', '/api/settings', su, { rateLimits: { enabled: false } });
const PASS = 'Test-passw0rd-1';
await api('POST', '/api/collections/users/records', su, { name: 'Сергей Мандров', phone: '+79230000001', password: PASS, passwordConfirm: PASS });
const A = (await api('POST', '/api/collections/users/auth-with-password', null, { identity: '+79230000001', password: PASS })).token;
const co = await api('POST', '/api/collections/companies/records', A, { name: 'ИП Мандров С.Н.', inn: '540600000000', terms: TERMS_VERSION });
const C = co.id;
const v1 = await api('POST', '/api/collections/vehicles/records', A, { company: C, name: 'Шакман X3000', plate: 'А123ВС154', kind: 'dump_truck', active: true, fuel_norm_100km: 38 });
await api('POST', '/api/collections/vehicles/records', A, { company: C, name: 'МК-1000', plate: 'Е777КХ154', kind: 'road_sweeper', active: true });
const cust = await api('POST', '/api/collections/customers/records', A, { company: C, name: 'МКУ «Первомайское»', active: true });
await api('POST', '/api/collections/sites/records', A, { company: C, name: 'Ул. Первомайская', customer: cust.id, active: true });
await api('POST', '/api/collections/rates/records', A, { company: C, unit: 'shift', amount_kop: 600000, name: 'Смена', valid_from: '2026-01-01 00:00:00.000Z' });
await api('POST', '/api/collections/rates/records', A, { company: C, unit: 'trip', amount_kop: 600000, name: 'Рейс', valid_from: '2026-01-01 00:00:00.000Z' });
await api('POST', '/api/collections/memberships/records', A, { company: C, display_name: 'Дмитрий Ковалёв', phone: '+79230000003', roles: ['driver'], status: 'active', personnel_no: '7' });
await api('POST', '/api/collections/posts/records', A, { company: C, text: 'В пятницу — инструктаж по технике безопасности в 8:00 на базе.', pinned: true });

browser = await chromium.launch();
const iphone = devices['iPhone 13'];
const shot = (page, name) => page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: true });

// ---------- водитель: регистрация звонком и приглашение ----------
const dctx = await browser.newContext({ ...iphone, locale: 'ru-RU', timezoneId: 'Asia/Novosibirsk' });
const d = await dctx.newPage();
d.on('pageerror', (e) => console.log('PAGE ERROR (driver):', e.message));
await d.goto(BASE + '/');
await d.getByRole('heading', { name: 'Вход' }).waitFor();
await shot(d, '01-login');
await d.getByRole('button', { name: 'Регистрация' }).click();
await d.getByLabel('Номер мобильного').fill('8 923 000-00-03');
await d.getByRole('button', { name: 'Подтвердить номер' }).click();
await d.getByText('Ждём ваш звонок').waitFor();
await shot(d, '02-call');
// пока человек звонит, iOS может выгрузить страницу: после перезапуска проверка продолжается с того же места
await d.reload();
await d.getByText('Ждём ваш звонок').waitFor();
check('после перезапуска экран звонка вернулся сам', true);
await fetch(`http://127.0.0.1:${mockPort}/__call?check_id=c${seq}`);
await d.getByLabel('Имя и фамилия').waitFor({ timeout: 10000 });
await d.getByLabel('Имя и фамилия').fill('Дмитрий Ковалёв');
await d.getByLabel('Пароль').fill(PASS);
await d.getByRole('checkbox').check();
await d.getByRole('button', { name: 'Зарегистрироваться' }).click();
await d.getByText('Вас пригласили').waitFor();
await shot(d, '03-invite');
await d.getByRole('button', { name: 'Принять' }).click();
await d.getByText('Заработано в').waitFor();
await shot(d, '04-driver-home');
check('водитель зарегистрировался звонком и принял приглашение', true);

// ---------- новая смена с фото ----------
await d.getByRole('link', { name: 'Смена' }).first().click();
await d.getByRole('heading', { name: 'Новая смена' }).waitFor();
await d.getByLabel('Техника').selectOption({ label: 'Шакман X3000 · А123ВС154' });
await d.getByRole('radio', { name: 'Рейсы' }).click();
await d.getByLabel('Рейсов').fill('3');
await d.getByRole('button', { name: /Путевой: одометр/ }).click();
await d.getByLabel('№ путевого листа').fill('Д-101');
await d.getByLabel('Одометр, выезд').fill('120000');
await d.getByLabel('Одометр, возврат').fill('120350');
await d.locator('.photo-add input').setInputFiles(join(HERE, 'fixtures', 'waybill.jpg'));
await d.locator('.photo img').first().waitFor();
await shot(d, '05-shift-form');
await d.getByRole('button', { name: 'Отправить на проверку' }).click();
await d.getByRole('heading', { name: 'Смены' }).waitFor();
await d.getByText('На проверке').first().waitFor({ timeout: 10000 });
await shot(d, '06-shifts');
check('смена с фото отправлена на проверку', true);

// ---------- смена без связи ----------
await dctx.setOffline(true);
await d.evaluate(() => window.dispatchEvent(new Event('offline')));
await d.goto(BASE + '/#/shift/new').catch(() => {});
await d.getByRole('heading', { name: 'Новая смена' }).waitFor();
await d.getByLabel('Техника').selectOption({ label: 'Шакман X3000 · А123ВС154' });
await d.getByRole('radio', { name: 'Смена' }).click();
await d.getByRole('button', { name: 'Отправить на проверку' }).click();
await d.getByText('Не отправлена').first().waitFor();
await shot(d, '07-offline-pending');
const badge = await d.locator('.icon-btn .dot').textContent().catch(() => '');
check('без связи смена ждёт в очереди', Number(badge) >= 2, badge);
await dctx.setOffline(false);
await d.evaluate(() => window.dispatchEvent(new Event('online')));
await d.waitForFunction(() => !document.querySelector('.icon-btn .dot'), null, { timeout: 15000 }).catch(() => {});
const left = await d.locator('.icon-btn .dot').count();
check('связь появилась — очередь ушла на сервер', left === 0);
await d.waitForTimeout(4000);
const toasts = await d.locator('.toast').allTextContents();
check('всплывающее сообщение исчезает само', toasts.length === 0, toasts);
const driverShifts = await api('GET', `/api/collections/shifts/records?filter=${encodeURIComponent(`company="${C}"`)}`, su);
check('на сервере две смены водителя, обе на проверке, без дублей', driverShifts.items.length === 2 && driverShifts.items.every((x) => x.status === 'submitted'), driverShifts.items.map((x) => x.status));
const docs = await api('GET', '/api/collections/documents/records', su);
check('фото путевого дошло', docs.items.length === 1 && docs.items[0].kind === 'waybill' && docs.items[0].files.length === 1, docs.items);
const veh = await api('GET', `/api/collections/vehicles/records/${v1.id}`, su);
check('пробег из путевого — в карточке машины', veh.odometer_now === 120350, veh.odometer_now);

// ---------- руководитель подтверждает ----------
const actx = await browser.newContext({ ...iphone, locale: 'ru-RU', timezoneId: 'Asia/Novosibirsk' });
const a = await actx.newPage();
a.on('pageerror', (e) => console.log('PAGE ERROR (owner):', e.message));
await a.goto(BASE + '/');
await a.getByLabel('Номер мобильного').fill('+7 923 000 00 01');
await a.getByLabel('Пароль').fill(PASS);
await a.getByRole('button', { name: 'Войти', exact: true }).click();
await a.getByRole('heading', { name: 'Сводка' }).waitFor();
await a.getByText('Дмитрий Ковалёв').first().waitFor();
await shot(a, '08-office-home');
await a.locator('.list-item', { hasText: 'Дмитрий Ковалёв' }).first().click();
await a.getByRole('button', { name: 'Подтвердить' }).waitFor();
await shot(a, '09-review');
await a.getByRole('button', { name: 'Подтвердить' }).click();
await a.getByText('Подтверждена').first().waitFor();
await a.getByText('Итого за смену').waitFor();
await shot(a, '10-confirmed');
check('руководитель подтвердил смену, сумма посчиталась', true);
// вернуть вторую
await a.goto(BASE + '/#/');
await a.getByText('Ждут подтверждения · 1').waitFor();
await a.locator('.list-item', { hasText: 'Дмитрий Ковалёв' }).first().click();
await a.getByRole('button', { name: 'Вернуть на доработку' }).click();
await a.getByLabel('Что исправить').fill('Нет фото путевого');
await a.getByRole('button', { name: 'Вернуть', exact: true }).click();
await a.getByText('Вернули: Нет фото путевого').waitFor();
check('руководитель вернул смену с причиной', true);
await a.goto(BASE + '/#/payroll');
await a.getByRole('heading', { name: 'Ведомость' }).waitFor();
await a.getByText('Дмитрий Ковалёв').first().waitFor();
await shot(a, '11-payroll');
await a.goto(BASE + '/#/people');
await a.getByRole('heading', { name: 'Люди' }).waitFor();
await shot(a, '12-people');

// ---------- водитель видит деньги и возврат ----------
await d.goto(BASE + '/#/');
await d.getByText('Вернули на доработку').waitFor({ timeout: 10000 });
await shot(d, '13-driver-home-after');
const money = (await d.locator('.money-card .big').first().textContent()).replace(/\D/g, '');
const conf = (await api('GET', `/api/collections/shifts/records?filter=${encodeURIComponent('status="confirmed"')}`, su)).items;
check('у водителя на главной — сумма подтверждённой смены', conf.length === 1 && Number(money) * 100 === conf[0].amount_kop, [money, conf.map((x) => x.amount_kop)]);
await d.goto(BASE + '/#/money');
await d.getByRole('heading', { name: 'Деньги' }).waitFor();
await shot(d, '14-money');
await d.goto(BASE + '/#/fuel/new');
await d.getByRole('heading', { name: 'Заправка' }).waitFor();
await d.getByLabel('Машина').selectOption({ label: 'Шакман X3000 · А123ВС154' });
await d.getByLabel('Литров').fill('120');
await d.getByLabel('Сумма, ₽').fill('8 400');
await shot(d, '15-fuel');
await d.getByRole('button', { name: 'Записать' }).click();
await d.getByText('Заработано в').waitFor();
const fuel = await api('GET', '/api/collections/fuel_logs/records', su);
check('заправка водителя записана', fuel.items.length === 1 && fuel.items[0].liters === 120 && fuel.items[0].amount_kop === 840000, fuel.items);

// тёмная тема, широкий экран офиса
const wctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark', locale: 'ru-RU' });
const w = await wctx.newPage();
await w.goto(BASE + '/');
await w.getByLabel('Номер мобильного').fill('89230000001');
await w.getByLabel('Пароль').fill(PASS);
await w.getByRole('button', { name: 'Войти', exact: true }).click();
await w.getByRole('heading', { name: 'Сводка' }).waitFor();
await w.goto(BASE + '/#/payroll');
await w.locator('table.t td', { hasText: 'Дмитрий Ковалёв' }).waitFor();
await shot(w, '16-desktop-dark-payroll');

await browser.close();
console.log(failed ? `\n${failed} проверок не прошло` : '\nВсе проверки прошли');
process.exit(failed ? 1 : 0);
