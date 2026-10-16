import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { seedState, DRIVERS, OBJECTS, OVERTIME_RATE, ROLES } from './data.js';

// ============================================================
// ХРАНИЛИЩЕ ДЕМО — всё живёт в браузере (localStorage).
// Ничего не уходит на сервер. Кнопка «Сбросить демо» возвращает исходные данные.
// ============================================================

const KEY = 'ordius-demo-v3';
const Ctx = createContext(null);

function load() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.version === 3) return s;
    }
  } catch (e) { /* приватный режим и т.п. — работаем без сохранения */ }
  return seedState();
}

export function nowLabel() {
  const d = new Date();
  return '14.10 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function StoreProvider({ children }) {
  const [state, setState] = useState(load);
  const [toast, setToast] = useState('');

  useEffect(() => {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* без сохранения */ }
  }, [state]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // update(fn) — fn получает копию состояния и меняет её
  const update = useCallback((fn, message) => {
    setState(prev => {
      const draft = structuredClone(prev);
      fn(draft);
      return draft;
    });
    if (message) setToast(message);
  }, []);

  const reset = useCallback(() => { setState(seedState()); setToast('Демо сброшено к исходным данным'); }, []);

  const value = useMemo(() => ({ state, update, reset, toast, setToast }), [state, update, reset, toast]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() { return useContext(Ctx); }

// ---------- расчёты ----------

export function shiftPay(shift) {
  const d = DRIVERS.find(x => x.id === shift.driverId);
  if (!d) return 0;
  const base = d.pay === 'shift' ? d.rate : d.rate * shift.hours;
  const over = d.pay === 'shift' && shift.hours > 12 ? (shift.hours - 12) * OVERTIME_RATE : 0;
  return base + over;
}

export function payroll(state) {
  return DRIVERS.map(d => {
    const own = state.shifts.filter(s => s.driverId === d.id);
    const confirmed = own.filter(s => s.status === 'confirmed');
    const pending = own.filter(s => s.status === 'pending');
    const earned = confirmed.reduce((a, s) => a + shiftPay(s), 0);
    const advance = state.advances.filter(a => a.driverId === d.id).reduce((a, x) => a + x.amount, 0);
    const held = (state.deductions || []).filter(x => x.driverId === d.id).reduce((a, x) => a + x.amount, 0);
    return {
      driver: d, shifts: confirmed.length, pendingCount: pending.length,
      hours: confirmed.reduce((a, s) => a + s.hours, 0),
      earned, advance, held, left: earned - advance - held, paid: !!state.paid[d.id]
    };
  });
}

export function objectsEconomy(state) {
  return OBJECTS.map(o => {
    const sh = state.shifts.filter(s => s.objectId === o.id && s.status === 'confirmed');
    const revenue = sh.length * o.rate;
    const salary = sh.reduce((a, s) => a + shiftPay(s), 0);
    const margin = revenue - salary - o.repairs - o.fuel;
    return { ...o, shifts: sh.length, revenue, salary, margin, pct: revenue ? margin / revenue * 100 : 0 };
  });
}

// ---------- задачи: статусы и действия ----------

export const STATUS = {
  todo: { label: 'К исполнению', tone: '' },
  work: { label: 'В работе', tone: 'info' },
  wait: { label: 'Ждёт запчасть', tone: 'warning' },
  got: { label: 'Запчасть получена', tone: 'info' },
  done: { label: 'На приёмке', tone: 'warning' },
  accepted: { label: 'Принято', tone: 'success' },
  approve: { label: 'Ждёт согласования', tone: 'warning' },
  buy: { label: 'Закупить', tone: '' },
  handed: { label: 'Передано механику', tone: 'info' }
};
export const REPAIR_FLOW = ['todo', 'work', 'wait', 'got', 'done', 'accepted'];
export const SUPPLY_LIMIT = 20000;

export function roleLabel(id) { return (ROLES.find(r => r.id === id) || {}).label || id; }

function logIt(s, who, what) { s.log.unshift({ t: nowLabel().slice(6), who, what }); }

// Какие кнопки видит роль у этой задачи
export function taskActions(task, role, state) {
  const A = [];
  const self = s => s.tasks.find(t => t.id === task.id);
  const parentOf = s => s.tasks.find(t => t.id === task.parentId);

  if (task.kind === 'repair') {
    if (role === 'mechanic' && task.status === 'todo') {
      A.push({ label: 'Взять в работу', primary: true, run: s => { self(s).status = 'work'; self(s).history.push(nowLabel() + ' · механик взял в работу'); logIt(s, 'Зуев П.', 'Взял в работу: ' + task.title); }, msg: 'Задача в работе' });
    }
    if (role === 'mechanic' && task.status === 'work') {
      A.push({ label: 'Нужна запчасть', ask: 'part' });
      A.push({ label: 'Выполнено — на приёмку', primary: true, run: s => { self(s).status = 'done'; self(s).history.push(nowLabel() + ' · выполнено, ждёт приёмки'); logIt(s, 'Зуев П.', 'Выполнил: ' + task.title); }, msg: 'Отправлено на приёмку руководителю' });
    }
    if (role === 'mechanic' && task.status === 'got') {
      A.push({ label: 'Установил — на приёмку', primary: true, run: s => { self(s).status = 'done'; self(s).history.push(nowLabel() + ' · выполнено, ждёт приёмки'); logIt(s, 'Зуев П.', 'Выполнил: ' + task.title); }, msg: 'Отправлено на приёмку' });
    }
    if (role === 'owner' && task.status === 'done') {
      A.push({ label: 'Вернуть механику', run: s => { self(s).status = 'work'; self(s).history.push(nowLabel() + ' · возвращено механику'); }, msg: 'Задача возвращена механику' });
      A.push({ label: 'Принять ремонт', primary: true, run: s => {
        self(s).status = 'accepted'; self(s).history.push(nowLabel() + ' · принято, техника на линии');
        const u = s.units.find(x => x.id === task.unitId);
        const stillOpen = s.tasks.some(t => t.unitId === task.unitId && t.kind === 'repair' && t.parentId === null && t.id !== task.id && t.status !== 'accepted' && t.stops);
        if (u && !stillOpen) u.status = 'line';
        logIt(s, 'Петров И.', 'Принял ремонт: ' + task.title);
      }, msg: 'Ремонт принят, машина на линии' });
    }
  }

  if (task.kind === 'supply') {
    if (role === 'owner' && task.status === 'approve') {
      A.push({ label: 'Согласовать ' + fmt(task.price), primary: true, run: s => { self(s).status = 'buy'; self(s).history.push(nowLabel() + ' · согласовано владельцем'); logIt(s, 'Петров И.', 'Согласовал закупку ' + fmt(task.price)); }, msg: 'Закупка согласована — ушла снабжению' });
    }
    if (role === 'supply' && task.status === 'buy') {
      A.push({ label: 'Закуплено — передать механику', primary: true, run: s => {
        self(s).status = 'handed'; self(s).history.push(nowLabel() + ' · закуплено, счёт ушёл бухгалтеру');
        s.bills.unshift({ id: 'b' + (s.nextId++), who: 'Поставщик запчастей', basis: task.title, kind: 'Запчасти', sum: task.price, status: 'topay', link: 'Цепочка № ' + task.chain });
        logIt(s, 'Котов Е.', 'Закупил: ' + task.title);
      }, msg: 'Счёт ушёл бухгалтеру, запчасть едет механику' });
    }
    if (role === 'mechanic' && task.status === 'handed') {
      A.push({ label: 'Запчасть получил', primary: true, run: s => {
        self(s).status = 'done'; self(s).history.push(nowLabel() + ' · механик получил');
        const p = parentOf(s); if (p && p.status === 'wait') { p.status = 'got'; p.history.push(nowLabel() + ' · запчасть получена'); }
        logIt(s, 'Зуев П.', 'Получил запчасть: ' + task.title);
      }, msg: 'Основная задача перешла в «Запчасть получена»' });
    }
  }

  if (task.kind === 'doc' || task.kind === 'general') {
    if (role === task.toRole && task.status === 'todo') {
      A.push({ label: 'Взять в работу', run: s => { self(s).status = 'work'; self(s).history.push(nowLabel() + ' · взято в работу'); }, msg: 'Задача в работе' });
    }
    if (role === task.toRole && (task.status === 'todo' || task.status === 'work')) {
      A.push({ label: 'Выполнено', primary: true, run: s => { self(s).status = 'accepted'; self(s).history.push(nowLabel() + ' · выполнено'); }, msg: 'Задача закрыта' });
    }
  }
  return A;
}

export function requestPart(state, update, task, name, price) {
  update(s => {
    const p = s.tasks.find(t => t.id === task.id);
    p.status = 'wait'; p.history.push(nowLabel() + ' · запрошена запчасть');
    const needApprove = price > SUPPLY_LIMIT;
    s.tasks.push({ id: 't' + (s.nextId++), chain: task.chain, parentId: task.id, kind: 'supply', title: 'Купить: ' + name, unitId: task.unitId, from: 'Зуев П., механик', toRole: needApprove ? 'owner' : 'supply', status: needApprove ? 'approve' : 'buy', price, created: nowLabel(), note: needApprove ? 'Сумма выше лимита 20 000 ₽ — нужно согласование владельца.' : 'В пределах лимита — сразу снабжению.', history: [nowLabel() + ' · создано механиком'] });
    logIt(s, 'Зуев П.', 'Запросил запчасть: ' + name);
  }, price > SUPPLY_LIMIT ? 'Закупка дороже 20 000 ₽ — ушла владельцу на согласование' : 'Задача ушла снабжению');
}

// Входящие роли: что ждёт действия именно от неё
export function inboxFor(state, role) {
  return state.tasks.filter(t => {
    if (role === 'owner') return true;
    if (t.status === 'accepted') return false;
    if ((t.kind === 'general' || t.kind === 'doc') && t.toRole === role) return true;
    if (role === 'mechanic') return (t.kind === 'repair' && ['todo', 'work', 'got', 'wait'].includes(t.status)) || (t.kind === 'supply' && t.status === 'handed');
    if (role === 'supply') return t.kind === 'supply' && ['buy', 'approve', 'handed'].includes(t.status);
    if (role === 'dispatcher') return t.toRole === 'dispatcher' || t.kind === 'repair';
    if (role === 'accountant') return false;
    return false;
  });
}

export function actionableCount(state, role) {
  return state.tasks.filter(t => taskActions(t, role, state).length > 0).length;
}

export function fmt(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Math.round(Number(n));
  const s = Math.abs(v).toLocaleString('ru-RU');
  return (v < 0 ? '−' : '') + s + ' ₽';
}

// ---------- общие помощники для разделов «Бизнес» ----------

const SHORT = { owner: 'Петров И.', dispatcher: 'Орлова Т.', mechanic: 'Зуев П.', supply: 'Котов Е.', accountant: 'Савельева Н.', driver: 'Ковалёв Д.', customer: 'Лебедева А. (заказчик)' };
export function whoShort(role) { return SHORT[role] || role; }

export function addLog(s, role, what) { s.log.unshift({ t: nowLabel().slice(6), who: whoShort(role), what }); }

// Простая задача кому-то: попадает во входящие роли, у водителя — на телефон
export function addTask(s, { title, toRole, from, unitId, note, driverId }) {
  s.tasks.unshift({ id: 't' + (s.nextId++), chain: 100 + s.nextId, parentId: null, kind: 'general', title, unitId: unitId || 'u1', from, toRole, driverId: driverId || null, status: 'todo', created: nowLabel(), note: note || '', history: [nowLabel() + ' · создано'] });
}
