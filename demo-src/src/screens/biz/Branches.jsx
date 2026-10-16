import React from 'react';
import { useStore, objectsEconomy, addLog, fmt } from '../../store.jsx';
import { BRANCHES_STATIC } from '../../bizdata.js';
import { PageHead, Table, Button, Badge } from '../../ui.jsx';

export default function Branches({ role }) {
  const { state, update } = useStore();
  const econ = objectsEconomy(state);
  const nskRev = econ.reduce((a, o) => a + o.revenue, 0);
  const nskMargin = econ.reduce((a, o) => a + o.margin, 0);
  const moved = !!state.branchMoved;
  const nsk = { id: 'nsk', name: 'Новосибирск', kind: 'спецтехника, город', head: 'Петров И.', units: state.units.length + (moved ? 2 : 0), load: moved ? 86 : 78, revenue: nskRev, cost: nskRev - nskMargin, idle: 37, late: state.tasks.filter(t => t.status !== 'accepted' && t.parentId === null).length };
  const kem = { ...BRANCHES_STATIC[1], units: moved ? 4 : 6, load: moved ? 81 : 54, idle: moved ? 14 : 61 };
  const list = [nsk, BRANCHES_STATIC[0], kem];

  const move = () => update(s => { s.branchMoved = true; addLog(s, role, 'Перебросил 2 самосвала из Кемерово в Новосибирск'); }, 'Две машины переброшены — загрузка Кемерово выросла до 81%');

  return (
    <>
      <PageHead eyebrow="Каждый руководитель видит только свой филиал. Владелец — все сразу." title="Филиалы · октябрь 2026" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {list.map(b => {
          const margin = b.revenue - b.cost;
          const pct = b.revenue ? margin / b.revenue * 100 : 0;
          const bad = b.id === 'kem' && !moved;
          return (
            <article key={b.id} className="card card-pad">
              <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ fontSize: 20 }}>{b.name}</h2><span className="muted" style={{ fontSize: 13 }}>{b.kind}</span></div>
              <span className="muted" style={{ fontSize: 13 }}>Руководитель: {b.head} · {b.units} ед. техники</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}><span className="muted">Загрузка техники</span><b className="num">{b.load}%</b></div>
                <div className="progress" style={{ height: 8 }}><i style={{ width: b.load + '%', background: b.load > 85 ? 'var(--success)' : b.load < 60 ? 'var(--warning)' : 'var(--signal)' }} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <K k="Выставлено" v={fmt(b.revenue)} />
                <K k="Маржа" v={fmt(margin) + ' · ' + pct.toFixed(1).replace('.', ',') + '%'} color={pct < 8 ? 'var(--danger)' : pct > 22 ? 'var(--success)' : undefined} />
                <K k="Простой техники" v={b.idle + ' ч'} />
                <K k="Открытые задачи" v={String(b.late)} />
              </div>
              {bad && (
                <div className="alert warning" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span><b>Половина парка стоит.</b> <span style={{ color: 'var(--ink)' }}>2 самосвала можно перебросить в Новосибирск под заявки без техники.</span></span>
                  {role === 'owner' && <Button size="sm" variant="primary" onClick={move}>Перебросить 2 машины</Button>}
                </div>
              )}
              {b.id === 'kem' && moved && <Badge tone="success">Машины переброшены</Badge>}
              {b.id === 'dos' && <Badge tone="success">Лучший филиал месяца</Badge>}
            </article>
          );
        })}
      </div>
      <Table
        title="Сравнение филиалов"
        columns={[{ key: 'name', label: 'Филиал' }, { key: 'units', label: 'Техника', right: true }, { key: 'load', label: 'Загрузка', right: true }, { key: 'revenue', label: 'Выставлено', money: true }, { key: 'cost', label: 'Затраты', money: true }, { key: 'margin', label: 'Маржа', money: true }]}
        rows={list.map(b => ({ id: b.id, name: b.name, units: b.units, load: b.load + '%', revenue: b.revenue, cost: b.cost, margin: b.revenue - b.cost }))}
        total={{ units: list.reduce((a, b) => a + b.units, 0), revenue: list.reduce((a, b) => a + b.revenue, 0), cost: list.reduce((a, b) => a + b.cost, 0), margin: list.reduce((a, b) => a + b.revenue - b.cost, 0) }}
      />
    </>
  );
}

function K({ k, v, color }) {
  return <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span className="muted" style={{ fontSize: 12 }}>{k}</span><b className="num" style={{ fontSize: 15, color }}>{v}</b></span>;
}
