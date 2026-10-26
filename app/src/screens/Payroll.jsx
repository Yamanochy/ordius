// Ведомость за период (на руки и с НДФЛ, CSV для бухгалтерии), выплаты, премии и удержания.
import React, { useState } from 'react';
import { pb, errText } from '../lib/pb.js';
import { useSession } from '../lib/session.jsx';
import { useQuery } from '../lib/data.js';
import { useRefs } from '../lib/refs.js';
import {
  rub, monthRange, monthName, addDays, shortDay, dayLabel, toKop, pbDate, isoDay, PAYOUT_KINDS, PAY_METHODS, ADJ_KINDS, plural,
} from '../lib/format.js';
import { Button, Badge, Field, Select, Icon, PageTitle, ErrorBox, Loading, Sheet, Seg, useToast } from '../ui.jsx';

const f = (expr, params) => pb.filter(expr, params);

// Период: месяц стрелками, произвольные даты — по нажатию на название
function PeriodPicker({ range, setRange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(range);
  const shift = (n) => setRange(monthRange(addDays(n > 0 ? range.to : range.from, n)));
  const whole = range.from.slice(8) === '01' && range.to === monthRange(range.from).to;
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <button type="button" className="btn sm" onClick={() => shift(-1)} aria-label="Предыдущий месяц"><Icon name="left" size={18} /></button>
      <button type="button" className="btn sm" style={{ minWidth: 150 }} onClick={() => { setDraft(range); setOpen(true); }}>
        {whole ? monthName(range.from) + ' ' + range.from.slice(0, 4) : `${shortDay(range.from)} — ${shortDay(range.to)}`}
      </button>
      <button type="button" className="btn sm" onClick={() => shift(1)} aria-label="Следующий месяц"><Icon name="chevron" size={18} /></button>
      {open && (
        <Sheet title="Период" onClose={() => setOpen(false)}>
          <div className="field-row">
            <Field label="С"><input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></Field>
            <Field label="По"><input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></Field>
          </div>
          <Button variant="primary" block disabled={!draft.from || !draft.to || draft.from > draft.to} onClick={() => { setRange(draft); setOpen(false); }}>Показать</Button>
        </Sheet>
      )}
    </div>
  );
}

async function download(path, query, name) {
  const qs = new URLSearchParams({ ...query, format: 'csv' }).toString();
  const r = await fetch(pb.buildURL(path) + '?' + qs, { headers: { Authorization: pb.authStore.token } });
  if (!r.ok) throw new Error('Не удалось выгрузить');
  const b = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

export function Payroll() {
  const s = useSession();
  const toast = useToast();
  const [range, setRange] = useState(() => monthRange());
  const q = useQuery(s.isMoney && `payroll:${s.companyId}:${range.from}:${range.to}`, () => pb.send('/api/ordius/payroll', { query: { company: s.companyId, from: range.from, to: range.to } }), { deps: [range.from, range.to] });
  const [view, setView] = useState('net');
  const [person, setPerson] = useState(null);
  const [pay, setPay] = useState(null);
  if (!s.isMoney) return <ErrorBox text="Ведомость видят владелец, руководитель и бухгалтер" />;
  const rows = ((q.data && q.data.rows) || []).filter((r) => r.accrued_kop || r.paid_kop || r.shifts_confirmed || r.shifts_pending || r.gross_kop);
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const cols = view === 'net'
    ? [['earned_kop', 'По сменам'], ['salary_kop', 'Оклад'], ['bonuses_kop', 'Премии'], ['per_diem_kop', 'Суточные'], ['travel_kop', 'Дорога'], ['deductions_kop', 'Удержания'], ['accrued_kop', 'На руки'], ['paid_kop', 'Выплачено'], ['due_kop', 'К выплате']]
    : [['gross_kop', 'Начислено'], ['ndfl_kop', 'НДФЛ'], ['deductions_kop', 'Удержания'], ['accrued_kop', 'На руки'], ['paid_kop', 'Выплачено'], ['due_kop', 'К выплате']];
  return (
    <div className="stack-lg">
      <PageTitle title="Ведомость">
        <Button onClick={() => download('/api/ordius/payroll', { company: s.companyId, from: range.from, to: range.to }, `vedomost-${range.from}_${range.to}.csv`).catch((e) => toast(e.message, { err: true }))}>
          <Icon name="download" size={20} />CSV для бухгалтерии
        </Button>
      </PageTitle>
      <div className="row between">
        <PeriodPicker range={range} setRange={setRange} />
        <Seg value={view} onChange={setView} label="Вид" options={[{ value: 'net', label: 'На руки' }, { value: 'gross', label: 'С НДФЛ' }]} />
      </div>
      {q.data && <p className="note">Ставки внесены {q.data.basis === 'gross' ? 'до НДФЛ — налог удерживается' : '«на руки» — НДФЛ считается сверху'}. Меняется в «Ещё → Компания».</p>}
      <ErrorBox text={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : (
        <>
          <section className="list only-narrow">
            {rows.length === 0 && <div className="list-empty">За период начислений нет</div>}
            {rows.map((r) => (
              <button key={r.member} type="button" className="list-item" onClick={() => setPerson(r)}>
                <div className="t">
                  <b>{r.display_name}</b>
                  <span>{r.shifts_confirmed} {plural(r.shifts_confirmed, 'смена', 'смены', 'смен')}{r.shifts_pending ? ` · ещё ${r.shifts_pending} на проверке` : ''}{view === 'gross' && r.ndfl_kop ? ` · НДФЛ ${rub(r.ndfl_kop)}` : ''}</span>
                </div>
                <div className="r">
                  <span className="num">{rub(view === 'gross' ? r.gross_kop : r.accrued_kop)}</span>
                  <span className={'small num ' + (r.due_kop > 0 ? 'warn' : 'subtle')}>{r.due_kop > 0 ? 'к выплате ' + rub(r.due_kop) : 'выплачено'}</span>
                </div>
              </button>
            ))}
            {rows.length > 0 && (
              <div className="list-item" style={{ cursor: 'default' }}>
                <div className="t"><b>Итого</b><span>к выплате {rub(sum('due_kop'))}</span></div>
                <b className="num">{rub(sum(view === 'gross' ? 'gross_kop' : 'accrued_kop'))}</b>
              </div>
            )}
          </section>
          <section className="card only-wide" style={{ overflow: 'hidden' }}>
            <div className="table-scroll">
              <table className="t">
                <thead><tr><th>Сотрудник</th><th className="r">Смен</th>{cols.map(([k, l]) => <th key={k} className="r">{l}</th>)}</tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={cols.length + 2} className="subtle">За период начислений нет</td></tr>}
                  {rows.map((r) => (
                    <tr key={r.member} onClick={() => setPerson(r)} style={{ cursor: 'pointer' }}>
                      <td>{r.display_name}{r.shifts_pending ? <span className="small warn"> · ещё {r.shifts_pending} на проверке</span> : null}</td>
                      <td className="r">{r.shifts_confirmed}</td>
                      {cols.map(([k]) => <td key={k} className="r">{r[k] ? (k === 'deductions_kop' || k === 'ndfl_kop' ? '−' : '') + rub(r[k]) : '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot><tr><td>Итого</td><td className="r">{sum('shifts_confirmed')}</td>{cols.map(([k]) => <td key={k} className="r">{rub(sum(k))}</td>)}</tr></tfoot>
                )}
              </table>
            </div>
          </section>
        </>
      )}
      {person && (
        <Sheet title={person.display_name} onClose={() => setPerson(null)}>
          <div className="list">
            {[['Смены', person.earned_kop, `${person.shifts_confirmed} ${plural(person.shifts_confirmed, 'смена', 'смены', 'смен')}`], ['Оклад', person.salary_kop], ['Премии', person.bonuses_kop],
              ['Суточные', person.per_diem_kop, person.per_diem_days ? `${person.per_diem_days} дн.` : ''], ['Дорога', person.travel_kop], ['Начислено до НДФЛ', person.gross_kop],
              ['НДФЛ', -person.ndfl_kop, person.no_ndfl ? 'не удерживается' : ''], ['Удержания', -person.deductions_kop], ['На руки', person.accrued_kop], ['Выплачено', person.paid_kop], ['К выплате', person.due_kop]]
              .filter(([, v, sub]) => v || sub).map(([l, v, sub]) => (
                <div key={l} className="list-item" style={{ cursor: 'default', minHeight: 44, padding: '10px 14px' }}>
                  <div className="t"><b style={{ fontWeight: l === 'К выплате' || l === 'На руки' ? 600 : 500 }}>{l}</b>{sub && <span>{sub}</span>}</div>
                  <span className="num">{v < 0 ? '−' + rub(-v) : rub(v)}</span>
                </div>
              ))}
          </div>
          {person.per_diem_missing_days > 0 && <div className="alert warning small"><Icon name="alert" size={18} /><span>{person.per_diem_missing_days} дн. вахты без ставки суточных — добавьте ставку «Суточные»</span></div>}
          {s.isMgmt && person.due_kop > 0 && <Button variant="primary" block onClick={() => { setPay({ member: person.member, amount: String(person.due_kop / 100).replace('.', ','), kind: 'salary', from: range.from, to: range.to }); setPerson(null); }}>Выплатить {rub(person.due_kop)}</Button>}
        </Sheet>
      )}
      {pay && <PayoutSheet initial={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); q.reload(); toast('Выплата записана'); }} />}
    </div>
  );
}

export function Payouts() {
  const s = useSession();
  const toast = useToast();
  const refs = useRefs(s.companyId);
  const [range, setRange] = useState(() => monthRange());
  const [tab, setTab] = useState('payouts');
  const [sheet, setSheet] = useState(null);
  const p = { c: s.companyId, from: range.from + ' 00:00:00.000Z', to: range.to + ' 23:59:59.999Z' };
  const payouts = useQuery(`allpayouts:${s.companyId}:${range.from}`, () => pb.collection('payouts').getFullList({
    filter: f('company = {:c} && ((paid_on >= {:from} && paid_on <= {:to}) || (status = "planned"))', p), sort: '-paid_on,-created',
  }), { deps: [range.to] });
  const adj = useQuery(`alladj:${s.companyId}:${range.from}`, () => pb.collection('adjustments').getFullList({
    filter: f('company = {:c} && date >= {:from} && date <= {:to}', p), sort: '-date',
  }), { deps: [range.to] });
  const name = (id) => (refs.member[id] || {}).display_name || '…';
  async function markPaid(x) {
    try { await pb.collection('payouts').update(x.id, { status: 'paid', paid_on: x.paid_on || pbDate(isoDay()) }); payouts.reload(); toast('Отмечено как выплачено'); }
    catch (e) { toast(errText(e), { err: true }); }
  }
  return (
    <div className="stack-lg">
      <PageTitle title="Выплаты и удержания" backTo="/more">
        {s.isMgmt && <Button variant="primary" onClick={() => setSheet(tab)}><Icon name="plus" size={20} />{tab === 'payouts' ? 'Выплата' : 'Премия / удержание'}</Button>}
      </PageTitle>
      <div className="row between">
        <PeriodPicker range={range} setRange={setRange} />
        <Seg value={tab} onChange={setTab} label="Раздел" options={[{ value: 'payouts', label: 'Выплаты' }, { value: 'adj', label: 'Премии и удержания' }]} />
      </div>
      {tab === 'payouts' ? (
        <div className="list">
          {(payouts.data || []).length === 0 && <div className="list-empty">Выплат за период нет</div>}
          {(payouts.data || []).map((x) => (
            <div key={x.id} className="list-item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
              <div className="t">
                <b>{name(x.member)} · {PAYOUT_KINDS[x.kind]}</b>
                <span>{x.status === 'paid' ? `${dayLabel(x.paid_on)}${x.method ? ' · ' + PAY_METHODS[x.method] : ''}${x.issued_by ? ' · выдал ' + x.issued_by : ''}` : 'Запланирована'}</span>
              </div>
              <div className="r">
                <span className="num">{rub(x.amount_kop)}</span>
                {x.status === 'planned' ? (s.isMgmt ? <Button size="sm" onClick={() => markPaid(x)}>Выплачено</Button> : <Badge>План</Badge>)
                  : x.member_confirmed ? <Badge tone="success">Получил</Badge> : <Badge>Ждёт «получил»</Badge>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="list">
          {(adj.data || []).length === 0 && <div className="list-empty">Премий и удержаний за период нет</div>}
          {(adj.data || []).map((a) => (
            <div key={a.id} className="list-item" style={{ cursor: 'default' }}>
              <div className="t"><b>{name(a.member)} · {ADJ_KINDS[a.kind]}</b><span>{dayLabel(a.date)}{a.note ? ' · ' + a.note : ''}</span></div>
              <span className={'num ' + (a.amount_kop < 0 ? 'bad' : 'good')}>{a.amount_kop < 0 ? '−' + rub(-a.amount_kop) : '+' + rub(a.amount_kop)}</span>
            </div>
          ))}
        </div>
      )}
      {sheet === 'payouts' && <PayoutSheet initial={{}} onClose={() => setSheet(null)} onDone={() => { setSheet(null); payouts.reload(); toast('Выплата записана'); }} />}
      {sheet === 'adj' && <AdjSheet onClose={() => setSheet(null)} onDone={() => { setSheet(null); adj.reload(); toast('Записано'); }} />}
    </div>
  );
}

function PayoutSheet({ initial, onClose, onDone }) {
  const s = useSession();
  const refs = useRefs(s.companyId);
  const [form, setForm] = useState({ member: initial.member || '', kind: initial.kind || 'advance', amount: initial.amount || '', status: 'paid', paid_on: isoDay(), method: 'card', issued_by: (s.user && s.user.name) || '', from: initial.from || '', to: initial.to || '', note: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((x) => ({ ...x, ...p }));
  async function save() {
    const amount = toKop(form.amount);
    if (!form.member) { setErr('Кому'); return; }
    if (!(amount > 0)) { setErr('Сумма'); return; }
    setBusy(true); setErr('');
    try {
      await pb.collection('payouts').create({ company: s.companyId, member: form.member, kind: form.kind, amount_kop: amount, status: form.status,
        paid_on: form.status === 'paid' ? pbDate(form.paid_on) : '', method: form.method, issued_by: form.issued_by,
        period_from: form.from ? pbDate(form.from) : '', period_to: form.to ? pbDate(form.to) : '', note: form.note });
      onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet title="Выплата" onClose={onClose}>
      <Field label="Кому"><Select value={form.member} onChange={(v) => set({ member: v })} placeholder="Выберите" options={refs.members.filter((m) => m.status === 'active').map((m) => ({ value: m.id, label: m.display_name }))} /></Field>
      <div className="chips">{Object.entries(PAYOUT_KINDS).map(([k, l]) => <button key={k} type="button" className={'chip' + (form.kind === k ? ' on' : '')} onClick={() => set({ kind: k })}>{l}</button>)}</div>
      <div className="field-row">
        <Field label="Сумма, ₽"><input inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
        <Field label="Как"><Select value={form.method} onChange={(v) => set({ method: v })} options={Object.entries(PAY_METHODS).map(([value, label]) => ({ value, label }))} /></Field>
      </div>
      <Seg value={form.status} onChange={(v) => set({ status: v })} label="Статус" options={[{ value: 'paid', label: 'Выплачено' }, { value: 'planned', label: 'Запланировано' }]} />
      <div className="field-row">
        {form.status === 'paid' && <Field label="Дата"><input type="date" value={form.paid_on} onChange={(e) => set({ paid_on: e.target.value })} /></Field>}
        <Field label="Кто выдал"><input value={form.issued_by} onChange={(e) => set({ issued_by: e.target.value })} /></Field>
      </div>
      <div className="field-row">
        <Field label="За период с" hint="Необязательно"><input type="date" value={form.from} onChange={(e) => set({ from: e.target.value })} /></Field>
        <Field label="по"><input type="date" value={form.to} onChange={(e) => set({ to: e.target.value })} /></Field>
      </div>
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} onClick={save}>Записать</Button>
    </Sheet>
  );
}

function AdjSheet({ onClose, onDone }) {
  const s = useSession();
  const refs = useRefs(s.companyId);
  const [form, setForm] = useState({ member: '', kind: 'bonus', amount: '', date: isoDay(), note: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const plus = form.kind === 'bonus' || form.kind === 'travel';
  async function save() {
    const amount = toKop(form.amount);
    if (!form.member) { setErr('Кому'); return; }
    if (!(amount > 0)) { setErr('Сумма'); return; }
    setBusy(true); setErr('');
    try {
      await pb.collection('adjustments').create({ company: s.companyId, member: form.member, kind: form.kind, amount_kop: plus ? amount : -amount, date: pbDate(form.date), note: form.note });
      onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet title={plus ? 'Начисление' : 'Удержание'} onClose={onClose}>
      <Field label="Кому"><Select value={form.member} onChange={(v) => setForm({ ...form, member: v })} placeholder="Выберите" options={refs.members.filter((m) => m.status === 'active').map((m) => ({ value: m.id, label: m.display_name }))} /></Field>
      <div className="chips">{Object.entries(ADJ_KINDS).map(([k, l]) => <button key={k} type="button" className={'chip' + (form.kind === k ? ' on' : '')} onClick={() => setForm({ ...form, kind: k })}>{l}</button>)}</div>
      <p className="note">{plus ? (form.kind === 'travel' ? 'Компенсация дороги на вахту — плюсом, без НДФЛ.' : 'Премия — плюсом к заработку.') : 'Удержание вычитается из суммы на руки.'}</p>
      <div className="field-row">
        <Field label="Сумма, ₽"><input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
        <Field label="Дата"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
      </div>
      <Field label="За что"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} onClick={save}>Записать</Button>
    </Sheet>
  );
}
