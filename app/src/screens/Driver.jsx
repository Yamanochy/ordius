// Главная водителя и «Деньги»: сколько заработал, что выплачено, вахта, объявления, задачи.
import React, { useState } from 'react';
import { pb, errText } from '../lib/pb.js';
import { useSession } from '../lib/session.jsx';
import { useQuery } from '../lib/data.js';
import { Link } from '../lib/router.jsx';
import {
  rub, monthRange, monthPrep, monthName, dayLabel, shortDay, isoDay, day10, addDays, plural, SHIFT_STATUS, PAYOUT_KINDS, ADJ_KINDS,
  PAY_METHODS, ROTATION_STATUS, TASK_STATUS,
} from '../lib/format.js';
import { Button, Badge, Icon, Loading, ErrorBox, PageTitle, Sheet, useToast } from '../ui.jsx';

const f = (expr, params) => pb.filter(expr, params);

export function usePayroll(companyId, membershipId, range) {
  return useQuery(`payroll:${companyId}:${membershipId}:${range.from}`, async () => {
    const r = await pb.send('/api/ordius/payroll', { query: { company: companyId, from: range.from, to: range.to, member: membershipId } });
    const row = (r.rows || []).find((x) => x.member === membershipId) || (r.rows || [])[0] || null;
    return row && { ...row, basis: r.basis };
  }, { deps: [range.to] });
}

export function MoneyCard({ row, range, onDetails }) {
  if (!row) return null;
  const paidPct = row.accrued_kop > 0 ? Math.min(100, Math.round(row.paid_kop / row.accrued_kop * 100)) : 0;
  return (
    <section className="money-card" aria-label="Заработок за месяц">
      <div className="stack" style={{ gap: 4 }}>
        <span className="lbl">Заработано в {monthPrep(range.from)} · на руки</span>
        <span className="big">{rub(row.accrued_kop)}</span>
        <span className="sub">
          {row.shifts_confirmed} {plural(row.shifts_confirmed, 'смена подтверждена', 'смены подтверждены', 'смен подтверждено')}
          {row.shifts_pending ? ` · ещё ${row.shifts_pending} на проверке` : ''}
          {row.per_diem_days ? ` · ${row.per_diem_days} ${plural(row.per_diem_days, 'день', 'дня', 'дней')} вахты` : ''}
        </span>
      </div>
      {row.accrued_kop > 0 && (
        <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,.14)' }} aria-hidden="true">
          <i style={{ width: paidPct + '%', background: '#B9C0CC' }} /><i style={{ flex: 1, background: '#5B8CFF' }} />
        </div>
      )}
      <div className="kv">
        <span>Уже выплачено<b>{rub(row.paid_kop)}</b></span>
        <span>Осталось получить<b>{rub(row.due_kop)}</b></span>
      </div>
      {onDetails && <button type="button" className="btn sm" style={{ alignSelf: 'flex-start', background: 'transparent', color: 'var(--on-graphite)', borderColor: 'rgba(243,244,246,.3)' }} onClick={onDetails}>Подробнее</button>}
    </section>
  );
}

export function DriverHome({ outbox }) {
  const s = useSession();
  const range = monthRange();
  const me = s.membership.id;
  const pay = usePayroll(s.companyId, me, range);
  const today = isoDay();
  const rejected = useQuery(`rejected:${me}`, () => pb.collection('shifts').getFullList({ filter: f('member = {:m} && status = "rejected"', { m: me }), sort: '-date' }));
  const rot = useQuery(`rotations:${me}`, () => pb.collection('rotations').getFullList({
    filter: f('member = {:m} && status != "cancelled" && date_to >= {:t}', { m: me, t: today + ' 00:00:00.000Z' }), sort: 'date_from', expand: 'site',
  }));
  const posts = useQuery(`posts:${s.companyId}`, () => pb.collection('posts').getList(1, 10, {
    filter: f('company = {:c} && (until = "" || until >= {:t})', { c: s.companyId, t: today + ' 00:00:00.000Z' }), sort: '-pinned,-created',
  }).then((r) => r.items));
  const tasks = useQuery(`mytasks:${me}`, () => pb.collection('tasks').getFullList({
    filter: f('company = {:c} && status != "done" && status != "cancelled" && (assignee = {:m} || created_by = {:u})', { c: s.companyId, m: me, u: s.user.id }), sort: '-created',
  }));
  const cards = useQuery(`mycards:${me}`, () => pb.collection('fuel_cards').getFullList({ filter: f('holder = {:m} && active = true', { m: me }) }));
  const pendingCount = (outbox || []).length;
  const r0 = (rot.data || [])[0];

  return (
    <div className="stack-lg">
      {pay.error && !pay.data ? <ErrorBox text={pay.error} onRetry={pay.reload} /> : !pay.data ? <Loading /> : (
        <MoneyCard row={pay.data} range={range} onDetails={() => { window.location.hash = '/money'; }} />
      )}
      <div className="grid2">
        <Link to="/shift/new" className="btn primary lg"><Icon name="camera" />Смена</Link>
        <Link to="/tasks/new?kind=breakdown" className="btn lg"><Icon name="wrench" />Поломка</Link>
      </div>
      <Link to="/fuel/new" className="btn"><Icon name="fuel" />Заправка</Link>

      {pendingCount > 0 && (
        <Link to="/outbox" className="outbox" style={{ textDecoration: 'none' }}>
          <Icon name="upload" size={20} /><span className="grow">Не отправлено: {pendingCount}. Уйдёт само, когда будет связь</span><Icon name="chevron" size={18} />
        </Link>
      )}

      {(rejected.data || []).length > 0 && (
        <section className="stack">
          <h2 className="h2">Вернули на доработку</h2>
          <div className="list">
            {rejected.data.map((sh) => (
              <Link key={sh.id} to={'/shift/' + sh.id} className="list-item">
                <div className="t"><b>{dayLabel(sh.date)}</b><span className="ellipsis">{sh.reject_reason}</span></div>
                <Badge tone="danger">{SHIFT_STATUS.rejected.label}</Badge>
              </Link>
            ))}
          </div>
        </section>
      )}

      {r0 && (
        <section className="card card-pad">
          <div className="row between">
            <span className="section-label">{day10(r0.date_from) <= today ? 'Вахта' : 'Следующая вахта'}</span>
            <Badge tone={r0.status === 'active' ? 'success' : 'info'}>{ROTATION_STATUS[r0.status]}</Badge>
          </div>
          <b style={{ fontSize: 18 }}>{shortDay(r0.date_from)} — {shortDay(r0.date_to)}</b>
          <span className="muted">{r0.expand && r0.expand.site ? r0.expand.site.name : ''}{r0.note ? ' · ' + r0.note : ''}</span>
        </section>
      )}

      {(cards.data || []).map((c) => <FuelCardBox key={c.id} card={c} />)}

      {(tasks.data || []).length > 0 && (
        <section className="stack">
          <h2 className="h2">Задачи</h2>
          <div className="list">
            {tasks.data.map((t) => (
              <Link key={t.id} to={'/tasks/' + t.id} className="list-item">
                <div className="t"><b>{t.title}</b><span>{t.assignee === me ? 'Поручено вам' : 'Вы поставили'}</span></div>
                <Badge tone={(TASK_STATUS[t.status] || {}).tone}>{(TASK_STATUS[t.status] || {}).label}</Badge>
              </Link>
            ))}
          </div>
        </section>
      )}

      {(posts.data || []).length > 0 && (
        <section className="stack">
          <h2 className="h2">Объявления</h2>
          {posts.data.map((p) => (
            <div key={p.id} className="card card-pad" style={p.pinned ? { borderColor: 'var(--signal)' } : undefined}>
              <p style={{ whiteSpace: 'pre-line' }}>{p.text}</p>
              <span className="small subtle">{dayLabel(p.created)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

export function FuelCardBox({ card }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function show() {
    setBusy(true); setErr('');
    try {
      const r = await pb.send(`/api/ordius/fuel-cards/${card.id}/pin`, {});
      setPin(r.pin);
      setTimeout(() => setPin(''), 30000);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <section className="card card-pad">
      <div className="row between">
        <span className="row"><Icon name="card" /><b>Топливная карта</b></span>
        <span className="small muted">{card.provider}</span>
      </div>
      <span className="num" style={{ fontSize: 18 }}>•••• {String(card.number || '').slice(-4)}</span>
      {card.pin_set && (pin ? (
        <div className="alert info"><span className="grow">ПИН: <b className="num" style={{ fontSize: 22, letterSpacing: '.2em' }}>{pin}</b></span><span className="small">скроется через 30 с</span></div>
      ) : (
        <Button size="sm" busy={busy} onClick={show} style={{ alignSelf: 'flex-start' }}><Icon name="eye" size={18} />Показать ПИН</Button>
      ))}
      {err && <span className="small" style={{ color: 'var(--danger)' }}>{err}</span>}
    </section>
  );
}

// ---------- деньги: ведомость человека, выплаты, премии и удержания ----------
export function Money() {
  const s = useSession();
  const toast = useToast();
  const [range, setRange] = useState(() => monthRange());
  const me = s.membership.id;
  const pay = usePayroll(s.companyId, me, range);
  const payouts = useQuery(`payouts:${me}:${range.from}`, () => pb.collection('payouts').getFullList({
    filter: f('member = {:m} && ((period_from != "" && period_from <= {:to} && period_to >= {:from}) || (period_from = "" && paid_on >= {:from} && paid_on <= {:to}))',
      { m: me, from: range.from + ' 00:00:00.000Z', to: range.to + ' 23:59:59.999Z' }), sort: '-paid_on',
  }), { deps: [range.to] });
  const adj = useQuery(`adj:${me}:${range.from}`, () => pb.collection('adjustments').getFullList({
    filter: f('member = {:m} && date >= {:from} && date <= {:to}', { m: me, from: range.from + ' 00:00:00.000Z', to: range.to + ' 23:59:59.999Z' }), sort: '-date',
  }), { deps: [range.to] });
  const [busy, setBusy] = useState('');
  const row = pay.data;
  const shiftMonth = (n) => setRange(monthRange(addDays(n > 0 ? range.to : range.from, n)));

  async function confirmPayout(p) {
    setBusy(p.id);
    try { await pb.collection('payouts').update(p.id, { member_confirmed: true }); toast('Отмечено: деньги получены'); payouts.reload(); }
    catch (e) { toast(errText(e), { err: true }); } finally { setBusy(''); }
  }

  const lines = row ? [
    ['По сменам', row.earned_kop], ['Оклад', row.salary_kop], ['Премии', row.bonuses_kop],
    [`Суточные${row.per_diem_days ? ` (${row.per_diem_days} ${plural(row.per_diem_days, 'день', 'дня', 'дней')})` : ''}`, row.per_diem_kop],
    ['Дорога', row.travel_kop], ...(row.basis === 'gross' ? [['НДФЛ', -row.ndfl_kop]] : []), ['Удержания', -row.deductions_kop],
  ].filter(([, v]) => v) : [];

  return (
    <div className="stack-lg">
      <PageTitle title="Деньги" eyebrow={monthName(range.from) + ' ' + range.from.slice(0, 4)}>
        <button type="button" className="btn sm" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц"><Icon name="left" size={18} /></button>
        <button type="button" className="btn sm" onClick={() => shiftMonth(1)} aria-label="Следующий месяц"><Icon name="chevron" size={18} /></button>
      </PageTitle>
      <ErrorBox text={pay.error} onRetry={pay.reload} />
      {!row ? <Loading /> : <MoneyCard row={row} range={range} />}
      {row && (
        <section className="list">
          {lines.map(([label, v]) => (
            <div key={label} className="list-item" style={{ cursor: 'default' }}>
              <div className="t"><b style={{ fontWeight: 500 }}>{label}</b></div><span className="num">{v < 0 ? '−' + rub(-v) : rub(v)}</span>
            </div>
          ))}
          <div className="list-item" style={{ cursor: 'default' }}><div className="t"><b>На руки</b></div><b className="num">{rub(row.accrued_kop)}</b></div>
        </section>
      )}
      {(adj.data || []).length > 0 && (
        <section className="stack">
          <h2 className="h2">Премии и удержания</h2>
          <div className="list">
            {adj.data.map((a) => (
              <div key={a.id} className="list-item" style={{ cursor: 'default' }}>
                <div className="t"><b>{ADJ_KINDS[a.kind]}</b><span>{dayLabel(a.date)}{a.note ? ' · ' + a.note : ''}</span></div>
                <span className={'num ' + (a.amount_kop < 0 ? 'bad' : '')}>{a.amount_kop < 0 ? '−' + rub(-a.amount_kop) : '+' + rub(a.amount_kop)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="stack">
        <h2 className="h2">Выплаты</h2>
        <div className="list">
          {(payouts.data || []).length === 0 && <div className="list-empty">Выплат за этот месяц пока нет</div>}
          {(payouts.data || []).map((p) => (
            <div key={p.id} className="list-item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
              <div className="t">
                <b>{PAYOUT_KINDS[p.kind]} · {rub(p.amount_kop)}</b>
                <span>{p.status === 'paid' ? `${dayLabel(p.paid_on)}${p.method ? ' · ' + PAY_METHODS[p.method] : ''}${p.issued_by ? ' · выдал ' + p.issued_by : ''}` : 'Запланирована'}</span>
              </div>
              {p.status === 'paid' && (p.member_confirmed
                ? <Badge tone="success">Получено</Badge>
                : <Button size="sm" variant="primary" busy={busy === p.id} onClick={() => confirmPayout(p)}>Получил</Button>)}
            </div>
          ))}
        </div>
        <p className="note">«Получил» — ваше подтверждение, что деньги на руках. Так не бывает споров про авансы.</p>
      </section>
    </div>
  );
}
