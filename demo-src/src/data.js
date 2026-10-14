// ============================================================
// ДЕМО-ДАННЫЕ — вымышленная компания «СибСпецТранс».
// Все люди, номера и суммы придуманы. Дата демо — 14 октября 2026.
// ============================================================

export const DEMO_TODAY = '2026-10-14';
export const DAYS = Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
export const OVERTIME_RATE = 750; // ₽ за каждый час сверх 12

export const ROLES = [
  { id: 'owner', label: 'Владелец', person: 'Игорь Петров' },
  { id: 'dispatcher', label: 'Диспетчер', person: 'Татьяна Орлова' },
  { id: 'mechanic', label: 'Механик', person: 'Павел Зуев' },
  { id: 'supply', label: 'Снабжение', person: 'Евгений Котов' },
  { id: 'accountant', label: 'Бухгалтер', person: 'Наталья Савельева' },
  { id: 'driver', label: 'Водитель', person: 'Дмитрий Ковалёв' }
];

export const OBJECTS = [
  { id: 'o1', name: 'Карьер Восточный', client: 'ООО «НедраСиб»', rate: 26000, cell: 'A', repairs: 24000, fuel: 260000 },
  { id: 'o2', name: 'ЖК Северный', client: 'ООО «Северный квартал»', rate: 18000, cell: 'B', repairs: 11000, fuel: 150000 },
  { id: 'o3', name: 'Уборка улиц, Ленинский р-н', client: 'МКУ «Дорожник»', rate: 14000, cell: 'C', repairs: 7000, fuel: 125000 }
];

export const UNITS = [
  { id: 'u1', name: 'Shacman X3000', plate: 'О 512 КХ', kind: 'Самосвал', meter: '182 340 км', status: 'repair' },
  { id: 'u2', name: 'КамАЗ 65115', plate: 'Е 207 НТ', kind: 'Самосвал', meter: '96 420 км', status: 'line' },
  { id: 'u3', name: 'JCB 3CX', plate: '54 НВ 3318', kind: 'Экскаватор-погрузчик', meter: '4 812 м/ч', status: 'repair' },
  { id: 'u4', name: 'Вакуумная КО-505', plate: 'А 640 ОР', kind: 'Вакуумная машина', meter: '7 905 м/ч', status: 'line' },
  { id: 'u5', name: 'Автогрейдер ДЗ-98', plate: '54 НА 1127', kind: 'Автогрейдер', meter: '6 210 м/ч', status: 'line' },
  { id: 'u6', name: 'Shacman X3000', plate: 'О 518 КХ', kind: 'Самосвал', meter: '201 115 км', status: 'line' }
];

// Сроки документов и ТО — для карточки техники
export const TERMS = {
  u1: [['ОСАГО', '3 мес.', 'ok', 75, 'до 12.01.2027'], ['Техосмотр', '7 мес.', 'ok', 40, 'до 20.05.2027'], ['ТО по пробегу', '2 100 км', 'ok', 55, 'следующее на 184 440 км']],
  u2: [['ОСАГО', '8 дней', 'bad', 98, 'до 22.10.2026 — задача поставлена'], ['Техосмотр', '2 мес.', 'ok', 80, 'до 15.12.2026'], ['Тахограф, калибровка', '5 мес.', 'ok', 60, 'до 10.03.2027']],
  u3: [['ТО-3 по моточасам', '188 м/ч', 'soon', 62, 'следующее на 5 000 м/ч'], ['ОСАГО', '6 мес.', 'ok', 50, 'до 18.04.2027'], ['Техосмотр (гостехнадзор)', '4 мес.', 'ok', 66, 'до 18.02.2027']],
  u4: [['ТО по моточасам', '310 м/ч', 'ok', 40, 'следующее на 8 215 м/ч'], ['ОСАГО', '9 мес.', 'ok', 25, 'до 30.07.2027']],
  u5: [['ТО по моточасам', '90 м/ч', 'soon', 82, 'следующее на 6 300 м/ч'], ['Пропуск на объект', '1,5 мес.', 'ok', 50, 'до 30.11.2026']],
  u6: [['ОСАГО', '4 мес.', 'ok', 66, 'до 14.02.2027'], ['ТО по пробегу', '900 км', 'soon', 85, 'следующее на 202 000 км']]
};

export const HISTORY = {
  u3: [['02.10.2026', 'Замена колеса (прокол)', 0, '1 ч'], ['19.09.2026', 'ТО-2 · 4 500 м/ч', 18400, '5 ч'], ['28.08.2026', 'Замена радиатора', 27500, '9 ч']],
  u1: [['21.09.2026', 'Замена тормозных колодок', 14800, '3 ч'], ['02.08.2026', 'ТО по пробегу', 21900, '4 ч']],
  u2: [['30.09.2026', 'Замена стартера', 18600, '4 ч'], ['14.09.2026', 'Ремонт рессоры', 22400, '7 ч']]
};

export const DRIVERS = [
  { id: 'd1', name: 'Ковалёв Дмитрий', unitId: 'u1', pay: 'shift', rate: 6000, pattern: '1 1 1 . . 1 1 1 1 1 . . 1 P1', hours: 12 },
  { id: 'd2', name: 'Сафин Ринат', unitId: 'u2', pay: 'shift', rate: 6300, pattern: '2 2 . . 2 2 2 2 . . 2 2 2 2', hours: 12 },
  { id: 'd3', name: 'Белов Андрей', unitId: 'u3', pay: 'hour', rate: 750, pattern: '2 2 . . 2 2 2 2 2 . . 2 P2 .', hours: 8 },
  { id: 'd4', name: 'Гришин Олег', unitId: 'u4', pay: 'shift', rate: 6500, pattern: '3 3 3 . 3 3 . 3 3 3 . 3 3 3', hours: 12 },
  { id: 'd5', name: 'Мельник Сергей', unitId: 'u5', pay: 'hour', rate: 660, pattern: '3 3 . . 3 3 3 . . . . 1 1 P1', hours: 10 },
  { id: 'd6', name: 'Тарасов Виктор', unitId: 'u6', pay: 'shift', rate: 6000, pattern: '. 1 1 1 1 . . 1 1 1 1 . . 1', hours: 12 }
];

const ADVANCES = { d1: 40000, d2: 50000, d3: 30000, d4: 45000, d5: 35000, d6: 40000 };

function buildShifts() {
  const shifts = [];
  DRIVERS.forEach(d => {
    d.pattern.split(' ').forEach((tok, i) => {
      if (tok === '.') return;
      const pending = tok.startsWith('P');
      const obj = 'o' + tok.replace('P', '');
      const hours = d.id === 'd1' && i === 13 ? 13 : d.hours + (d.id === 'd3' && i === 5 ? 2 : 0);
      shifts.push({ id: `s-${d.id}-${i + 1}`, date: DAYS[i], driverId: d.id, unitId: d.unitId, objectId: obj, hours, status: pending ? 'pending' : 'confirmed', photo: true });
    });
  });
  return shifts;
}

export function seedState() {
  return {
    version: 1,
    units: UNITS.map(u => ({ ...u })),
    shifts: buildShifts(),
    advances: Object.entries(ADVANCES).map(([driverId, amount], i) => ({ id: 'a' + i, driverId, amount, date: '2026-10-05' })),
    paid: {},
    tasks: [
      { id: 't1', chain: 112, parentId: null, kind: 'repair', stops: true, title: 'Пробито заднее колесо, ехать нельзя', unitId: 'u1', from: 'Ковалёв Д., водитель', toRole: 'mechanic', status: 'got', created: '14.10 07:42', note: 'Создано с телефона водителя, 2 фото.', history: ['14.10 07:42 · водитель сообщил о поломке', '14.10 08:10 · механик взял в работу', '14.10 08:30 · запрошена запчасть', '14.10 13:20 · запчасть получена'] },
      { id: 't2', chain: 112, parentId: 't1', kind: 'supply', title: 'Купить шину 315/80 R22.5 — 1 шт.', unitId: 'u1', from: 'Зуев П., механик', toRole: 'supply', status: 'done', price: 28400, created: '14.10 08:30', note: 'Сумма выше лимита 20 000 ₽ — согласовано руководителем.', history: ['14.10 09:15 · согласовано владельцем', '14.10 10:40 · счёт оплачен', '14.10 13:20 · передано механику'] },
      { id: 't3', chain: 113, parentId: null, kind: 'repair', stops: true, title: 'Течь гидравлики на ковше', unitId: 'u3', from: 'Белов А., водитель', toRole: 'mechanic', status: 'done', created: '13.10 16:40', note: 'Механик заменил РВД 1/2", долил масло 4 л. Запчасти 3 650 ₽ по чекам.', history: ['13.10 16:40 · водитель сообщил о поломке', '14.10 08:10 · механик взял в работу', '14.10 13:55 · выполнено, ждёт приёмки'] },
      { id: 't4', chain: 114, parentId: null, kind: 'repair', title: 'Не горит левый стоп-сигнал', unitId: 'u2', from: 'Сафин Р., водитель', toRole: 'mechanic', status: 'todo', created: '14.10 06:55', note: 'Машина на линии, ремонт после смены.', history: ['14.10 06:55 · водитель сообщил о поломке'] },
      { id: 't5', chain: 115, parentId: null, kind: 'doc', title: 'Продлить ОСАГО до 22 октября', unitId: 'u2', from: 'Ordius, напоминание', toRole: 'dispatcher', status: 'todo', created: '08.10 09:00', note: 'Автоматическая задача за 14 дней до окончания полиса.', history: ['08.10 09:00 · создано напоминанием'] }
    ],
    bills: [
      { id: 'b1', who: 'ООО «ШинТорг»', basis: 'Счёт № 418 · шина 315/80 R22.5', kind: 'Запчасти', sum: 28400, status: 'paid', link: 'Цепочка № 112' },
      { id: 'b2', who: 'ООО «ГидроСнаб»', basis: 'Счёт № 77 · РВД, фильтры', kind: 'Запчасти', sum: 12300, status: 'topay', link: 'ТО-3 JCB' },
      { id: 'b3', who: 'Зуев Павел, механик', basis: '2 чека · РВД 1/2", масло', kind: 'Подотчёт', sum: 3650, status: 'refund', link: 'Цепочка № 113' }
    ],
    log: [
      { t: '13:20', who: 'Зуев П.', what: 'Подтвердил получение шины 315/80 R22.5' },
      { t: '10:40', who: 'Савельева Н.', what: 'Отметила оплату счёта № 418' },
      { t: '09:15', who: 'Петров И.', what: 'Согласовал закупку 28 400 ₽' }
    ],
    nextId: 200
  };
}
