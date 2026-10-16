import React from 'react';
import { useStore, addLog, addTask, fmt } from '../../store.jsx';
import { FUEL_NORMS } from '../../bizdata.js';
import { DRIVERS } from '../../data.js';
import { PageHead, Stat, Table, Badge, Button } from '../../ui.jsx';
import { maskNumber } from '../FuelCard.jsx';

const SRC = { card: ['Топливная карта', 'info'], check: ['Чек, фото', ''], nocheck: ['Без чека', 'danger'], asked: ['Чек запрошен', 'warning'] };

export default function Fuel({ role }) {
  const { state, update } = useStore();
  const can = role === 'owner' || role === 'dispatcher' || role === 'accountant';
  const over = FUEL_NORMS.reduce((a, n) => a + n.over, 0);
  const sum = state.fillings.reduce((a, f) => a + f.sum, 0);
  const liters = state.fillings.reduce((a, f) => a + f.liters, 0);
  const noCheck = state.fillings.filter(f => f.src === 'nocheck');

  const ask = f => update(s => {
    s.fillings.find(x => x.id === f.id).src = 'asked';
    const d = DRIVERS.find(x => x.id === f.driverId);
    addTask(s, { title: `Приложить чек заправки ${f.date}, ${f.liters} л`, toRole: 'driver', driverId: f.driverId, unitId: f.unitId, from: 'Орлова Т., диспетчер', note: 'Заправка прошла без чека — сфотографируйте чек или объясните.' });
    addLog(s, role, `Запросил(а) чек у ${d.name}`);
  }, 'Задача ушла водителю в телефон');

  return (
    <>
      <PageHead eyebrow="Заправки по картам и чекам, нормы расхода и перерасход" title="Топливо · октябрь 2026" />
      <div className="grid-kpi">
        <Stat label="Заправлено за 3 дня" value={fmt(sum)} hint={`${liters} л дизеля`} />
        <Stat label="Перерасход по парку" value={fmt(over)} tone="bad" delta="+4,1%" hint="сверх норм за октябрь" />
        <Stat label="Заправки без чека" value={String(noCheck.length)} tone="bad" delta={noCheck.length ? '!' : ''} hint="запросите чек у водителя" />
        <Stat label="Зимние нормы" value="с 1 ноября" hint="надбавка задаётся в настройках" />
      </div>
      <Table
        title="Норма и факт по машинам"
        columns={[
          { key: 'unit', label: 'Машина' }, { key: 'norm', label: 'Норма', right: true }, { key: 'fact', label: 'Факт', right: true },
          { key: 'dev', label: 'Отклонение', right: true, render: v => <b style={{ color: v > 8 ? 'var(--danger)' : v > 3 ? 'var(--warning)' : 'var(--success)' }}>{(v > 0 ? '+' : '') + v.toFixed(1).replace('.', ',')}%</b> },
          { key: 'over', label: 'Перерасход', money: true }
        ]}
        rows={FUEL_NORMS.map(n => { const u = state.units.find(x => x.id === n.unitId); return { id: n.unitId, unit: u.name + ' · ' + u.plate, norm: `${String(n.norm).replace('.', ',')} ${n.unit}`, fact: `${String(n.fact).replace('.', ',')} ${n.unit}`, dev: (n.fact - n.norm) / n.norm * 100, over: n.over }; })}
      />
      <Table
        title="Последние заправки"
        columns={[
          { key: 'date', label: 'Дата' }, { key: 'unit', label: 'Машина' }, { key: 'driver', label: 'Водитель' }, { key: 'card', label: 'Карта' },
          { key: 'l', label: 'Литры', right: true }, { key: 'sum', label: 'Сумма', money: true },
          { key: 'src', label: 'Источник', render: (v, r) => v === 'nocheck' && can ? <span className="row" style={{ gap: 6 }}><Badge tone="danger">Без чека</Badge><Button size="sm" variant="primary" onClick={() => ask(r)}>Запросить чек</Button></span> : <Badge tone={SRC[v][1]}>{SRC[v][0]}</Badge> }
        ]}
        rows={state.fillings.map(f => { const u = state.units.find(x => x.id === f.unitId); const c = state.cards.find(x => x.unitId === f.unitId); return { ...f, unit: u.name + ' ' + u.plate, driver: DRIVERS.find(d => d.id === f.driverId).name, card: c ? maskNumber(c.number) : '—', l: f.liters + ' л' }; })}
      />
      <p className="note" style={{ margin: 0 }}>Попробуйте «Запросить чек» у Ковалёва, затем переключитесь на роль «Водитель» — задача уже будет у него на телефоне. Номера и ПИН топливных карт — в разделе «Техника».</p>
    </>
  );
}
