import React from 'react';
import { useStore, addLog, fmt } from '../../store.jsx';
import { DRIVERS } from '../../data.js';
import { PageHead, Stat, Table, Badge, Button } from '../../ui.jsx';

export default function Fines({ role }) {
  const { state, update } = useStore();
  const can = role === 'owner';
  const held = (state.deductions || []).reduce((a, d) => a + d.amount, 0);
  const open = state.fines.filter(f => !f.decision);

  const decide = (f, d) => update(s => {
    const x = s.fines.find(y => y.id === f.id); x.decision = d; x.status = 'paid';
    if (d === 'hold') s.deductions.push({ id: 'dd' + (s.nextId++), driverId: f.driverId, amount: f.sum, reason: 'Штраф ГИБДД ' + f.when });
    addLog(s, role, `${d === 'hold' ? 'Удержать с водителя' : 'За счёт компании'}: штраф ${fmt(f.sum)}`);
  }, d === 'hold' ? 'Удержание попало в расчёт зарплаты водителя' : 'Штраф оплачивается компанией');

  return (
    <>
      <PageHead eyebrow="Штрафы по госномерам — сразу с водителем, который был на смене" title="Штрафы ГИБДД" />
      <div className="grid-kpi">
        <Stat label="Ждут решения" value={String(open.length)} tone="bad" delta={open.length ? '!' : ''} hint="удержать или за счёт компании" />
        <Stat label="Удержано с водителей" value={fmt(held)} hint="видно в расчёте зарплаты" />
        <Stat label="Всего штрафов" value={String(state.fines.length)} hint="за октябрь" />
      </div>
      <Table
        title="Штрафы"
        columns={[
          { key: 'when', label: 'Нарушение' }, { key: 'unit', label: 'Машина' }, { key: 'what', label: 'Что' },
          { key: 'driver', label: 'Водитель по смене' }, { key: 'sum', label: 'Сумма', money: true },
          { key: 'discount', label: 'Скидка', render: v => v ? <span className="warn" style={{ fontSize: 13, fontWeight: 600 }}>{v}</span> : <span className="subtle">—</span> },
          { key: 'decision', label: 'Решение', render: (v, r) => v === 'hold' ? <Badge tone="info">Удержано из зарплаты</Badge> : v === 'company' ? <Badge>За счёт компании</Badge> : can ? <span className="row" style={{ gap: 6 }}><Button size="sm" variant="primary" onClick={() => decide(r, 'hold')}>Удержать</Button><Button size="sm" onClick={() => decide(r, 'company')}>За счёт компании</Button></span> : <Badge tone="warning">Ждёт владельца</Badge> }
        ]}
        rows={state.fines.map(f => { const u = state.units.find(x => x.id === f.unitId); return { ...f, unit: u.name + ' ' + u.plate, driver: DRIVERS.find(d => d.id === f.driverId).name }; })}
      />
      <p className="note" style={{ margin: 0 }}>Водитель определяется по смене и путевому листу на время нарушения. «Удержать» добавляет строку удержания в расчёт зарплаты — посмотрите «Бухгалтерию». Порядок и пределы удержаний из зарплаты определяет трудовое законодательство — настройте их вместе с бухгалтером.</p>
    </>
  );
}
