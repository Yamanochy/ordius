// Форматирование и справочные подписи. Деньги — целые копейки, даты — «ГГГГ-ММ-ДД».

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfq = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });

export const rub = (kop) => (kop === null || kop === undefined ? '—' : nf0.format(Math.round(kop / 100)) + ' ₽');
export const rub2 = (kop) => (kop === null || kop === undefined ? '—' : nf2.format(kop / 100) + ' ₽');
export const qty = (n) => (n === null || n === undefined || n === '' ? '—' : nfq.format(Number(n)));
// «12 500» или «12 500,50» → копейки
export const toKop = (s) => {
  const v = Number(String(s ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? Math.round(v * 100) : NaN;
};
export const fromKop = (k) => (k === null || k === undefined ? '' : String(k / 100).replace('.', ','));
export const toNum = (s) => {
  if (s === '' || s === null || s === undefined) return null;
  const v = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : NaN;
};

const pad = (n) => String(n).padStart(2, '0');
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const day10 = (v) => String(v || '').slice(0, 10);
export const addDays = (iso, n) => {
  const d = new Date(day10(iso) + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
export const monthRange = (iso = isoDay()) => {
  const [y, m] = day10(iso).split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
};
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export const monthName = (iso) => MONTHS[Number(day10(iso).slice(5, 7)) - 1] || '';
export const monthPrep = (iso) => MONTHS_PREP[Number(day10(iso).slice(5, 7)) - 1] || '';
export const dayLabel = (iso, withYear) => {
  const s = day10(iso);
  if (!s) return '—';
  const [y, m, d] = s.split('-').map(Number);
  const wd = WD[new Date(y, m - 1, d).getDay()];
  const t = isoDay();
  const rel = s === t ? 'сегодня' : s === addDays(t, -1) ? 'вчера' : null;
  return `${d} ${MONTHS_GEN[m - 1]}${withYear || y !== new Date().getFullYear() ? ' ' + y : ''}${rel ? ', ' + rel : ', ' + wd}`;
};
export const shortDay = (iso) => {
  const s = day10(iso);
  if (!s) return '—';
  const [, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1].slice(0, 3)}`;
};
// Дата для PocketBase: «ГГГГ-ММ-ДД 00:00:00.000Z» (поле date хранит момент; день смены — по полуночи UTC)
export const pbDate = (iso) => (day10(iso) ? day10(iso) + ' 00:00:00.000Z' : '');
// Момент: локальное «2026-11-05T10:30» → UTC для PocketBase
export const pbMoment = (local) => (local ? new Date(local).toISOString().replace('T', ' ') : '');
export const localMoment = (pbValue) => {
  if (!pbValue) return '';
  const d = new Date(String(pbValue).replace(' ', 'T'));
  if (isNaN(d)) return '';
  return `${isoDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const timeOf = (pbValue) => {
  const d = new Date(String(pbValue || '').replace(' ', 'T'));
  return isNaN(d) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Телефон: «8 923 102-91-51», «+7 (923)…» → «+79231029151»
export function normalizePhone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '8' || d[0] === '7')) d = '7' + d.slice(1);
  else if (d.length === 10) d = '7' + d;
  return d.length === 11 ? '+' + d : '';
}
export function prettyPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length !== 11) return p || '';
  return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
}

// id новой записи, который приложение задаёт само (для отправки без связи): 15 символов a-z0-9
export function newId() {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const b = new Uint8Array(15);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => a[x % 36]).join('');
}

export const UNITS = {
  hour: { label: 'Часы', short: 'ч', q: 'Часов' },
  shift: { label: 'Смена', short: 'смена', q: 'Смен' },
  trip: { label: 'Рейсы', short: 'рейс', q: 'Рейсов' },
  tkm: { label: 'Тонно-км', short: 'т·км', q: '' },
  km: { label: 'Километры', short: 'км', q: 'Км' },
  lin_m: { label: 'Погонные метры', short: 'п.м.', q: 'Метров' },
  sq_m: { label: 'Квадратные метры', short: 'м²', q: 'м²' },
  cu_m: { label: 'Кубометры', short: 'м³', q: 'м³' },
  ton: { label: 'Тонны', short: 'т', q: 'Тонн' },
  piece: { label: 'Штуки', short: 'шт', q: 'Штук' },
  month: { label: 'Оклад в месяц', short: 'мес.', q: '' },
  per_diem: { label: 'Суточные (день вахты)', short: 'сутки', q: '' },
};
// «3 рейса», «1 смена», «2,5 часа»
const FORMS = { hour: ['час', 'часа', 'часов'], shift: ['смена', 'смены', 'смен'], trip: ['рейс', 'рейса', 'рейсов'] };
export function unitQty(n, unit) {
  const f = FORMS[unit];
  if (!f) return `${qty(n)} ${UNITS[unit] ? UNITS[unit].short : unit}`;
  const v = Number(n);
  return `${qty(v)} ${Number.isInteger(v) ? plural(v, f[0], f[1], f[2]) : f[1]}`;
}
export const WORK_UNITS = ['shift', 'hour', 'trip', 'tkm', 'km', 'lin_m', 'sq_m', 'cu_m', 'ton', 'piece'];

export const ROLES = {
  owner: 'Владелец', manager: 'Руководитель', dispatcher: 'Диспетчер', mechanic: 'Механик', driver: 'Водитель', accountant: 'Бухгалтер',
};
export const OFFICE = ['owner', 'manager', 'dispatcher', 'accountant'];
export const MGMT = ['owner', 'manager'];
export const MONEY = ['owner', 'manager', 'accountant'];

export const SHIFT_STATUS = {
  draft: { label: 'Черновик', tone: '' },
  submitted: { label: 'На проверке', tone: 'info' },
  confirmed: { label: 'Подтверждена', tone: 'success' },
  rejected: { label: 'Возвращена', tone: 'danger' },
};
export const VEHICLE_KINDS = {
  dump_truck: 'Самосвал', truck: 'Грузовик', loader: 'Погрузчик', excavator: 'Экскаватор', grader: 'Грейдер',
  tractor: 'Трактор', road_sweeper: 'Подметальная', vacuum_truck: 'Вакуумная', crane: 'Кран', other: 'Прочее',
};
export const ADJ_KINDS = { bonus: 'Премия', travel: 'Дорога', damage: 'Ущерб', fuel: 'Топливо', fine: 'Штраф', other: 'Прочее' };
export const PAYOUT_KINDS = { advance: 'Аванс', salary: 'Зарплата', bonus: 'Премия', other: 'Прочее' };
export const PAY_METHODS = { cash: 'Наличные', card: 'На карту', bank: 'Банк', other: 'Другое' };
export const DOC_KINDS = { waybill: 'Путевой', ttn: 'ТТН', act: 'Акт', receipt: 'Чек', photo: 'Фото', epl: 'ЭПЛ', etrn: 'ЭТрН', other: 'Другое' };
export const TASK_STATUS = {
  new: { label: 'Новая', tone: 'info' }, in_progress: { label: 'В работе', tone: 'warning' },
  waiting: { label: 'Ждёт', tone: '' }, done: { label: 'Готово', tone: 'success' }, cancelled: { label: 'Отменена', tone: '' },
};
export const ROTATION_STATUS = { planned: 'Запланирована', active: 'Идёт', done: 'Закончена', cancelled: 'Отменена' };

export const hasRole = (m, roles) => !!m && (m.roles || []).some((r) => roles.includes(r));
export const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};
