// ТО техники: что просрочено, что скоро; план ТО и журнал выполненного.
import React, { useState } from 'react';
import { pb, errText } from '../lib/pb.js';
import { useSession } from '../lib/session.jsx';
import { useQuery } from '../lib/data.js';
import { useRefs, vehicleLabel } from '../lib/refs.js';
import { Link } from '../lib/router.jsx';
import { qty, rub, toNum, toKop, pbDate, isoDay, day10, shortDay, dayLabel } from '../lib/format.js';
import { Button, Badge, Field, Select, Icon, PageTitle, ErrorBox, Loading, Sheet, Seg, useToast } from '../ui.jsx';

const f = (expr, params) => pb.filter(expr, params);
const ST = { overdue: ['Просрочено', 'danger'], soon: ['Скоро', 'warning'], ok: ['В порядке', 'success'], unknown: ['Нет данных', ''] };
const KIND = { service: 'ТО', repair: 'Ремонт', inspection: 'Осмотр', tires: 'Шины', other: 'Другое' };

function partText(p) {
  if (p.by === 'days') return p.left <= 0 ? `срок прошёл ${shortDay(p.next)}` : `до ${shortDay(p.next)} · ${p.left} дн.`;
  return p.left <= 0 ? `перепробег ${qty(-p.left)} ${p.unit}` : `осталось ${qty(p.left)} ${p.unit}`;
}

export function Maintenance() {
  const s = useSession();
  const toast = useToast();
  const refs = useRefs(s.companyId);
  const canEdit = s.is(['owner', 'manager', 'mechanic']);
  const q = useQuery(`maint:${s.companyId}`, () => pb.send('/api/ordius/maintenance', { query: { company: s.companyId } }));
  const logs = useQuery(`mlogs:${s.companyId}`, () => pb.collection('maintenance_logs').getList(1, 30, { filter: f('company = {:c}', { c: s.companyId }), sort: '-date' }).then((r) => r.items));
  const [tab, setTab] = useState('status');
  const [plan, setPlan] = useState(null);
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = (q.data && q.data.rows) || [];
  async function sync() {
    setBusy(true);
    try { const r = await pb.send('/api/ordius/maintenance/sync', { method: 'POST', body: { company: s.companyId } }); toast(r.created ? `Поставлено задач механику: ${r.created}` : 'Новых задач нет'); q.reload(); }
    catch (e) { toast(errText(e), { err: true }); } finally { setBusy(false); }
  }
  return (
    <div className="stack-lg">
      <PageTitle title="ТО техники">
        {canEdit && <Button onClick={() => setPlan({})}><Icon name="plus" size={20} />План ТО</Button>}
        {canEdit && <Button variant="primary" onClick={() => setLog({ date: isoDay() })}><Icon name="check" size={20} />Сделано</Button>}
      </PageTitle>
      <div className="row between">
        <Seg value={tab} onChange={setTab} label="Раздел" options={[{ value: 'status', label: 'Сроки' }, { value: 'log', label: 'Журнал' }]} />
        {canEdit && tab === 'status' && <Button size="sm" variant="ghost" busy={busy} onClick={sync}><Icon name="refresh" size={18} />Проверить сроки</Button>}
      </div>
      <ErrorBox text={q.error} onRetry={q.reload} />
      {tab === 'status' ? (q.loading && !q.data ? <Loading /> : (
        <div className="list">
          {rows.length === 0 && <div className="list-empty">Планов ТО нет. Добавьте: например, «ТО-1 каждые 10 000 км» — механик получит задачу, когда срок подойдёт</div>}
          {rows.map((r) => (
            <button key={r.plan} type="button" className="list-item" onClick={() => canEdit && setLog({ date: isoDay(), vehicle: r.vehicle, plan: r.plan })}>
              <div className="t">
                <b>{r.vehicle_name} · {r.name}</b>
                <span>{r.parts.map(partText).join(' · ') || 'Укажите интервал и последнее ТО'}</span>
                {r.task && <span><Link to={'/tasks/' + r.task} onClick={(e) => e.stopPropagation()}>Задача механику</Link></span>}
              </div>
              <Badge tone={ST[r.status][1]}>{ST[r.status][0]}</Badge>
            </button>
          ))}
        </div>
      )) : (
        <div className="list">
          {(logs.data || []).length === 0 && <div className="list-empty">Записей нет</div>}
          {(logs.data || []).map((l) => (
            <div key={l.id} className="list-item" style={{ cursor: 'default' }}>
              <div className="t">
                <b>{refs.vehicle[l.vehicle] ? refs.vehicle[l.vehicle].name : ''} · {KIND[l.kind]}</b>
                <span>{dayLabel(l.date)}{l.odometer ? ` · ${qty(l.odometer)} км` : ''}{l.description ? ' · ' + l.description : ''}</span>
              </div>
              {l.cost_kop ? <span className="num">{rub(l.cost_kop)}</span> : null}
            </div>
          ))}
        </div>
      )}
      {plan && <PlanSheet onClose={() => setPlan(null)} onDone={() => { setPlan(null); q.reload(); toast('План ТО сохранён'); }} />}
      {log && <LogSheet initial={log} plans={rows} onClose={() => setLog(null)} onDone={() => { setLog(null); q.reload(); logs.reload(); toast('Записано в журнал ТО'); }} />}
    </div>
  );
}

function PlanSheet({ onClose, onDone }) {
  const s = useSession();
  const refs = useRefs(s.companyId);
  const [form, setForm] = useState({ vehicle: '', name: '', interval_km: '', interval_hours: '', interval_days: '', last_km: '', last_hours: '', last_date: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((x) => ({ ...x, ...p }));
  const v = refs.vehicle[form.vehicle];
  async function save() {
    if (!form.vehicle || !form.name.trim()) { setErr('Машина и что делать'); return; }
    if (!toNum(form.interval_km) && !toNum(form.interval_hours) && !toNum(form.interval_days)) { setErr('Укажите хотя бы один интервал'); return; }
    setBusy(true); setErr('');
    try {
      await pb.collection('maintenance_plans').create({
        company: s.companyId, vehicle: form.vehicle, name: form.name.trim(), active: true,
        interval_km: toNum(form.interval_km) || 0, interval_hours: toNum(form.interval_hours) || 0, interval_days: toNum(form.interval_days) || 0,
        last_km: toNum(form.last_km) || 0, last_hours: toNum(form.last_hours) || 0, last_date: form.last_date ? pbDate(form.last_date) : '',
      });
      await pb.send('/api/ordius/maintenance/sync', { method: 'POST', body: { company: s.companyId } }).catch(() => {});
      onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet title="План ТО" onClose={onClose}>
      <Field label="Машина"><Select value={form.vehicle} onChange={(x) => set({ vehicle: x, last_km: refs.vehicle[x] && refs.vehicle[x].odometer_now ? String(refs.vehicle[x].odometer_now) : form.last_km })} placeholder="Выберите" options={refs.vehicles.filter((x) => x.active !== false).map((x) => ({ value: x.id, label: vehicleLabel(x) }))} /></Field>
      <Field label="Что делать"><input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="ТО-1: масло и фильтры" /></Field>
      <span className="section-label">Как часто (любое из)</span>
      <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <Field label="Каждые, км"><input inputMode="numeric" value={form.interval_km} onChange={(e) => set({ interval_km: e.target.value })} /></Field>
        <Field label="Моточасов"><input inputMode="numeric" value={form.interval_hours} onChange={(e) => set({ interval_hours: e.target.value })} /></Field>
        <Field label="Дней"><input inputMode="numeric" value={form.interval_days} onChange={(e) => set({ interval_days: e.target.value })} /></Field>
      </div>
      <span className="section-label">Когда делали последний раз</span>
      <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <Field label="На пробеге"><input inputMode="numeric" value={form.last_km} onChange={(e) => set({ last_km: e.target.value })} /></Field>
        <Field label="Моточасы"><input inputMode="numeric" value={form.last_hours} onChange={(e) => set({ last_hours: e.target.value })} /></Field>
        <Field label="Дата"><input type="date" value={form.last_date} onChange={(e) => set({ last_date: e.target.value })} /></Field>
      </div>
      {v && v.odometer_now ? <p className="note">Сейчас у машины {qty(v.odometer_now)} км{v.engine_hours_now ? `, ${qty(v.engine_hours_now)} моточ.` : ''}.</p> : null}
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} onClick={save}>Сохранить</Button>
    </Sheet>
  );
}

function LogSheet({ initial, plans, onClose, onDone }) {
  const s = useSession();
  const refs = useRefs(s.companyId);
  const [form, setForm] = useState({ vehicle: initial.vehicle || '', plan: initial.plan || '', date: day10(initial.date) || isoDay(), kind: 'service', description: '', odometer: '', engine_hours: '', cost: '', performer: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((x) => ({ ...x, ...p }));
  const vehPlans = plans.filter((p) => p.vehicle === form.vehicle);
  async function save() {
    if (!form.vehicle) { setErr('Машина'); return; }
    setBusy(true); setErr('');
    try {
      await pb.collection('maintenance_logs').create({
        company: s.companyId, vehicle: form.vehicle, plan: form.plan, date: pbDate(form.date), kind: form.kind, description: form.description,
        odometer: toNum(form.odometer) || 0, engine_hours: toNum(form.engine_hours) || 0, cost_kop: form.cost ? toKop(form.cost) : 0, performer: form.performer,
      });
      onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet title="Сделано" onClose={onClose}>
      <Field label="Машина"><Select value={form.vehicle} onChange={(x) => set({ vehicle: x, plan: '' })} placeholder="Выберите" options={refs.vehicles.map((x) => ({ value: x.id, label: vehicleLabel(x) }))} /></Field>
      {vehPlans.length > 0 && <Field label="По плану ТО" hint="План сдвинется, задача механику закроется"><Select value={form.plan} onChange={(x) => set({ plan: x })} placeholder="Вне плана" options={vehPlans.map((p) => ({ value: p.plan, label: p.name }))} /></Field>}
      <div className="chips">{Object.entries(KIND).map(([k, l]) => <button key={k} type="button" className={'chip' + (form.kind === k ? ' on' : '')} onClick={() => set({ kind: k })}>{l}</button>)}</div>
      <Field label="Что сделано"><textarea value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <div className="field-row">
        <Field label="Дата"><input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} /></Field>
        <Field label="Затраты, ₽"><input inputMode="decimal" value={form.cost} onChange={(e) => set({ cost: e.target.value })} /></Field>
      </div>
      <div className="field-row">
        <Field label="Пробег, км"><input inputMode="numeric" value={form.odometer} onChange={(e) => set({ odometer: e.target.value })} /></Field>
        <Field label="Моточасы"><input inputMode="numeric" value={form.engine_hours} onChange={(e) => set({ engine_hours: e.target.value })} /></Field>
      </div>
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} onClick={save}>Записать</Button>
    </Sheet>
  );
}
