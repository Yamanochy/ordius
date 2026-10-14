import React, { useState } from 'react';
import { useStore, STATUS, fmt } from '../store.jsx';
import { TERMS, HISTORY, DRIVERS } from '../data.js';
import { PageHead, Badge, Table, Button } from '../ui.jsx';
import FuelCard, { maskNumber } from './FuelCard.jsx';

const UNIT_ST = { line: ['На линии', 'success'], repair: ['В ремонте', 'danger'], idle: ['Простой', 'warning'] };
const TERM_C = { ok: 'var(--success)', soon: 'var(--warning)', bad: 'var(--danger)' };

export default function Fleet({ role, go }) {
  const { state } = useStore();
  const [sel, setSel] = useState('u3');
  const u = state.units.find(x => x.id === sel);
  const driver = DRIVERS.find(d => d.unitId === u.id);
  const repairs = state.tasks.filter(t => t.unitId === u.id && t.parentId === null && t.kind === 'repair');
  const parts = state.tasks.filter(t => t.unitId === u.id && t.kind === 'supply').reduce((a, t) => a + (t.price || 0), 0);
  const st = UNIT_ST[u.status];
  const card = (state.cards || []).find(c => c.unitId === u.id);

  return (
    <>
      <PageHead eyebrow={`Техника · ${state.units.length} единиц, в ремонте ${state.units.filter(x => x.status === 'repair').length}`} title="Техника и ремонты" />
      <div className="split">
        <section className="card side" style={{ overflow: 'hidden', flexBasis: 300 }} aria-label="Список техники">
          {state.units.map(x => (
            <button key={x.id} type="button" className={'list-item' + (x.id === sel ? ' on' : '')} onClick={() => setSel(x.id)}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                <b style={{ fontWeight: 600, fontSize: 14 }}>{x.name}</b>
                <span className="muted" style={{ fontSize: 12 }}>{x.plate} · {x.kind}</span>
              </span>
              <Badge tone={UNIT_ST[x.status][1]}>{UNIT_ST[x.status][0]}</Badge>
            </button>
          ))}
        </section>

        <div className="main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card card-pad">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h2 className="h2" style={{ fontSize: 22 }}>{u.name} · {u.plate}</h2>
                <span className="muted" style={{ fontSize: 14 }}>{u.kind} · {u.meter} · закреплён: {driver ? driver.name : '—'} · механик: Зуев П.</span>
              </div>
              <Badge tone={st[1]}>{st[0]}</Badge>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              {(TERMS[u.id] || []).map(([name, left, tone, pct, note]) => (
                <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}><b style={{ fontWeight: 600, fontSize: 14 }}>{name}</b><span style={{ fontSize: 13, fontWeight: 600, color: TERM_C[tone] }}>{left}</span></div>
                  <div className="progress"><i style={{ width: pct + '%', background: TERM_C[tone] }} /></div>
                  <span className="subtle" style={{ fontSize: 12 }}>{note}</span>
                </div>
              ))}
            </div>
            <span className="subtle" style={{ fontSize: 12 }}>Напоминание приходит задачей за 14 и за 3 дня до срока.</span>
          </section>

          <section className="card card-pad">
            <h2>Топливная карта</h2>
            {card ? <FuelCard card={card} role={role} /> : <p className="muted" style={{ margin: 0 }}>К этой машине карта не привязана.</p>}
          </section>

          <section className="card card-pad">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>Ремонты этой машины</h2>
              {parts > 0 && <span className="muted" style={{ fontSize: 13 }}>запчасти по текущим заявкам: <b className="num">{fmt(parts)}</b></span>}
            </div>
            {repairs.length === 0 && <p className="muted" style={{ margin: 0 }}>Открытых заявок нет.</p>}
            {repairs.map(t => (
              <div key={t.id} className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <b style={{ fontWeight: 600 }}>{t.title}</b>
                  <span className="muted" style={{ fontSize: 13 }}>Цепочка № {t.chain} · от: {t.from} · {t.created}</span>
                </span>
                <span className="row"><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>{role !== 'driver' && <Button size="sm" onClick={() => go(role, 'tasks')}>Открыть</Button>}</span>
              </div>
            ))}
          </section>

          <Table
            title="История ремонтов и ТО"
            columns={[{ key: 'date', label: 'Дата' }, { key: 'work', label: 'Работы' }, { key: 'parts', label: 'Запчасти', money: true }, { key: 'hours', label: 'Время механика', right: true }]}
            rows={(HISTORY[u.id] || []).map((h, i) => ({ id: i, date: h[0], work: h[1], parts: h[2], hours: h[3] }))}
            empty="Ремонтов в этом году не было"
          />
        </div>
      </div>

      <Table
        title="Все топливные карты"
        columns={[
          { key: 'number', label: 'Номер карты', render: v => <span className="num">{role === 'owner' ? v : maskNumber(v)}</span> },
          { key: 'unit', label: 'Привязана к технике' },
          { key: 'driver', label: 'Водитель' },
          { key: 'limit', label: 'Лимит' },
          { key: 'spent', label: 'Октябрь, л', right: true },
          { key: 'status', label: 'Статус', render: v => v === 'blocked' ? <Badge tone="danger">Заблокирована</Badge> : <Badge tone="success">Активна</Badge> }
        ]}
        rows={(state.cards || []).map(c => {
          const un = state.units.find(x => x.id === c.unitId);
          const dr = DRIVERS.find(d => d.unitId === c.unitId);
          return { id: c.id, number: c.number, unit: un ? un.name + ' · ' + un.plate : '—', driver: dr ? dr.name : '—', limit: c.limit, spent: c.spent.toLocaleString('ru-RU'), status: c.status };
        })}
      />
    </>
  );
}
