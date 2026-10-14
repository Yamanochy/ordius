import React from 'react';
import { useStore, payroll, objectsEconomy, fmt } from '../store.jsx';
import { DAYS } from '../data.js';
import { PageHead, Stat, Table, Badge, Button, Icon } from '../ui.jsx';

export default function Overview({ role, go }) {
  const { state } = useStore();
  const pay = payroll(state);
  const econ = objectsEconomy(state);
  const fund = pay.reduce((a, p) => a + p.earned, 0);
  const toPay = pay.filter(p => !p.paid).reduce((a, p) => a + Math.max(p.left, 0), 0);
  const confirmed = state.shifts.filter(s => s.status === 'confirmed');
  const pending = state.shifts.filter(s => s.status === 'pending');
  const inRepair = state.units.filter(u => u.status === 'repair');
  const awaitAccept = state.tasks.filter(t => t.kind === 'repair' && t.status === 'done');
  const approvals = state.tasks.filter(t => t.status === 'approve');
  const margin = econ.reduce((a, o) => a + o.margin, 0);
  const revenue = econ.reduce((a, o) => a + o.revenue, 0);

  const perDay = DAYS.map(d => ({ d, n: confirmed.filter(s => s.date === d).length, p: pending.filter(s => s.date === d).length }));
  const max = Math.max(...perDay.map(x => x.n + x.p), 1);

  const attention = [
    pending.length > 0 && { icon: 'clock', color: 'var(--warning)', title: `${pending.length} ${plural(pending.length, 'смена ждёт', 'смены ждут', 'смен ждут')} подтверждения`, text: 'Отмечены водителями с телефона', to: 'tabel' },
    approvals.length > 0 && { icon: 'wallet', color: 'var(--warning)', title: `Согласовать закупку: ${fmt(approvals[0].price)}`, text: approvals[0].title, to: 'tasks' },
    awaitAccept.length > 0 && { icon: 'check', color: 'var(--signal-text)', title: `${awaitAccept.length} ${plural(awaitAccept.length, 'ремонт ждёт', 'ремонта ждут', 'ремонтов ждут')} приёмки`, text: awaitAccept.map(t => unitName(state, t.unitId)).join(', '), to: 'tasks' },
    inRepair.length > 0 && { icon: 'wrench', color: 'var(--danger)', title: `${inRepair.length} ${plural(inRepair.length, 'машина', 'машины', 'машин')} в ремонте`, text: inRepair.map(u => u.name + ' ' + u.plate).join(', '), to: 'fleet' }
  ].filter(Boolean);

  return (
    <>
      <PageHead eyebrow="Добрый день, Игорь Петрович" title="Октябрь 2026 · 1–14 число">
        <Button onClick={() => go(role, 'tabel')}>Открыть табель</Button>
        <Button variant="primary" onClick={() => go('driver', 'driver')}>Как это видит водитель</Button>
      </PageHead>

      <div className="grid-kpi">
        <Stat label="Фонд зарплаты" value={fmt(fund)} hint={`${confirmed.length} подтверждённых смен`} />
        <Stat label="К выплате" value={fmt(toPay)} hint="после авансов, не выплачено" />
        <Stat label="Маржа по объектам" value={fmt(margin)} delta={(revenue ? (margin / revenue * 100) : 0).toFixed(1).replace('.', ',') + '%'} tone={margin < 0 ? 'bad' : 'good'} hint="от выручки" />
        <Stat label="Техника в ремонте" value={String(inRepair.length)} tone="bad" delta={inRepair.length ? '!' : ''} hint={`из ${state.units.length} единиц`} />
      </div>

      <div className="split">
        <section className="card card-pad main">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Смены по дням</h2>
            <span className="legend"><span><i className="sw" style={{ background: 'var(--signal)' }} />подтверждены</span><span><i className="sw" style={{ background: 'var(--warning-soft)', boxShadow: 'inset 0 0 0 1px var(--warning)' }} />ждут</span></span>
          </div>
          <div className="chart" role="img" aria-label={`Смены по дням с 1 по 14 октября, всего ${confirmed.length} подтверждённых`}>
            {perDay.map(x => (
              <div key={x.d}>
                <span className="num subtle" style={{ fontSize: 11, textAlign: 'center' }}>{x.n + x.p || ''}</span>
                {x.p > 0 && <i style={{ height: x.p / max * 150, background: 'var(--warning-soft)', boxShadow: 'inset 0 0 0 1px var(--warning)', borderRadius: '4px 4px 0 0', display: 'block' }} />}
                <i style={{ height: x.n / max * 150, background: 'var(--signal)', borderRadius: x.p ? 0 : '4px 4px 0 0', display: 'block' }} />
              </div>
            ))}
          </div>
          <div className="chart" style={{ height: 'auto', border: 0 }}>
            {perDay.map(x => <span key={x.d} className="subtle" style={{ fontSize: 12, textAlign: 'center' }}>{Number(x.d.slice(8))}</span>)}
          </div>
        </section>

        <section className="card side" style={{ overflow: 'hidden' }}>
          <h2 className="h2" style={{ padding: '20px 20px 8px' }}>Требует внимания</h2>
          {attention.length === 0 && <p className="muted" style={{ padding: '0 20px 20px' }}>Всё в порядке — ничего не ждёт вашего решения.</p>}
          {attention.map((a, i) => (
            <button key={i} type="button" className="list-item" onClick={() => go(role, a.to)}>
              <Icon name={a.icon} color={a.color} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <b style={{ fontWeight: 600 }}>{a.title}</b>
                <span className="muted" style={{ fontSize: 13 }}>{a.text}</span>
              </span>
            </button>
          ))}
        </section>
      </div>

      <Table
        title="Расчёт зарплаты · октябрь"
        actions={<Button size="sm" onClick={() => go(role, 'accounting')}>В бухгалтерию</Button>}
        columns={[
          { key: 'name', label: 'Водитель' },
          { key: 'shifts', label: 'Смен', right: true },
          { key: 'earned', label: 'Начислено', money: true },
          { key: 'advance', label: 'Аванс', money: true },
          { key: 'left', label: 'К выплате', money: true },
          { key: 'status', label: 'Статус', render: (v, r) => r.paid ? <Badge tone="success">Выплачено</Badge> : r.left < 0 ? <Badge tone="danger">Долг</Badge> : <Badge tone="warning">Не выплачено</Badge> }
        ]}
        rows={pay.map(p => ({ id: p.driver.id, name: p.driver.name, shifts: p.shifts + (p.pendingCount ? ` +${p.pendingCount}` : ''), earned: p.earned, advance: p.advance, left: p.left, paid: p.paid }))}
        total={{ earned: fund, advance: pay.reduce((a, p) => a + p.advance, 0), left: pay.reduce((a, p) => a + p.left, 0) }}
      />
      <p className="subtle" style={{ fontSize: 12, margin: 0 }}>«+1» в колонке смен — смена отмечена водителем, но ещё не подтверждена. В начисление она попадёт после подтверждения.</p>
    </>
  );
}

export function unitName(state, id) { const u = state.units.find(x => x.id === id); return u ? u.name + ' ' + u.plate : ''; }
export function plural(n, one, few, many) { const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return one; if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few; return many; }
