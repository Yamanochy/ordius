import React from 'react';
import { useStore, payroll, fmt, nowLabel } from '../store.jsx';
import { PageHead, Stat, Table, Badge, Button } from '../ui.jsx';

const BILL_ST = { paid: ['Оплачено', 'success'], topay: ['К оплате', 'warning'], refund: ['К возмещению', 'info'] };

export default function Accounting({ role }) {
  const { state, update } = useStore();
  const pay = payroll(state);
  const can = role === 'accountant' || role === 'owner';
  const who = role === 'owner' ? 'Петров И.' : 'Савельева Н.';
  const salaryLeft = pay.filter(p => !p.paid).reduce((a, p) => a + Math.max(p.left, 0), 0);
  const billsOpen = state.bills.filter(b => b.status === 'topay');
  const refunds = state.bills.filter(b => b.status === 'refund');

  const payDriver = p => update(s => { s.paid[p.driver.id] = true; s.log.unshift({ t: nowLabel().slice(6), who, what: `Выплата ${p.driver.name}: ${fmt(p.left)}` }); }, `${p.driver.name}: выплачено — водитель увидит это в телефоне`);
  const payBill = b => update(s => { s.bills.find(x => x.id === b.id).status = 'paid'; s.log.unshift({ t: nowLabel().slice(6), who, what: `Оплачено: ${b.who}, ${fmt(b.sum)}` }); }, 'Отмечено как оплачено');

  return (
    <>
      <PageHead eyebrow="Всё, что нужно оплатить, возместить и выгрузить" title="Бухгалтерия · октябрь 2026">
        <Button onClick={() => window.alert('В рабочей версии здесь скачивается оформленная ведомость в Excel.')}>Ведомость (Excel)</Button>
      </PageHead>
      <div className="grid-kpi">
        <Stat label="Зарплата к выплате" value={fmt(salaryLeft)} hint="после авансов" />
        <Stat label="Счета к оплате" value={fmt(billsOpen.reduce((a, b) => a + b.sum, 0))} hint={`${billsOpen.length} счёта поставщиков`} />
        <Stat label="Подотчёт к возмещению" value={fmt(refunds.reduce((a, b) => a + b.sum, 0))} hint="чеки механика" />
      </div>

      <Table
        title="Зарплата водителей · 1–14 октября"
        columns={[
          { key: 'name', label: 'Водитель' },
          { key: 'shifts', label: 'Смен', right: true },
          { key: 'earned', label: 'Начислено', money: true },
          { key: 'advance', label: 'Аванс', money: true },
          { key: 'left', label: 'К выплате', money: true },
          { key: 'act', label: '', render: (v, r) => r.paid ? <Badge tone="success">Выплачено</Badge> : r.left <= 0 ? <Badge tone="danger">Долг {fmt(-r.left)}</Badge> : can ? <Button size="sm" variant="primary" onClick={() => payDriver(r.p)}>Выплатить</Button> : <Badge tone="warning">Не выплачено</Badge> }
        ]}
        rows={pay.map(p => ({ id: p.driver.id, name: p.driver.name, shifts: p.shifts, earned: p.earned, advance: p.advance, left: p.left, paid: p.paid, p }))}
        total={{ earned: pay.reduce((a, p) => a + p.earned, 0), advance: pay.reduce((a, p) => a + p.advance, 0), left: pay.reduce((a, p) => a + p.left, 0) }}
      />

      <Table
        title="Счета и подотчёт"
        columns={[
          { key: 'who', label: 'Кому · основание', render: (v, r) => <span style={{ display: 'flex', flexDirection: 'column' }}><b style={{ fontWeight: 600 }}>{v}</b><span className="subtle" style={{ fontSize: 12 }}>{r.basis}</span></span> },
          { key: 'kind', label: 'Вид' },
          { key: 'link', label: 'Привязка' },
          { key: 'sum', label: 'Сумма', money: true },
          { key: 'status', label: 'Статус', render: (v, r) => v === 'paid' ? <Badge tone="success">Оплачено</Badge> : can ? <Button size="sm" variant="primary" onClick={() => payBill(r)}>{v === 'refund' ? 'Возместить' : 'Оплатить'}</Button> : <Badge tone={BILL_ST[v][1]}>{BILL_ST[v][0]}</Badge> }
        ]}
        rows={state.bills}
      />

      <section className="card card-pad">
        <h2>Журнал действий</h2>
        {state.log.slice(0, 8).map((l, i) => (
          <div key={i} className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, gap: 14 }}>
            <span className="num subtle" style={{ fontSize: 13, width: 44 }}>{l.t}</span>
            <b style={{ fontWeight: 600, fontSize: 14 }}>{l.who}</b>
            <span className="muted" style={{ fontSize: 14 }}>{l.what}</span>
          </div>
        ))}
      </section>
    </>
  );
}
