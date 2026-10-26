// Справочники: техника, заказчики и объекты, ставки и коэффициенты.
import React, { useState } from 'react';
import { pb, errText } from '../lib/pb.js';
import { useSession } from '../lib/session.jsx';
import { useQuery } from '../lib/data.js';
import { useRefs, vehicleLabel } from '../lib/refs.js';
import { UNITS, VEHICLE_KINDS, WORK_UNITS, rub, fromKop, toKop, toNum, qty, shortDay, pbDate, day10, isoDay } from '../lib/format.js';
import { Button, Badge, Field, Select, Icon, PageTitle, ErrorBox, Loading, Sheet, Seg, useToast } from '../ui.jsx';

const f = (expr, params) => pb.filter(expr, params);

// ---------- техника ----------
export function Vehicles() {
  const s = useSession();
  const toast = useToast();
  const refs = useRefs(s.companyId);
  const [sheet, setSheet] = useState(null);
  const [showOff, setShowOff] = useState(false);
  const list = refs.vehicles.filter((v) => showOff || v.active !== false);
  return (
    <div className="stack-lg">
      <PageTitle title="Техника">
        {s.isMgmt && <Button variant="primary" onClick={() => setSheet({ active: true })}><Icon name="plus" size={20} />Машина</Button>}
      </PageTitle>
      <label className="check small"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />Показать списанную</label>
      {refs.loading && !refs.vehicles.length ? <Loading /> : (
        <div className="list">
          {list.length === 0 && <div className="list-empty">Добавьте технику — её будут выбирать водители в сменах</div>}
          {list.map((v) => (
            <button key={v.id} type="button" className="list-item" onClick={() => s.isMgmt && setSheet(v)}>
              <div className="t">
                <b>{vehicleLabel(v)}</b>
                <span>{[VEHICLE_KINDS[v.kind], v.model, v.odometer_now ? `${qty(v.odometer_now)} км` : '', v.engine_hours_now ? `${qty(v.engine_hours_now)} моточ.` : '', v.fuel_norm_100km ? `норма ${qty(v.fuel_norm_100km)} л/100 км` : ''].filter(Boolean).join(' · ')}</span>
              </div>
              {v.active === false && <Badge>Списана</Badge>}
            </button>
          ))}
        </div>
      )}
      {sheet && <VehicleSheet v={sheet} onClose={() => setSheet(null)} onDone={() => { setSheet(null); refs.reload(); toast('Сохранено'); }} />}
    </div>
  );
}

function VehicleSheet({ v, onClose, onDone }) {
  const s = useSession();
  const [form, setForm] = useState({
    name: v.name || '', plate: v.plate || '', kind: v.kind || '', model: v.model || '', year: v.year || '', vin: v.vin || '', active: v.active !== false,
    fuel_norm_100km: v.fuel_norm_100km || '', fuel_norm_hour: v.fuel_norm_hour || '', odometer_now: v.odometer_now || '', engine_hours_now: v.engine_hours_now || '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((x) => ({ ...x, ...p }));
  async function save() {
    if (!form.name.trim()) { setErr('Название'); return; }
    setBusy(true); setErr('');
    const data = { ...form, year: toNum(form.year) || null };
    for (const k of ['fuel_norm_100km', 'fuel_norm_hour', 'odometer_now', 'engine_hours_now']) data[k] = toNum(form[k]) || 0;
    try {
      if (v.id) await pb.collection('vehicles').update(v.id, data);
      else await pb.collection('vehicles').create({ company: s.companyId, ...data });
      onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet title={v.id ? vehicleLabel(v) : 'Новая машина'} onClose={onClose}>
      <Field label="Название"><input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Шакман X3000" /></Field>
      <div className="field-row">
        <Field label="Госномер"><input value={form.plate} onChange={(e) => set({ plate: e.target.value.toUpperCase() })} /></Field>
        <Field label="Вид"><Select value={form.kind} onChange={(x) => set({ kind: x })} placeholder="—" options={Object.entries(VEHICLE_KINDS).map(([value, label]) => ({ value, label }))} /></Field>
      </div>
      <div className="field-row">
        <Field label="Модель"><input value={form.model} onChange={(e) => set({ model: e.target.value })} /></Field>
        <Field label="Год"><input inputMode="numeric" value={form.year} onChange={(e) => set({ year: e.target.value })} /></Field>
      </div>
      <Field label="VIN"><input value={form.vin} onChange={(e) => set({ vin: e.target.value.toUpperCase() })} /></Field>
      <span className="section-label">Нормы расхода и показания</span>
      <div className="field-row">
        <Field label="л на 100 км"><input inputMode="decimal" value={form.fuel_norm_100km} onChange={(e) => set({ fuel_norm_100km: e.target.value })} /></Field>
        <Field label="л на моточас"><input inputMode="decimal" value={form.fuel_norm_hour} onChange={(e) => set({ fuel_norm_hour: e.target.value })} /></Field>
      </div>
      <div className="field-row">
        <Field label="Одометр, км" hint="Дальше обновляется по путевым"><input inputMode="decimal" value={form.odometer_now} onChange={(e) => set({ odometer_now: e.target.value })} /></Field>
        <Field label="Моточасы"><input inputMode="decimal" value={form.engine_hours_now} onChange={(e) => set({ engine_hours_now: e.target.value })} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />В работе</label>
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} onClick={save}>Сохранить</Button>
    </Sheet>
  );
}

// ---------- заказчики и объекты ----------
export function Sites() {
  const s = useSession();
  const toast = useToast();
  const refs = useRefs(s.companyId);
  const [tab, setTab] = useState('sites');
  const [sheet, setSheet] = useState(null);
  return (
    <div className="stack-lg">
      <PageTitle title="Заказчики и объекты">
        {s.isMgmt && <Button variant="primary" onClick={() => setSheet({ kind: tab, rec: { active: true } })}><Icon name="plus" size={20} />{tab === 'sites' ? 'Объект' : 'Заказчик'}</Button>}
      </PageTitle>
      <Seg value={tab} onChange={setTab} label="Раздел" options={[{ value: 'sites', label: 'Объекты' }, { value: 'customers', label: 'Заказчики' }]} />
      <div className="list">
        {tab === 'sites' && refs.sites.length === 0 && <div className="list-empty">Объекты — где работает техника: улица, карьер, площадка. Их выбирают в смене</div>}
        {tab === 'customers' && refs.customers.length === 0 && <div className="list-empty">Заказчиков пока нет</div>}
        {(tab === 'sites' ? refs.sites : refs.customers).map((x) => (
          <button key={x.id} type="button" className="list-item" onClick={() => s.isMgmt && setSheet({ kind: tab, rec: x })}>
            <div className="t">
              <b>{x.name}</b>
              <span>{tab === 'sites' ? [refs.customer[x.customer] && refs.customer[x.customer].name, x.address].filter(Boolean).join(' · ') : [x.inn && 'ИНН ' + x.inn, x.contact].filter(Boolean).join(' · ')}</span>
            </div>
            {x.active === false && <Badge>Не активен</Badge>}
          </button>
        ))}
      </div>
      {sheet && <PlaceSheet kind={sheet.kind} rec={sheet.rec} onClose={() => setSheet(null)} onDone={() => { setSheet(null); refs.reload(); toast('Сохранено'); }} />}
    </div>
  );
}

function PlaceSheet({ kind, rec, onClose, onDone }) {
  const s = useSession();
  const refs = useRefs(s.companyId);
  const [form, setForm] = useState({ name: rec.name || '', customer: rec.customer || '', address: rec.address || '', inn: rec.inn || '', contact: rec.contact || '', active: rec.active !== false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const col = kind === 'sites' ? 'sites' : 'customers';
  async function save() {
    if (!form.name.trim()) { setErr('Название'); return; }
    setBusy(true); setErr('');
    const data = kind === 'sites' ? { name: form.name, customer: form.customer, address: form.address, active: form.active } : { name: form.name, inn: form.inn, contact: form.contact, active: form.active };
    try {
      if (rec.id) await pb.collection(col).update(rec.id, data);
      else await pb.collection(col).create({ company: s.companyId, ...data });
      onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet title={rec.id ? rec.name : kind === 'sites' ? 'Новый объект' : 'Новый заказчик'} onClose={onClose}>
      <Field label="Название"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      {kind === 'sites' ? (
        <>
          <Field label="Заказчик"><Select value={form.customer} onChange={(v) => setForm({ ...form, customer: v })} placeholder="Не указан" options={refs.customers.map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Адрес"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        </>
      ) : (
        <>
          <Field label="ИНН"><input inputMode="numeric" value={form.inn} onChange={(e) => setForm({ ...form, inn: e.target.value.replace(/\D/g, '') })} maxLength={12} /></Field>
          <Field label="Контакт"><input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Кто и как связаться" /></Field>
        </>
      )}
      <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Активен</label>
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} onClick={save}>Сохранить</Button>
    </Sheet>
  );
}

// ---------- ставки ----------
const FACTORS = { night: 'Ночь', holiday: 'Праздник', overtime: 'Переработка' };

export function Rates() {
  const s = useSession();
  const toast = useToast();
  const refs = useRefs(s.companyId);
  const rates = useQuery(`rates:${s.companyId}`, () => pb.collection('rates').getFullList({ filter: f('company = {:c}', { c: s.companyId }), sort: 'unit,-valid_from' }));
  const factors = useQuery(`factors:${s.companyId}`, () => pb.collection('rate_factors').getFullList({ filter: f('company = {:c}', { c: s.companyId }), sort: 'kind,-valid_from' }));
  const [sheet, setSheet] = useState(null);
  const [fsheet, setFsheet] = useState(false);
  const today = isoDay();
  const scope = (r) => [r.member && refs.member[r.member] && refs.member[r.member].display_name, r.vehicle && refs.vehicle[r.vehicle] && refs.vehicle[r.vehicle].name,
    r.site && refs.site[r.site] && refs.site[r.site].name, r.customer && refs.customer[r.customer] && refs.customer[r.customer].name].filter(Boolean).join(' · ') || 'Для всех';
  const actual = (r) => day10(r.valid_from) <= today && (!r.valid_to || day10(r.valid_to) >= today);
  return (
    <div className="stack-lg">
      <PageTitle title="Ставки">
        {s.isMgmt && <Button variant="primary" onClick={() => setSheet({})}><Icon name="plus" size={20} />Ставка</Button>}
      </PageTitle>
      <p className="note">Ставка действует с даты. Новая ставка не меняет уже подтверждённые смены. Если подходят несколько — берётся самая точная: для конкретного водителя, машины, объекта или заказчика.</p>
      <ErrorBox text={rates.error} onRetry={rates.reload} />
      {rates.loading && !rates.data ? <Loading /> : (
        <div className="list">
          {(rates.data || []).length === 0 && <div className="list-empty">Ставок нет — без них смену не подтвердить. Начните с «Смена» для всех</div>}
          {(rates.data || []).map((r) => (
            <button key={r.id} type="button" className="list-item" onClick={() => s.isMgmt && setSheet(r)} style={actual(r) ? undefined : { opacity: 0.6 }}>
              <div className="t">
                <b>{UNITS[r.unit] ? UNITS[r.unit].label : r.unit}{r.name ? ' · ' + r.name : ''}</b>
                <span>{scope(r)} · с {shortDay(r.valid_from)}{r.valid_to ? ' по ' + shortDay(r.valid_to) : ''}</span>
              </div>
              <span className="num">{rub(r.amount_kop)}</span>
            </button>
          ))}
        </div>
      )}
      <section className="stack">
        <div className="row between">
          <h2 className="h2">Коэффициенты</h2>
          {s.isMgmt && <Button size="sm" onClick={() => setFsheet(true)}><Icon name="plus" size={18} />Коэффициент</Button>}
        </div>
        <div className="list">
          {(factors.data || []).length === 0 && <div className="list-empty">Ночь, праздник, переработка — множители к ставке</div>}
          {(factors.data || []).map((x) => (
            <div key={x.id} className="list-item" style={{ cursor: 'default' }}>
              <div className="t"><b>{FACTORS[x.kind]}</b><span>с {shortDay(x.valid_from)}{x.valid_to ? ' по ' + shortDay(x.valid_to) : ''}</span></div>
              <span className="num">×{qty(x.factor_permille / 1000)}</span>
            </div>
          ))}
        </div>
      </section>
      {sheet && <RateSheet rate={sheet} onClose={() => setSheet(null)} onDone={() => { setSheet(null); rates.reload(); toast('Сохранено'); }} />}
      {fsheet && <FactorSheet onClose={() => setFsheet(false)} onDone={() => { setFsheet(false); factors.reload(); toast('Сохранено'); }} />}
    </div>
  );
}

export function RateSheet({ rate = {}, member, onClose, onDone }) {
  const s = useSession();
  const refs = useRefs(s.companyId);
  const [form, setForm] = useState({
    unit: rate.unit || 'shift', amount: rate.amount_kop !== undefined ? fromKop(rate.amount_kop) : '', name: rate.name || '',
    valid_from: day10(rate.valid_from) || isoDay().slice(0, 8) + '01', valid_to: day10(rate.valid_to),
    member: rate.member || member || '', vehicle: rate.vehicle || '', site: rate.site || '', customer: rate.customer || '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((x) => ({ ...x, ...p }));
  async function save() {
    const amount = toKop(form.amount);
    if (!(amount >= 0) || form.amount === '') { setErr('Сумма'); return; }
    setBusy(true); setErr('');
    const data = { unit: form.unit, amount_kop: amount, name: form.name, valid_from: pbDate(form.valid_from), valid_to: form.valid_to ? pbDate(form.valid_to) : '',
      member: form.member, vehicle: form.vehicle, site: form.site, customer: form.customer };
    try {
      if (rate.id) await pb.collection('rates').update(rate.id, data);
      else await pb.collection('rates').create({ company: s.companyId, ...data });
      onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm('Удалить ставку? Подтверждённые смены не изменятся.')) return;
    try { await pb.collection('rates').delete(rate.id); onDone(); } catch (e) { setErr(errText(e)); }
  }
  const units = [...WORK_UNITS, 'month', 'per_diem'];
  return (
    <Sheet title={rate.id ? 'Ставка' : 'Новая ставка'} onClose={onClose}>
      <Field label="За что"><Select value={form.unit} onChange={(v) => set({ unit: v })} options={units.map((u) => ({ value: u, label: UNITS[u].label }))} /></Field>
      <div className="field-row">
        <Field label={form.unit === 'month' ? 'Оклад, ₽ в месяц' : `₽ за ${UNITS[form.unit].short}`}><input inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
        <Field label="Название" hint="Необязательно"><input value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
      </div>
      <div className="field-row">
        <Field label="Действует с"><input type="date" value={form.valid_from} onChange={(e) => set({ valid_from: e.target.value })} /></Field>
        <Field label="По" hint="Пусто — бессрочно"><input type="date" value={form.valid_to} onChange={(e) => set({ valid_to: e.target.value })} /></Field>
      </div>
      <span className="section-label">Для кого (пусто — для всех)</span>
      {!member && <Field label="Сотрудник"><Select value={form.member} onChange={(v) => set({ member: v })} placeholder="Все" options={refs.members.filter((m) => m.status === 'active').map((m) => ({ value: m.id, label: m.display_name }))} /></Field>}
      <div className="field-row">
        <Field label="Техника"><Select value={form.vehicle} onChange={(v) => set({ vehicle: v })} placeholder="Любая" options={refs.vehicles.map((v) => ({ value: v.id, label: vehicleLabel(v) }))} /></Field>
        <Field label="Объект"><Select value={form.site} onChange={(v) => set({ site: v })} placeholder="Любой" options={refs.sites.map((x) => ({ value: x.id, label: x.name }))} /></Field>
      </div>
      <Field label="Заказчик"><Select value={form.customer} onChange={(v) => set({ customer: v })} placeholder="Любой" options={refs.customers.map((x) => ({ value: x.id, label: x.name }))} /></Field>
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} onClick={save}>Сохранить</Button>
      {rate.id && <Button block variant="ghost" className="danger" onClick={remove}>Удалить</Button>}
    </Sheet>
  );
}

function FactorSheet({ onClose, onDone }) {
  const s = useSession();
  const [form, setForm] = useState({ kind: 'night', factor: '1,2', valid_from: isoDay().slice(0, 8) + '01' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    const v = toNum(form.factor);
    if (!(v >= 1 && v <= 5)) { setErr('Множитель — от 1 до 5'); return; }
    setBusy(true); setErr('');
    try { await pb.collection('rate_factors').create({ company: s.companyId, kind: form.kind, factor_permille: Math.round(v * 1000), valid_from: pbDate(form.valid_from) }); onDone(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet title="Коэффициент" onClose={onClose}>
      <Seg value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} label="Вид" options={Object.entries(FACTORS).map(([value, label]) => ({ value, label }))} />
      <div className="field-row">
        <Field label="Множитель" hint="1,2 = +20 %"><input inputMode="decimal" value={form.factor} onChange={(e) => setForm({ ...form, factor: e.target.value })} /></Field>
        <Field label="Действует с"><input type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} /></Field>
      </div>
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} onClick={save}>Сохранить</Button>
    </Sheet>
  );
}
