import React from 'react';
import { useStore, objectsEconomy, fmt } from '../store.jsx';
import { PageHead, Stat, Table } from '../ui.jsx';

export default function Objects() {
  const { state } = useStore();
  const rows = objectsEconomy(state);
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  const revenue = sum('revenue'), margin = sum('margin');
  const costs = revenue - margin;
  const loss = rows.filter(r => r.margin < 0);

  return (
    <>
      <PageHead eyebrow="Сколько заработали на каждом объекте · считается из подтверждённых смен" title="Объекты · 1–14 октября" />
      <div className="grid-kpi">
        <Stat label="Выставлено заказчикам" value={fmt(revenue)} hint="смены × ставка заказчика" />
        <Stat label="Затраты" value={fmt(costs)} hint="зарплата, ремонты, топливо" />
        <Stat label="Маржа" value={fmt(margin)} delta={(revenue ? margin / revenue * 100 : 0).toFixed(1).replace('.', ',') + '%'} tone={margin < 0 ? 'bad' : 'good'} hint="от выручки" />
      </div>
      {loss.map(o => (
        <div key={o.id} className="alert danger" role="status">
          <b>{o.name} в убыток: {fmt(o.margin)}.</b>
          <span style={{ color: 'var(--ink)' }}>Выручка {fmt(o.rate)} за смену ниже ваших затрат {fmt(o.shifts ? (o.salary + o.repairs + o.fuel) / o.shifts : 0)}.</span>
        </div>
      ))}
      <Table
        title="Выручка и затраты по объектам"
        columns={[
          { key: 'name', label: 'Объект · заказчик', render: (v, r) => <span style={{ display: 'flex', flexDirection: 'column' }}><b style={{ fontWeight: 600 }}>{v}</b><span className="subtle" style={{ fontSize: 12 }}>{r.client}</span></span> },
          { key: 'shifts', label: 'Смен', right: true },
          { key: 'revenue', label: 'Выставлено', money: true },
          { key: 'salary', label: 'Зарплата', money: true },
          { key: 'repairs', label: 'Ремонты', money: true },
          { key: 'fuel', label: 'Топливо', money: true },
          { key: 'margin', label: 'Маржа', money: true },
          { key: 'pct', label: '%', right: true, render: v => <span style={{ fontWeight: 700, color: v < 0 ? 'var(--danger)' : v < 20 ? 'var(--warning)' : 'var(--success)' }}>{v.toFixed(1).replace('.', ',')}%</span> }
        ]}
        rows={rows}
        total={{ shifts: sum('shifts'), revenue, salary: sum('salary'), repairs: sum('repairs'), fuel: sum('fuel'), margin }}
      />
      <p className="note" style={{ margin: 0 }}>Подтвердите смену в табеле — выручка и зарплата по объекту пересчитаются сразу. Ремонты берутся из закрытых заявок механика, топливо — из чеков заправок.</p>
    </>
  );
}
