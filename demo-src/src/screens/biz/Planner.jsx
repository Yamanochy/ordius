import React from 'react';
import { useStore, addLog, addTask } from '../../store.jsx';
import { OBJECTS, DRIVERS } from '../../data.js';
import { WEEK } from '../../bizdata.js';
import { PageHead, Stat, Button, Badge } from '../../ui.jsx';

const CELL = { A: 'cell-A', B: 'cell-B', C: 'cell-C' };

export default function Planner({ role }) {
  const { state, update } = useStore();
  const can = role === 'owner' || role === 'dispatcher';
  const busyDays = u => { const d = new Set(); state.plan.filter(p => p.unitId === u).forEach(p => { for (let i = p.from; i < p.from + p.span; i++) d.add(i); }); return d; };
  const conflicts = state.plan.filter(p => p.conflict);
  const usedCells = state.units.reduce((a, u) => a + busyDays(u.id).size, 0);
  const load = Math.round(usedCells / (state.units.length * 7) * 100);
  const freeTomorrow = state.units.filter(u => !busyDays(u.id).has(2));

  const fits = o => {
    const u = state.units.find(x => x.id === o.fit);
    const days = busyDays(o.fit);
    let clash = false; for (let i = o.from; i < o.from + o.span; i++) if (days.has(i)) clash = true;
    return { u, clash };
  };

  const assign = o => update(s => {
    s.plan.push({ id: 'p' + (s.nextId++), unitId: o.fit, from: o.from, span: o.span, objectId: o.objectId });
    s.orders = s.orders.filter(x => x.id !== o.id);
    const dr = DRIVERS.find(d => d.unitId === o.fit);
    const obj = OBJECTS.find(x => x.id === o.objectId);
    if (dr) addTask(s, { title: `Наряд: ${obj.name}, ${o.when}`, toRole: 'driver', driverId: dr.id, unitId: o.fit, from: whoFrom(role), note: `Заказчик ${o.client}. Выезд к 08:00.` });
    addLog(s, role, `Назначил(а) ${o.what.toLowerCase()} на ${obj.name}`);
  }, 'Машина назначена — водитель получил наряд в телефоне');

  const resolve = p => update(s => {
    const free = s.units.find(u => u.id !== p.unitId && !busyDaysIn(s, u.id).has(p.from) && !busyDaysIn(s, u.id).has(p.from + 1) && u.status !== 'repair');
    const x = s.plan.find(y => y.id === p.id);
    if (free) { x.unitId = free.id; x.conflict = false; addLog(s, role, 'Разрешил(а) накладку: перенос на ' + free.name + ' ' + free.plate); }
  }, 'Накладка разрешена — заявка перенесена на свободную машину');

  return (
    <>
      <PageHead eyebrow="Какая машина где работает — на неделю вперёд" title="Планировщик · 15–21 октября" />
      <div className="grid-kpi">
        <Stat label="Загрузка парка" value={load + '%'} hint="на эту неделю" />
        <Stat label="Свободно завтра" value={String(freeTomorrow.length)} hint={freeTomorrow.map(u => u.name).join(', ') || 'нет'} />
        <Stat label="Накладки" value={String(conflicts.length)} tone="bad" delta={conflicts.length ? '!' : ''} hint="две заявки на одну машину" />
        <Stat label="Заявки без техники" value={String(state.orders.length)} tone="bad" delta={state.orders.length ? '!' : ''} hint="нужно назначить" />
      </div>

      <div className="split">
        <section className="card main" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '200px repeat(7, minmax(0,1fr))', background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink-muted)', fontWeight: 500 }}>
              <span style={{ padding: '10px 16px' }}>Техника</span>
              {WEEK.map((d, i) => <span key={d} style={{ padding: '10px 6px', textAlign: 'center', color: i === 2 || i === 3 ? 'var(--danger)' : undefined }}>{d}</span>)}
            </div>
            {state.units.map(u => {
              const dr = DRIVERS.find(d => d.unitId === u.id);
              const bars = state.plan.filter(p => p.unitId === u.id);
              return (
                <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '200px minmax(0,1fr)', borderTop: '1px solid var(--line)', alignItems: 'center' }}>
                  <span style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column' }}>
                    <b style={{ fontWeight: 600, fontSize: 14 }}>{u.name}</b>
                    <span className="subtle" style={{ fontSize: 12 }}>{u.plate} · {dr ? dr.name.split(' ')[0] : 'без водителя'}</span>
                    {u.status === 'repair' && <span style={{ marginTop: 4 }}><Badge tone="warning">В ремонте сегодня</Badge></span>}
                  </span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gridAutoRows: 'minmax(34px, auto)', gap: 4, padding: '8px 8px 8px 0' }}>
                    {bars.map((b, i) => {
                      const obj = OBJECTS.find(o => o.id === b.objectId);
                      return (
                        <span key={b.id} title={obj.name} className={b.conflict ? '' : CELL[obj.cell]} style={{ gridColumn: `${b.from} / span ${b.span}`, gridRow: b.conflict ? 2 : 1, borderRadius: 8, padding: '0 10px', display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...(b.conflict ? { background: 'var(--danger-soft)', color: 'var(--danger)', boxShadow: 'inset 0 0 0 1px var(--danger)' } : {}) }}>
                          {b.conflict ? 'Накладка: ' + obj.name : obj.name}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="side" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {conflicts.map(p => {
            const u = state.units.find(x => x.id === p.unitId);
            return (
              <div key={p.id} className="card card-pad" style={{ borderColor: 'var(--danger)' }}>
                <Badge tone="danger">Накладка</Badge>
                <b style={{ fontWeight: 600 }}>{u.name} {u.plate} стоит на двух объектах {WEEK[p.from - 1]}–{WEEK[p.from + p.span - 2]}</b>
                {can ? <Button variant="primary" size="sm" onClick={() => resolve(p)}>Перенести на свободную машину</Button> : <span className="subtle" style={{ fontSize: 13 }}>Решает диспетчер или владелец.</span>}
              </div>
            );
          })}
          <h2 className="h2">Заявки без техники</h2>
          {state.orders.length === 0 && <p className="muted" style={{ margin: 0 }}>Все заявки распределены.</p>}
          {state.orders.map(o => {
            const { u, clash } = fits(o);
            return (
              <article key={o.id} className="card card-pad" style={{ gap: 8 }}>
                <span className="muted" style={{ fontSize: 13 }}>{o.client}</span>
                <b style={{ fontWeight: 600 }}>{o.what}</b>
                <span style={{ fontSize: 13 }}>{o.when} · {OBJECTS.find(x => x.id === o.objectId).name}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: clash ? 'var(--warning)' : 'var(--success)' }}>{clash ? 'Подходит ' : 'Свободна: '}{u.name} {u.plate}{clash ? ', но частично занята' : ''}</span>
                {can && <Button size="sm" variant="primary" onClick={() => assign(o)}>Назначить {u.name}</Button>}
              </article>
            );
          })}
          <span className="subtle" style={{ fontSize: 12 }}>Назначенная заявка сразу приходит водителю нарядом в телефон.</span>
        </aside>
      </div>

      <div className="legend">
        {OBJECTS.map(o => <span key={o.id}><i className={'sw cell-' + o.cell} />{o.name}</span>)}
        <span><i className="sw" style={{ background: 'var(--danger-soft)', boxShadow: 'inset 0 0 0 1px var(--danger)' }} />Накладка</span>
      </div>
    </>
  );
}

function busyDaysIn(s, u) { const d = new Set(); s.plan.filter(p => p.unitId === u && !p.conflict).forEach(p => { for (let i = p.from; i < p.from + p.span; i++) d.add(i); }); return d; }
function whoFrom(role) { return role === 'owner' ? 'Петров И., владелец' : 'Орлова Т., диспетчер'; }
