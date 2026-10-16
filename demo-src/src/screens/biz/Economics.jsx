import React, { useState } from 'react';
import { useStore, fmt } from '../../store.jsx';
import { ECONOMICS } from '../../bizdata.js';
import { PageHead, Table, Badge } from '../../ui.jsx';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт'];

export default function Economics() {
  const { state } = useStore();
  const rows = ECONOMICS.map(e => {
    const u = state.units.find(x => x.id === e.unitId);
    const result = e.revenue - e.salary - e.fuel - e.repairs;
    return { id: e.unitId, name: u.name + ' · ' + u.plate, ...e, result, verdict: result < -100000 ? 'sell' : result < 0 ? 'watch' : 'ok' };
  });
  const worst = [...rows].sort((a, b) => a.result - b.result)[0];
  const [sel, setSel] = useState(worst.id);
  const cur = rows.find(r => r.id === sel);
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  const max = Math.max(...cur.months);

  return (
    <>
      <PageHead eyebrow="Сколько каждая машина заработала и сколько съела — с начала года" title="Экономика техники · январь–октябрь" />
      {worst.result < 0 && (
        <div className="alert danger" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
          <b style={{ fontSize: 16 }}>{worst.name} работает в минус: {fmt(worst.result)} с начала года</b>
          <span style={{ color: 'var(--ink)' }}>Ремонты — {fmt(worst.repairs)}, это {Math.round(worst.repairs / worst.revenue * 100)}% выручки. Простой — {worst.idleDays} дней. Выручка падает с весны. Стоит оценить продажу или замену.</span>
        </div>
      )}
      <Table
        title="Каждая машина: доходы и расходы · нажмите строку"
        columns={[
          { key: 'name', label: 'Машина', render: (v, r) => <button type="button" onClick={() => setSel(r.id)} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: r.id === sel ? 700 : 500, color: r.id === sel ? 'var(--signal-text)' : 'var(--ink)', cursor: 'pointer', textAlign: 'left' }}>{v}</button> },
          { key: 'revenue', label: 'Выручка', money: true }, { key: 'salary', label: 'Зарплата', money: true },
          { key: 'fuel', label: 'Топливо', money: true }, { key: 'repairs', label: 'Ремонты', money: true },
          { key: 'idle', label: 'Простой', right: true },
          { key: 'result', label: 'Итог', right: true, render: v => <b style={{ color: v < 0 ? 'var(--danger)' : 'var(--success)' }}>{fmt(v)}</b> },
          { key: 'verdict', label: 'Вывод', render: v => v === 'sell' ? <Badge tone="danger">Продать</Badge> : v === 'watch' ? <Badge tone="warning">Под наблюдением</Badge> : <Badge tone="success">Выгодна</Badge> }
        ]}
        rows={rows.map(r => ({ ...r, idle: r.idleDays + ' дн.' }))}
        total={{ revenue: sum('revenue'), salary: sum('salary'), fuel: sum('fuel'), repairs: sum('repairs'), result: fmt(sum('result')) }}
      />
      <section className="card card-pad">
        <h2>{cur.name}: выручка по месяцам, тыс. ₽</h2>
        <div role="img" aria-label={`Выручка по месяцам от ${Math.min(...cur.months)} до ${max} тысяч рублей`} style={{ display: 'grid', gridTemplateColumns: 'repeat(10, minmax(0,1fr))', gap: 8, alignItems: 'end', height: 160, borderBottom: '1px solid var(--line)' }}>
          {cur.months.map((m, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 2 }}>
              <span className="num subtle" style={{ fontSize: 11, textAlign: 'center' }}>{m}</span>
              <i style={{ display: 'block', height: m / max * 130, background: cur.result < 0 ? 'var(--danger)' : 'var(--signal)', borderRadius: '4px 4px 0 0' }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, minmax(0,1fr))', gap: 8 }}>{MONTHS.map(m => <span key={m} className="subtle" style={{ fontSize: 12, textAlign: 'center' }}>{m}</span>)}</div>
        <span className="subtle" style={{ fontSize: 12 }}>Выручка — из подтверждённых смен, зарплата — из табеля, топливо — из чеков и карт, ремонты — запчасти по закрытым заявкам. Амортизацию и лизинг можно внести вручную.</span>
      </section>
    </>
  );
}
