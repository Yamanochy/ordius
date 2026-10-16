import React, { useEffect, useRef, useState } from 'react';
import { useStore, payroll, objectsEconomy, inboxFor, taskActions, fmt, nowLabel, addLog, addTask, STATUS } from './store.jsx';
import { DRIVERS, OBJECTS, DAYS, ROLES } from './data.js';
import { Icon } from './ui.jsx';

// ============================================================
// ПОМОЩНИК ORDIUS — демо-версия.
// Понимает фразы по ключевым словам (в рабочей версии — нейросеть).
// Ничего не меняет без кнопки «Подтвердить». Права — как у роли.
// ============================================================

const ME = 'd1'; // водитель в демо — Ковалёв Дмитрий

const CHIPS = {
  driver: ['Как отметить смену?', 'Отметь смену 12 октября, 12 часов, Карьер Восточный', 'Сколько я заработал в октябре?', 'Почему смена не подтверждена?', 'Пробито колесо, ехать нельзя', 'Где ПИН-код топливной карты?'],
  mechanic: ['Какие у меня задачи?', 'Как заказать запчасть?', 'Как выпустить машину на линию?'],
  supply: ['Что нужно купить?', 'Когда нужно согласование владельца?'],
  accountant: ['Сколько нужно выплатить водителям?', 'Отметь выплату Ковалёву', 'Как сформировать реестр для заказчика?', 'Как выгрузить ведомость в Excel?'],
  owner: ['Что требует моего внимания?', 'Подтверди все смены', 'Какой объект в убытке?', 'Заблокируй топливную карту КамАЗа', 'Поставь диспетчеру задачу продлить пропуск на Карьер'],
  dispatcher: ['Подтверди все смены', 'Какие машины в ремонте?', 'Поставь Ковалёву задачу заехать на мойку'],
  customer: ['Как подтвердить смены?', 'Сколько смен по объекту?']
};

const VOICE_EXAMPLE = {
  driver: 'Отметь смену 12 октября, 12 часов, Карьер Восточный',
  mechanic: 'Какие у меня задачи?',
  supply: 'Что нужно купить?',
  accountant: 'Сколько нужно выплатить водителям?',
  owner: 'Что требует моего внимания?',
  dispatcher: 'Какие машины в ремонте?',
  customer: 'Как подтвердить смены?'
};

const GREET = {
  driver: 'Здравствуйте, Дмитрий. Я Орди, ИИ-помощник Ordius. Помогу отметить смену, сообщить о поломке или разобраться с зарплатой. Можно сказать голосом.',
  mechanic: 'Здравствуйте, Павел. Я Орди, ИИ-помощник Ordius. Покажу ваши заявки и подскажу, как провести ремонт по шагам.',
  supply: 'Здравствуйте, Евгений. Я Орди, ИИ-помощник Ordius. Покажу, что нужно закупить и что ждёт согласования.',
  accountant: 'Здравствуйте, Наталья. Я Орди, ИИ-помощник Ordius. Подскажу, где ведомость и реестр, посчитаю, сколько осталось выплатить.',
  owner: 'Здравствуйте, Игорь Петрович. Я Орди, ИИ-помощник Ordius. Расскажу, что ждёт вашего решения, и внесу изменения — после вашего подтверждения.',
  dispatcher: 'Здравствуйте, Татьяна. Я Орди, ИИ-помощник Ordius. Помогу с табелем, ремонтами и задачами водителям.',
  customer: 'Здравствуйте, Анна. Я Орди, ИИ-помощник Ordius. Подскажу, как проверить и подтвердить смены подрядчика.'
};

const NUMW = { один: 1, одну: 1, первое: 1, первого: 1, два: 2, две: 2, второе: 2, второго: 2, три: 3, третье: 3, третьего: 3, четыре: 4, четвертое: 4, четвертого: 4, пять: 5, пятое: 5, пятого: 5, шесть: 6, шестое: 6, шестого: 6, семь: 7, седьмое: 7, седьмого: 7, восемь: 8, восьмое: 8, восьмого: 8, девять: 9, девятое: 9, девятого: 9, десять: 10, десятое: 10, десятого: 10, одиннадцать: 11, одиннадцатое: 11, одиннадцатого: 11, двенадцать: 12, двенадцатое: 12, двенадцатого: 12, тринадцать: 13, тринадцатое: 13, тринадцатого: 13, четырнадцать: 14, четырнадцатое: 14, четырнадцатого: 14 };
const norm = t => t.toLowerCase().replace(/ё/g, 'е')
  .replace(/[а-я]+/g, w => (w in NUMW ? String(NUMW[w]) : w))
  .replace(/(^|[^а-я])сегодня/g, '$1 14 октября').replace(/(^|[^а-я])вчера/g, '$1 13 октября');
const has = (t, ...w) => w.some(x => t.includes(x));
const dayNum = d => Number(d.slice(8));
const UNIT_KEYS = [['камаз', 'u2'], ['jcb', 'u3'], ['экскаватор', 'u3'], ['вакуум', 'u4'], ['грейдер', 'u5'], ['518', 'u6'], ['512', 'u1'], ['шакман', 'u1'], ['shacman', 'u1']];
const findUnit = t => (UNIT_KEYS.find(([k]) => t.includes(k)) || [])[1];
const findDriver = t => DRIVERS.find(d => t.includes(norm(d.name.split(' ')[0]).slice(0, -1)));
const findObject = t => has(t, 'карьер') ? 'o1' : has(t, 'жк', 'северн') ? 'o2' : has(t, 'уборк', 'улиц', 'ленинск') ? 'o3' : null;
const objName = id => (OBJECTS.find(o => o.id === id) || {}).name;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };

function unitTitle(state, id) { const u = state.units.find(x => x.id === id); return u ? `${u.name} ${u.plate}` : ''; }

// ---------- ответы ----------
function answer(raw0, role, state) {
  const raw = raw0.replace(/^\s*орди[\s,!.:-]*/i, '');
  const t = norm(raw);

  if (has(t, 'что ты умеешь', 'что умеешь', 'помощь', 'привет', 'здравств', 'кто ты')) {
    return { text: 'Я Орди, ИИ-помощник Ordius. Отвечаю на вопросы, показываю цифры из системы и вношу изменения. Любое изменение — только после вашей кнопки «Подтвердить». Вот что можно спросить:', chips: true };
  }

  // ===== Водитель =====
  if (role === 'driver') {
    const free = DAYS.filter(d => !state.shifts.some(s => s.driverId === ME && s.date === d));
    if (has(t, 'отметь', 'запиши', 'добавь') && has(t, 'смен')) {
      const dm = t.match(/(\d{1,2})\s*(октя|окт|числ|\.10)/);
      const hm = t.match(/(\d{1,2})\s*(час|ч\b)/);
      const obj = findObject(t) || 'o1';
      let date = dm ? DAYS.find(d => dayNum(d) === Number(dm[1])) : free[free.length - 1];
      if (dm && !date) return { text: 'В демо доступны даты с 1 по 14 октября. Назовите день из этого периода.' };
      if (!date) return { text: 'Все дни с 1 по 14 октября у вас уже отмечены.' };
      if (state.shifts.some(s => s.driverId === ME && s.date === date)) {
        return { text: `На ${dayNum(date)} октября смена уже есть. Свободные дни: ${free.map(dayNum).join(', ') || 'нет'}.` };
      }
      const hours = hm ? Number(hm[1]) : 12;
      return {
        text: 'Проверьте, всё верно? Фото путевого листа прикреплю из камеры.',
        action: {
          title: 'Новая смена',
          rows: [['Дата', `${dayNum(date)} октября`], ['Объект', objName(obj)], ['Часы', `${hours} ч${hours > 12 ? ` (переработка ${hours - 12} ч)` : ''}`], ['Техника', unitTitle(state, 'u1')], ['Путевой лист', 'фото прикреплено']],
          run: s => {
            s.shifts.push({ id: 's' + (s.nextId++), date, driverId: ME, unitId: 'u1', objectId: obj, hours, status: 'pending', photo: true });
            s.log.unshift({ t: nowLabel().slice(6), who: 'Ковалёв Д.', what: `Отметил смену за ${dayNum(date)}.10, ${hours} ч (через Орди)` });
          },
          done: 'Смена отправлена диспетчеру. Как только её подтвердят, она попадёт в расчёт зарплаты.',
          toast: 'Смена отправлена на подтверждение',
          link: { label: 'Мои смены', screen: 'driver' }
        }
      };
    }
    if (has(t, 'смен') && has(t, 'как', 'где')) {
      return { text: 'На главном экране нажмите синюю кнопку «Смена», выберите дату и объект, укажите часы и сфотографируйте путевой лист. Смена уйдёт диспетчеру на подтверждение. Или просто скажите мне: «Отметь смену 12 октября, 12 часов, Карьер Восточный».' };
    }
    if (has(t, 'заработ', 'зарплат', 'сколько я', 'выплат', 'аванс', 'начисл')) {
      const p = payroll(state).find(x => x.driver.id === ME);
      return { text: `За 1–14 октября подтверждено ${p.shifts} ${plural(p.shifts, 'смена', 'смены', 'смен')}, начислено ${fmt(p.earned)}. Аванс ${fmt(p.advance)} уже получен${p.held ? `, удержано ${fmt(p.held)}` : ''}. Осталось к выплате ${fmt(p.left)}${p.paid ? ' — уже выплачено' : ''}.${p.pendingCount ? ` Ещё ${p.pendingCount} ${plural(p.pendingCount, 'смена ждёт', 'смены ждут', 'смен ждут')} подтверждения — после неё сумма вырастет.` : ''}` };
    }
    if (has(t, 'не подтвержд', 'почему', 'ждет')) {
      const pend = state.shifts.filter(s => s.driverId === ME && s.status === 'pending');
      if (!pend.length) return { text: 'Все ваши смены подтверждены. Неподтверждённых нет.' };
      return {
        text: `Ждёт подтверждения: ${pend.map(s => `${dayNum(s.date)} октября (${s.hours} ч)`).join(', ')}. Диспетчер подтверждает смены, сверив путевой лист. Обычно это занимает до конца следующего дня. Могу напомнить диспетчеру.`,
        action: {
          title: 'Напомнить диспетчеру',
          rows: [['Кому', 'Орлова Татьяна, диспетчер'], ['Текст', `Подтвердите смену Ковалёва за ${pend.map(s => dayNum(s.date)).join(', ')} октября`]],
          run: s => addTask(s, { title: `Подтвердить смену Ковалёва Д. за ${pend.map(s2 => dayNum(s2.date)).join(', ')}.10`, toRole: 'dispatcher', from: 'Ковалёв Д., водитель', unitId: 'u1', note: 'Напоминание от водителя через помощника.' }),
          done: 'Диспетчер получил задачу. Вы увидите, когда смену подтвердят.',
          toast: 'Напоминание ушло диспетчеру'
        }
      };
    }
    if (has(t, 'колес', 'слом', 'полом', 'течь', 'течет', 'не завод', 'стучит', 'не горит', 'пробит', 'сломал')) {
      const stops = has(t, 'нельзя', 'встал', 'не завод', 'не еду');
      return {
        text: 'Создам заявку механику. Фото прикрепите в заявке — механик увидит её сразу.',
        action: {
          title: 'Заявка на ремонт',
          rows: [['Что случилось', cap(raw.trim())], ['Техника', unitTitle(state, 'u1')], ['Ехать можно?', stops ? 'Нет — машина встанет в ремонт' : 'Да, ремонт после смены'], ['Кому', 'Зуев Павел, механик']],
          run: s => {
            s.tasks.unshift({ id: 't' + (s.nextId++), chain: 100 + s.nextId, parentId: null, kind: 'repair', stops, title: cap(raw.trim()), unitId: 'u1', from: 'Ковалёв Д., водитель', toRole: 'mechanic', status: 'todo', created: nowLabel(), note: 'Создано через помощника.', history: [nowLabel() + ' · водитель сообщил о поломке'] });
            if (stops) s.units.find(u => u.id === 'u1').status = 'repair';
            s.log.unshift({ t: nowLabel().slice(6), who: 'Ковалёв Д.', what: 'Сообщил о поломке: ' + raw.trim() });
          },
          done: 'Заявка у механика в статусе «К исполнению». Переключитесь на роль «Механик», чтобы увидеть её с той стороны.',
          toast: 'Заявка ушла механику'
        }
      };
    }
    if (has(t, 'пин', 'карт', 'топлив', 'заправ')) {
      const c = state.cards.find(x => x.unitId === 'u1');
      return { text: `Ваша карта •••• ${c.number.slice(-4)} (${c.provider}), лимит ${c.limit}. ПИН-код — на главном экране, кнопка «Показать ПИН»: он виден 10 секунд, и каждый показ записывается в журнал. Сам я ПИН-коды не называю.` };
    }
  }

  // ===== Механик =====
  if (role === 'mechanic') {
    if (has(t, 'задач', 'заявк', 'что делать', 'мои')) {
      const list = inboxFor(state, 'mechanic');
      if (!list.length) return { text: 'Открытых заявок нет.' };
      return { text: `У вас ${list.length} ${plural(list.length, 'заявка', 'заявки', 'заявок')}:\n` + list.map(x => `• ${x.title} — ${unitTitle(state, x.unitId)}, ${STATUS[x.status].label.toLowerCase()}`).join('\n'), link: { label: 'Открыть заявки', screen: 'mech' } };
    }
    if (has(t, 'запчаст', 'заказ', 'купить')) {
      return { text: 'Откройте заявку, нажмите «Взять в работу», затем «Нужна запчасть». Укажите, что нужно и примерную цену. До 20 000 ₽ задача сразу уходит снабжению, дороже — сначала владельцу на согласование. Когда запчасть привезут, нажмите «Запчасть получил».', link: { label: 'Открыть заявки', screen: 'mech' } };
    }
    if (has(t, 'выпуск', 'линию', 'осмотр', 'чек')) {
      return { text: 'Раздел «Выпуск на линию»: пройдите чек-лист по машине. Если нашли замечание, отметьте его — оно само станет заявкой на ремонт, и машина не выйдет, пока вы её не закроете.', link: { label: 'Выпуск на линию', screen: 'release' } };
    }
  }

  // ===== Снабжение =====
  if (role === 'supply') {
    if (has(t, 'соглас', 'лимит')) return { text: 'Закупка дороже 20 000 ₽ сначала уходит владельцу. После его «Согласовать» задача появится у вас со статусом «Закупить». Лимит владелец меняет в настройках.' };
    if (has(t, 'купить', 'закуп', 'нужно', 'задач')) {
      const list = inboxFor(state, 'supply');
      if (!list.length) return { text: 'Сейчас закупать нечего.' };
      return { text: list.map(x => `• ${x.title} — ${fmt(x.price)}, ${STATUS[x.status].label.toLowerCase()}`).join('\n'), link: { label: 'Открыть задачи', screen: 'tasks' } };
    }
  }

  // ===== Бухгалтер =====
  if (role === 'accountant' || role === 'owner') {
    if (has(t, 'выплатить', 'к выплате', 'сколько нужно', 'долг')) {
      const p = payroll(state).filter(x => !x.paid && x.left > 0);
      const sum = p.reduce((a, x) => a + x.left, 0);
      return { text: `Не выплачено ${p.length} ${plural(p.length, 'водителю', 'водителям', 'водителям')} на ${fmt(sum)}:\n` + p.map(x => `• ${x.driver.name} — ${fmt(x.left)}`).join('\n'), link: { label: 'Открыть бухгалтерию', screen: 'accounting' } };
    }
    if (has(t, 'выплат', 'оплат', 'выплачен') && has(t, 'отметь', 'отмет', 'провед')) {
      const d = findDriver(t);
      if (!d) return { text: 'Кому отметить выплату? Назовите фамилию, например: «Отметь выплату Ковалёву».' };
      const p = payroll(state).find(x => x.driver.id === d.id);
      if (p.paid) return { text: `${d.name}: выплата уже отмечена.` };
      return {
        text: 'Отмечу выплату остатка. Водитель сразу увидит её в телефоне.',
        action: {
          title: 'Выплата водителю',
          rows: [['Водитель', d.name], ['Начислено', fmt(p.earned)], ['Аванс', fmt(p.advance)], ['Удержано', fmt(p.held)], ['К выплате', fmt(p.left)]],
          run: s => { s.paid[d.id] = true; addLog(s, role, `Выплата ${d.name}: ${fmt(p.left)} (через Орди)`); },
          done: `${d.name}: выплата ${fmt(p.left)} отмечена.`,
          toast: 'Выплата отмечена',
          link: { label: 'Открыть бухгалтерию', screen: 'accounting' }
        }
      };
    }
    if (has(t, 'реестр', 'акт')) {
      return { text: 'Реестр для заказчика собирается сам из подтверждённых смен:\n1. В «Табеле» проверьте, что все смены за период подтверждены.\n2. Заказчик открывает свой кабинет и видит реестр по своему объекту: техника, водитель, часы, фото путевых.\n3. Заказчик нажимает «Подтвердить реестр» — акт формируется автоматически.\nСобирать реестр вручную не нужно.', link: { label: 'Открыть табель', screen: 'tabel' } };
    }
    if (has(t, 'excel', 'ексель', 'эксель', 'ведомост', 'выгруз', '1с')) {
      return { text: 'Бухгалтерия → кнопка «Ведомость (Excel)» справа вверху. В файле: водитель, смены, начислено, аванс, удержания, к выплате. Его можно загрузить в 1С.', link: { label: 'Открыть бухгалтерию', screen: 'accounting' } };
    }
  }

  // ===== Владелец и диспетчер =====
  if (role === 'owner' || role === 'dispatcher') {
    if (has(t, 'подтверди') && has(t, 'смен')) {
      const pend = state.shifts.filter(s => s.status === 'pending');
      if (!pend.length) return { text: 'Неподтверждённых смен нет.' };
      return {
        text: `Ждут подтверждения ${pend.length} ${plural(pend.length, 'смена', 'смены', 'смен')}. У всех приложено фото путевого листа.`,
        action: {
          title: 'Подтвердить смены',
          rows: pend.map(s => [DRIVERS.find(d => d.id === s.driverId).name, `${dayNum(s.date)}.10 · ${s.hours} ч · ${objName(s.objectId)}`]),
          run: s => { s.shifts.forEach(x => { if (x.status === 'pending') x.status = 'confirmed'; }); addLog(s, role, `Подтвердил ${pend.length} смен (через Орди)`); },
          done: 'Смены подтверждены. Зарплата и выручка по объектам пересчитались.',
          toast: 'Смены подтверждены',
          link: { label: 'Открыть табель', screen: 'tabel' }
        }
      };
    }
    if (has(t, 'ремонт') && has(t, 'какие', 'сколько', 'машин')) {
      const r = state.units.filter(u => u.status === 'repair');
      return { text: r.length ? `В ремонте ${r.length}:\n` + r.map(u => `• ${u.name} ${u.plate}`).join('\n') : 'Вся техника на линии.', link: { label: 'Открыть технику', screen: 'fleet' } };
    }
    if (has(t, 'задач', 'поручи', 'поставь')) {
      const d = findDriver(t);
      const toDisp = has(t, 'диспетчер');
      const body = raw.replace(/^.*?задач[уи]?\s*/i, '').trim() || raw.trim();
      if (!d && !toDisp && role === 'owner') return { text: 'Кому поставить задачу: диспетчеру, механику или водителю? Например: «Поставь диспетчеру задачу продлить пропуск на Карьер».' };
      const to = d ? 'driver' : toDisp ? 'dispatcher' : 'dispatcher';
      return {
        text: 'Поставлю задачу. Исполнитель увидит её во входящих.',
        action: {
          title: 'Новая задача',
          rows: [['Кому', d ? `${d.name}, водитель` : 'Орлова Татьяна, диспетчер'], ['Что сделать', cap(body)], ['От кого', role === 'owner' ? 'Петров И., владелец' : 'Орлова Т., диспетчер']],
          run: s => { addTask(s, { title: cap(body), toRole: to, from: role === 'owner' ? 'Петров И., владелец' : 'Орлова Т., диспетчер', driverId: d ? d.id : null, unitId: d ? d.unitId : 'u1' }); addLog(s, role, 'Поставил задачу: ' + cap(body)); },
          done: d && d.id === ME ? 'Задача ушла водителю — переключитесь на роль «Водитель», она появится в телефоне.' : 'Задача поставлена.',
          toast: 'Задача поставлена',
          link: { label: 'Открыть задачи', screen: 'tasks' }
        }
      };
    }
  }

  if (role === 'owner') {
    if (has(t, 'внимани', 'что нового', 'сводк', 'что ждет', 'решени')) {
      const pend = state.shifts.filter(s => s.status === 'pending').length;
      const mine = state.tasks.filter(x => taskActions(x, 'owner', state).length > 0);
      const rep = state.units.filter(u => u.status === 'repair');
      const bad = objectsEconomy(state).filter(o => o.margin < 0);
      const lines = [];
      if (pend) lines.push(`• ${pend} ${plural(pend, 'смена ждёт', 'смены ждут', 'смен ждут')} подтверждения`);
      mine.forEach(x => lines.push(`• ${x.title} — ${STATUS[x.status].label.toLowerCase()}`));
      if (rep.length) lines.push(`• В ремонте: ${rep.map(u => u.name + ' ' + u.plate).join(', ')}`);
      bad.forEach(o => lines.push(`• Объект «${o.name}» в убытке: ${fmt(o.margin)}`));
      return { text: lines.length ? 'Сейчас ждёт вашего внимания:\n' + lines.join('\n') : 'Всё в порядке — решений от вас не ждут.', link: { label: 'Открыть обзор', screen: 'overview' } };
    }
    if (has(t, 'убыт', 'маржа', 'прибыл', 'объект')) {
      const e = objectsEconomy(state);
      const bad = e.filter(o => o.margin < 0);
      const head = bad.length ? `В убытке: ${bad.map(o => `«${o.name}» (${fmt(o.margin)})`).join(', ')}. Ставка заказчика не покрывает зарплату, ремонты и топливо — стоит пересмотреть её при продлении контракта.` : 'Убыточных объектов нет.';
      return { text: head + '\n\nВсе объекты за 1–14 октября:\n' + e.map(o => `• ${o.name}: выручка ${fmt(o.revenue)}, маржа ${fmt(o.margin)} (${o.pct.toFixed(1).replace('.', ',')} %)`).join('\n'), link: { label: 'Открыть объекты', screen: 'objects' } };
    }
    if (has(t, 'заблокир', 'блокир') && has(t, 'карт')) {
      const uid = findUnit(t);
      if (!uid) return { text: 'Какую карту заблокировать? Назовите машину, например: «Заблокируй карту КамАЗа».' };
      const c = state.cards.find(x => x.unitId === uid);
      if (c.status === 'blocked') return { text: `Карта •••• ${c.number.slice(-4)} уже заблокирована.` };
      return {
        text: 'Заблокирую карту. Заправиться по ней будет нельзя, пока вы её не разблокируете.',
        action: {
          title: 'Блокировка топливной карты',
          rows: [['Карта', `•••• ${c.number.slice(-4)} · ${c.provider}`], ['Техника', unitTitle(state, uid)], ['Заправлено в октябре', `${c.spent.toLocaleString('ru-RU')} л`]],
          run: s => { s.cards.find(x => x.id === c.id).status = 'blocked'; addLog(s, role, `Заблокировал топливную карту •••• ${c.number.slice(-4)} (через Орди)`); },
          done: 'Карта заблокирована, запись в журнале сделана.',
          toast: 'Карта заблокирована',
          link: { label: 'Открыть технику', screen: 'fleet' }
        }
      };
    }
  }

  // ===== Заказчик =====
  if (role === 'customer') {
    if (has(t, 'подтверд', 'как')) return { text: 'В реестре каждая строка — смена: техника, водитель, часы, фото путевого. Если всё верно, нажмите «Подтвердить реестр». Если есть вопрос по смене, отметьте его прямо в строке — подрядчик увидит сразу.', link: { label: 'Открыть реестр', screen: 'customer' } };
    if (has(t, 'сколько', 'смен')) {
      const n = state.shifts.filter(s => s.objectId === 'o1' && s.status === 'confirmed').length;
      return { text: `По объекту «Карьер Восточный» за 1–14 октября подтверждено ${n} ${plural(n, 'смена', 'смены', 'смен')}.`, link: { label: 'Открыть реестр', screen: 'customer' } };
    }
  }

  return { text: 'В демо я понимаю вопросы из подсказок ниже. В рабочей версии Орди работает на нейросети и поймёт любую формулировку — так, как вы говорите.', chips: true };
}

// ---------- интерфейс ----------
function Sparkle({ size = 20 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>;
}
function Mic({ size = 20 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
}

function ActionCard({ a, onConfirm, onCancel, state: st }) {
  return (
    <div className={'as-card' + (st ? ' ' + st : '')}>
      <div className="as-card-title">{a.title}</div>
      <dl>{a.rows.map(([k, v], i) => <React.Fragment key={i}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
      {!st && (
        <div className="as-card-actions">
          <button type="button" className="btn primary sm" onClick={onConfirm}><Icon name="check" size={16} />Подтвердить</button>
          <button type="button" className="btn sm" onClick={onCancel}>Отмена</button>
        </div>
      )}
      {st === 'done' && <div className="as-card-state ok"><Icon name="check" size={16} />Сделано</div>}
      {st === 'cancel' && <div className="as-card-state">Отменено — ничего не изменилось</div>}
    </div>
  );
}

// Кнопка помощника внутри телефонных экранов (вместо плавающей кнопки)
export function AssistantButton() {
  return (
    <button type="button" className="as-inline" onClick={() => window.dispatchEvent(new Event('ordius:assistant'))} aria-label="Открыть ИИ-помощника Орди" title="Спросить Орди">
      <Sparkle size={20} />
    </button>
  );
}

export default function Assistant({ role, go, phone }) {
  const { state, update } = useStore();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const listRef = useRef(null);
  const recRef = useRef(null);
  const person = ROLES.find(r => r.id === role);

  useEffect(() => { setMsgs([{ from: 'bot', text: GREET[role], chips: true }]); setText(''); }, [role]);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener('ordius:assistant', on);
    return () => window.removeEventListener('ordius:assistant', on);
  }, []);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [msgs, open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const send = q => {
    const v = (q ?? text).trim();
    if (!v) return;
    const a = answer(v, role, state);
    setMsgs(m => [...m, { from: 'me', text: v }, { from: 'bot', ...a, id: Date.now() }]);
    setText('');
  };

  const confirm = idx => {
    const m = msgs[idx];
    update(m.action.run, m.action.toast);
    setMsgs(list => [...list.map((x, i) => i === idx ? { ...x, st: 'done' } : x), { from: 'bot', text: m.action.done, link: m.action.link }]);
  };
  const cancel = idx => setMsgs(list => list.map((x, i) => i === idx ? { ...x, st: 'cancel' } : x));

  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const voice = () => {
    if (listening) { recRef.current && recRef.current.stop(); return; }
    if (!SR) {
      setMsgs(m => [...m, { from: 'bot', text: 'Этот браузер не поддерживает голосовой ввод — вставил пример фразы. В Chrome на Android и компьютере можно говорить по-настоящему.' }]);
      setText(VOICE_EXAMPLE[role]);
      return;
    }
    try {
      const r = new SR();
      r.lang = 'ru-RU'; r.interimResults = true; r.maxAlternatives = 1;
      let finalText = '';
      r.onresult = e => {
        const res = Array.from(e.results).map(x => x[0].transcript).join(' ');
        setText(res);
        if (e.results[e.results.length - 1].isFinal) finalText = res;
      };
      r.onerror = () => { setListening(false); setText(VOICE_EXAMPLE[role]); };
      r.onend = () => { setListening(false); if (finalText) send(finalText); };
      recRef.current = r; setListening(true); r.start();
    } catch (e) { setListening(false); setText(VOICE_EXAMPLE[role]); }
  };

  return (
    <>
      {!open && !phone && (
        <button type="button" className="as-fab" onClick={() => setOpen(true)} aria-label="Открыть ИИ-помощника Орди">
          <Sparkle /> <span>Спросить Орди</span>
        </button>
      )}
      {open && (
        <section className="as-panel" role="dialog" aria-label="ИИ-помощник Орди">
          <header className="as-head">
            <span className="as-ava"><Sparkle size={18} /></span>
            <div className="as-head-t"><b>Орди <span className="as-ai">ИИ</span></b><span>Помощник Ordius · {person.label}: {person.person}</span></div>
            <button type="button" className="as-x" onClick={() => setOpen(false)} aria-label="Закрыть Орди"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
          </header>
          <div className="as-list" ref={listRef} aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={'as-msg ' + m.from}>
                {m.text && <p>{m.text}</p>}
                {m.action && <ActionCard a={m.action} state={m.st} onConfirm={() => confirm(i)} onCancel={() => cancel(i)} />}
                {m.link && <button type="button" className="as-link" onClick={() => { go(role, m.link.screen); if (window.innerWidth < 640) setOpen(false); }}>{m.link.label}<Icon name="arrow" size={16} /></button>}
                {m.chips && i === msgs.length - 1 && (
                  <div className="as-chips">{CHIPS[role].map(c => <button key={c} type="button" onClick={() => send(c)}>{c}</button>)}</div>
                )}
              </div>
            ))}
          </div>
          <form className="as-input" onSubmit={e => { e.preventDefault(); send(); }}>
            <button type="button" className={'as-mic' + (listening ? ' on' : '')} onClick={voice} aria-label={listening ? 'Остановить запись' : 'Сказать голосом'} title="Сказать голосом"><Mic /></button>
            <input value={text} onChange={e => setText(e.target.value)} placeholder={listening ? 'Слушаю…' : 'Напишите или скажите Орди'} aria-label="Сообщение помощнику" />
            <button type="submit" className="as-send" disabled={!text.trim()} aria-label="Отправить"><Icon name="arrow" size={18} /></button>
          </form>
          <p className="as-foot">Демо-версия Орди понимает фразы из подсказок. Изменения — только после «Подтвердить».</p>
        </section>
      )}
    </>
  );
}
