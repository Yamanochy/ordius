// ============================================================
// ДАННЫЕ ТАРИФА «БИЗНЕС» — вымышленные, как и всё в демо.
// ============================================================

export const WEEK = ['Чт 15', 'Пт 16', 'Сб 17', 'Вс 18', 'Пн 19', 'Вт 20', 'Ср 21'];

export const BRANCHES_STATIC = [
  { id: 'dos', name: 'Досатуй', kind: 'вахта 45×45', head: 'Ершов А.', units: 8, load: 91, revenue: 1936000, cost: 1452000, idle: 12, late: 0 },
  { id: 'kem', name: 'Кемерово', kind: 'самосвалы', head: 'Носов Д.', units: 6, load: 54, revenue: 780000, cost: 742000, idle: 61, late: 5 }
];

// Экономика техники с начала года (январь–октябрь)
export const ECONOMICS = [
  { unitId: 'u1', revenue: 2430000, salary: 1080000, fuel: 610000, repairs: 96000, idleDays: 6, months: [210, 230, 250, 240, 260, 255, 250, 245, 240, 250] },
  { unitId: 'u3', revenue: 1520000, salary: 690000, fuel: 220000, repairs: 84300, idleDays: 14, months: [140, 150, 160, 150, 155, 160, 150, 145, 150, 160] },
  { unitId: 'u4', revenue: 1340000, salary: 720000, fuel: 260000, repairs: 118000, idleDays: 9, months: [120, 130, 140, 135, 140, 130, 135, 140, 135, 135] },
  { unitId: 'u5', revenue: 960000, salary: 590000, fuel: 180000, repairs: 46000, idleDays: 21, months: [80, 90, 100, 95, 100, 95, 100, 100, 100, 100] },
  { unitId: 'u6', revenue: 2210000, salary: 1010000, fuel: 590000, repairs: 74000, idleDays: 8, months: [200, 210, 220, 225, 230, 225, 220, 225, 230, 225] },
  { unitId: 'u2', revenue: 1180000, salary: 760000, fuel: 290000, repairs: 312000, idleDays: 47, months: [150, 140, 130, 120, 115, 110, 100, 105, 105, 105] }
];

export const TIRES = [
  { id: 'ty1', tire: '315/80 R22.5 · № 4471', unit: 'Shacman О 512 КХ · задняя ось', since: '14.10.2026', run: '0 км', wear: 0 },
  { id: 'ty2', tire: '315/80 R22.5 · № 3902', unit: 'Shacman О 518 КХ · передняя ось', since: '03.03.2025', run: '118 400 км', wear: 93 },
  { id: 'ty3', tire: '12.00 R20 · № 2210', unit: 'КамАЗ Е 207 НТ · задняя ось', since: '20.06.2025', run: '74 300 км', wear: 71 },
  { id: 'ty4', tire: '16.9-28 · № 0915', unit: 'JCB 3CX · задняя ось', since: '11.04.2024', run: '2 840 м/ч', wear: 58 }
];

export const FUEL_NORMS = [
  { unitId: 'u2', norm: 32, fact: 36.4, unit: 'л/100 км', over: 9800 },
  { unitId: 'u4', norm: 6.5, fact: 7.0, unit: 'л/ч', over: 3600 },
  { unitId: 'u1', norm: 38, fact: 38.9, unit: 'л/100 км', over: 1800 },
  { unitId: 'u3', norm: 7, fact: 6.8, unit: 'л/ч', over: 0 },
  { unitId: 'u6', norm: 38, fact: 38.2, unit: 'л/100 км', over: 400 }
];

export const VAHTA_ROWS = [
  { name: 'Ковалёв Дмитрий', unit: 'смена А · Shacman 460', shift: 'A' },
  { name: 'Тарасов Виктор', unit: 'смена А · Shacman 565', shift: 'A' },
  { name: 'Лаптев Иван', unit: 'смена А · Shacman 460', shift: 'A' },
  { name: 'Жуков Роман', unit: 'смена Б · Shacman 460', shift: 'B' },
  { name: 'Осипов Глеб', unit: 'смена Б · Shacman 565', shift: 'B' },
  { name: 'Фомин Артём', unit: 'смена Б · Shacman 460', shift: 'B' }
];

export const ACCESS_MATRIX = [
  ['Смены и табель', 'Всё', 'Правит', '—', '—', 'Видит', 'Своё', 'Свой объект'],
  ['Ставки и зарплата', 'Всё', '—', '—', '—', 'Видит', 'Своё', '—'],
  ['Задачи', 'Всё', 'Правит', 'Своё', 'Своё', 'Своё', 'Своё', '—'],
  ['Техника и ремонты', 'Всё', 'Видит', 'Правит', 'Видит', '—', 'Своё', '—'],
  ['Топливные карты и ПИН', 'Всё', '—', '—', '—', 'Видит', 'Своя', '—'],
  ['Склад и закупки', 'Всё', '—', 'Видит', 'Правит', 'Видит', '—', '—'],
  ['Бухгалтерия', 'Всё', '—', '—', '—', 'Правит', '—', '—'],
  ['Объекты и маржа', 'Всё', '—', '—', '—', 'Видит', '—', '—'],
  ['Настройки и права', 'Всё', '—', '—', '—', '—', '—', '—']
];

export function bizSeed() {
  return {
    plan: [
      { id: 'p1', unitId: 'u1', from: 1, span: 2, objectId: 'o1' }, { id: 'p2', unitId: 'u1', from: 5, span: 3, objectId: 'o1' },
      { id: 'p3', unitId: 'u6', from: 1, span: 4, objectId: 'o1' }, { id: 'p4', unitId: 'u6', from: 6, span: 2, objectId: 'o1' },
      { id: 'p5', unitId: 'u2', from: 1, span: 7, objectId: 'o2' },
      { id: 'p6', unitId: 'u3', from: 2, span: 2, objectId: 'o2' }, { id: 'p7', unitId: 'u3', from: 2, span: 2, objectId: 'o3', conflict: true }, { id: 'p8', unitId: 'u3', from: 5, span: 3, objectId: 'o2' },
      { id: 'p9', unitId: 'u4', from: 1, span: 2, objectId: 'o3' }, { id: 'p10', unitId: 'u4', from: 5, span: 3, objectId: 'o3' },
      { id: 'p11', unitId: 'u5', from: 1, span: 1, objectId: 'o3' }
    ],
    orders: [
      { id: 'or1', client: 'ООО «Северный квартал»', objectId: 'o2', what: 'Автогрейдер, 1 ед.', when: '16–18 октября', from: 2, span: 3, fit: 'u5' },
      { id: 'or2', client: 'МКУ «Дорожник»', objectId: 'o3', what: 'Вакуумная машина, 1 ед.', when: '17–18 октября', from: 3, span: 2, fit: 'u4' }
    ],
    custStatus: {},
    stock: [
      { id: 'st1', name: 'Фильтр масляный Shacman WP12', base: 'Досатуй', qty: 2, min: 6, unit: 'шт', price: 1900 },
      { id: 'st2', name: 'РВД 1/2", 1,2 м', base: 'Новосибирск', qty: 3, min: 3, unit: 'шт', price: 3400 },
      { id: 'st3', name: 'Масло моторное 10W-40, 20 л', base: 'Новосибирск', qty: 7, min: 4, unit: 'кан.', price: 9000 },
      { id: 'st4', name: 'Масло гидравлическое HVLP 46, 20 л', base: 'Кемерово', qty: 1, min: 3, unit: 'кан.', price: 7900 },
      { id: 'st5', name: 'Колодки тормозные КамАЗ', base: 'Новосибирск', qty: 4, min: 2, unit: 'компл.', price: 3700 }
    ],
    gpsEvents: [
      { id: 'g1', t: '07:02', kind: 'info', title: 'Смена открыта автоматически', text: 'Shacman О 518 КХ въехал в зону «Карьер Восточный»' },
      { id: 'g2', t: '06:40', kind: 'info', title: 'Моточасы обновлены', text: 'JCB 3CX: 4 812 м/ч — до ТО-3 осталось 188' },
      { id: 'g3', t: '02:14', kind: 'danger', title: 'Возможный слив топлива: −38 л', text: 'КамАЗ Е 207 НТ, стоянка ЖК Северный', unitId: 'u2', action: 'Создать задачу на проверку' },
      { id: 'g4', t: '23:40', kind: 'warning', title: 'Превышение скорости: 87 км/ч', text: 'Shacman О 518 КХ, ограничение 60 — Тарасов В.' },
      { id: 'g5', t: '20:06', kind: 'info', title: 'Смена закрыта автоматически', text: 'Вакуумная А 640 ОР выехала из зоны объекта · 12 ч 04 мин' }
    ],
    fillings: [
      { id: 'f1', date: '14.10 06:12', unitId: 'u1', driverId: 'd1', liters: 210, sum: 14700, src: 'card' },
      { id: 'f2', date: '13.10 19:40', unitId: 'u2', driverId: 'd2', liters: 160, sum: 11200, src: 'nocheck' },
      { id: 'f3', date: '13.10 07:05', unitId: 'u4', driverId: 'd4', liters: 95, sum: 6650, src: 'check' },
      { id: 'f4', date: '12.10 18:22', unitId: 'u3', driverId: 'd3', liters: 70, sum: 4900, src: 'card' },
      { id: 'f5', date: '12.10 08:10', unitId: 'u1', driverId: 'd1', liters: 120, sum: 8400, src: 'nocheck' }
    ],
    trips: [
      { id: 'tr1', name: 'Жуков Роман', route: 'Новосибирск → Досатуй, 28.10', ticket: 'bought', room: 'booked', med: 'ok' },
      { id: 'tr2', name: 'Осипов Глеб', route: 'Новосибирск → Досатуй, 28.10', ticket: 'none', room: 'booked', med: 'soon' },
      { id: 'tr3', name: 'Фомин Артём', route: 'Омск → Досатуй, 27.10', ticket: 'bought', room: 'none', med: 'ok' }
    ],
    staff: [
      { id: 'sf1', driverId: 'd1', name: 'Ковалёв Дмитрий', role: 'водитель · Новосибирск', dl: ['12.03.2029', 'ok'], tm: null, med: ['26.10.2026', 'soon'], ot: ['02.10.2026', 'ok'] },
      { id: 'sf2', driverId: 'd3', name: 'Белов Андрей', role: 'машинист экскаватора', dl: ['12.03.2029', 'ok'], tm: ['04.11.2026', 'soon'], med: ['10.10.2027', 'ok'], ot: ['02.10.2026', 'ok'] },
      { id: 'sf3', driverId: 'd5', name: 'Мельник Сергей', role: 'машинист автогрейдера', dl: ['30.01.2028', 'ok'], tm: ['24.10.2026', 'soon'], med: ['15.04.2027', 'ok'], ot: ['03.10.2026', 'ok'] },
      { id: 'sf4', driverId: 'd2', name: 'Сафин Ринат', role: 'водитель · Новосибирск', dl: ['05.09.2030', 'ok'], tm: null, med: ['28.10.2026', 'soon'], ot: ['01.10.2026', 'ok'] },
      { id: 'sf5', driverId: null, name: 'Зуев Павел', role: 'механик', dl: ['21.02.2027', 'ok'], tm: ['17.05.2028', 'ok'], med: ['01.06.2027', 'ok'], ot: [null, 'bad'] }
    ],
    fines: [
      { id: 'fi1', when: '13.10 23:40', unitId: 'u6', what: 'Превышение скорости', driverId: 'd6', sum: 750, discount: 'скидка до 20.10', decision: null, status: 'new' },
      { id: 'fi2', when: '11.10 14:05', unitId: 'u2', what: 'Проезд под запрещающий знак', driverId: 'd2', sum: 5000, discount: '', decision: null, status: 'new' },
      { id: 'fi3', when: '08.10 09:12', unitId: 'u4', what: 'Превышение скорости', driverId: 'd4', sum: 750, discount: 'скидка до 18.10', decision: 'company', status: 'paid' }
    ],
    deductions: [],
    releases: {}
  };
}
