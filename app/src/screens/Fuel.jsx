// Заправки (работают без связи) и отчёт по ГСМ для офиса и механика.
import React, { useState } from 'react';
import { pb, errText } from '../lib/pb.js';
import { useSession } from '../lib/session.jsx';
import { useQuery } from '../lib/data.js';
import { useRefs, vehicleLabel } from '../lib/refs.js';
import { enqueue, flush } from '../lib/outbox.js';
import { compressImage } from '../lib/image.js';
import { go, Link } from '../lib/router.jsx';
import { rub, qty, toNum, toKop, newId, pbMoment, localMoment, monthRange, addDays, shortDay, dayLabel, timeOf } from '../lib/format.js';
import { Button, Field, Select, Icon, PageTitle, ErrorBox, Loading, PhotoAdd, BlobImg, Badge, useToast } from '../ui.jsx';

const f = (expr, params) => pb.filter(expr, params);
const FUEL = { diesel: 'ДТ', ai92: 'АИ-92', ai95: 'АИ-95', gas: 'Газ', other: 'Другое' };
const SOURCE = { card: 'Карта', cash: 'Наличные', tank: 'Своя ёмкость', other: 'Другое' };
const LAST = 'ordius-last-fuel';

export function FuelForm() {
  const s = useSession();
  const toast = useToast();
  const refs = useRefs(s.companyId);
  const cards = useQuery(`cards:${s.companyId}`, () => pb.collection('fuel_cards').getFullList({ filter: f('company = {:c} && active = true', { c: s.companyId }) }));
  const [form, setForm] = useState(() => {
    let last = {};
    try { last = JSON.parse(localStorage.getItem(LAST) || '{}'); } catch (_) { /* нет */ }
    return { vehicle: last.vehicle || '', at: localMoment(new Date().toISOString()), liters: '', amount: '', fuel: last.fuel || 'diesel', source: last.source || 'card', card: last.card || '', odometer: '', station: '', note: '', member: s.isOffice ? '' : s.membership.id, photos: [] };
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p) => setForm((x) => ({ ...x, ...p }));
  const myCards = (cards.data || []).filter((c) => s.isOffice || c.holder === s.membership.id || (form.vehicle && c.vehicle === form.vehicle));

  async function save() {
    setErr('');
    const liters = toNum(form.liters);
    if (!form.vehicle) { setErr('Выберите машину'); return; }
    if (!(liters > 0)) { setErr('Сколько литров'); return; }
    const amount = form.amount ? toKop(form.amount) : 0;
    if (Number.isNaN(amount)) { setErr('Сумма записана с ошибкой'); return; }
    if (!s.isOffice && !form.member) { setErr('Нет сотрудника'); return; }
    setBusy(true);
    try {
      const data = {
        company: s.companyId, vehicle: form.vehicle, member: form.member, card: form.source === 'card' ? form.card : '',
        at: pbMoment(form.at), liters, amount_kop: amount, fuel: form.fuel, source: form.source, station: form.station,
        odometer: toNum(form.odometer) || 0, note: form.note,
      };
      const v = refs.vehicle[form.vehicle];
      await enqueue([{ op: 'create', col: 'fuel_logs', id: newId(), data, files: { receipt: form.photos.map((p) => ({ blob: p.blob, name: p.name })) },
        label: `Заправка ${qty(liters)} л${v ? ' · ' + v.name : ''}` }]);
      try { localStorage.setItem(LAST, JSON.stringify({ vehicle: form.vehicle, fuel: form.fuel, source: form.source, card: form.card })); } catch (_) { /* нет */ }
      const left = await flush();
      toast(left ? 'Сохранено на телефоне — отправится, когда появится связь' : 'Заправка записана');
      go(s.isOffice || s.is(['mechanic']) ? '/fuel' : '/', { replace: true });
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }

  return (
    <div className="stack-lg">
      <PageTitle title="Заправка" backTo="/" />
      <section className="card card-pad">
        {s.isOffice && (
          <Field label="Кто заправлял">
            <Select value={form.member} onChange={(v) => set({ member: v })} placeholder="Не указан"
              options={refs.members.filter((m) => m.status === 'active').map((m) => ({ value: m.id, label: m.display_name }))} />
          </Field>
        )}
        <Field label="Машина">
          <Select value={form.vehicle} onChange={(v) => set({ vehicle: v })} placeholder="Выберите"
            options={refs.vehicles.filter((v) => v.active !== false).map((v) => ({ value: v.id, label: vehicleLabel(v) }))} />
        </Field>
        <div className="field-row">
          <Field label="Литров"><input inputMode="decimal" value={form.liters} onChange={(e) => set({ liters: e.target.value })} /></Field>
          <Field label="Сумма, ₽"><input inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
        </div>
        <div className="chips">
          {Object.entries(FUEL).map(([k, v]) => <button key={k} type="button" className={'chip' + (form.fuel === k ? ' on' : '')} onClick={() => set({ fuel: k })}>{v}</button>)}
        </div>
        <div className="chips">
          {Object.entries(SOURCE).map(([k, v]) => <button key={k} type="button" className={'chip' + (form.source === k ? ' on' : '')} onClick={() => set({ source: k })}>{v}</button>)}
        </div>
        {form.source === 'card' && myCards.length > 0 && (
          <Field label="Карта">
            <Select value={form.card} onChange={(v) => set({ card: v })} placeholder="Выберите карту"
              options={myCards.map((c) => ({ value: c.id, label: `${c.provider || 'Карта'} •••• ${String(c.number).slice(-4)}` }))} />
          </Field>
        )}
        <div className="field-row">
          <Field label="Когда"><input type="datetime-local" value={form.at} onChange={(e) => set({ at: e.target.value })} /></Field>
          <Field label="Одометр, км"><input inputMode="decimal" value={form.odometer} onChange={(e) => set({ odometer: e.target.value })} /></Field>
        </div>
        <Field label="АЗС"><input value={form.station} onChange={(e) => set({ station: e.target.value })} placeholder="Например, Газпромнефть, Бердское ш." /></Field>
      </section>
      <section className="stack">
        <h2 className="h2">Чек</h2>
        <div className="photos">
          {form.photos.map((p) => (
            <div key={p.key} className="photo"><BlobImg blob={p.blob} alt="Чек" />
              <button type="button" className="x" aria-label="Убрать" onClick={() => set({ photos: form.photos.filter((x) => x.key !== p.key) })}><Icon name="x" size={16} /></button>
            </div>
          ))}
          {form.photos.length < 3 && <PhotoAdd label="Чек" onAdd={async (files) => {
            const out = [];
            for (const file of files.slice(0, 3 - form.photos.length)) out.push({ key: newId(), ...(await compressImage(file)) });
            setForm((x) => ({ ...x, photos: [...x.photos, ...out] }));
          }} />}
        </div>
      </section>
      <ErrorBox text={err} />
      <Button variant="primary" size="lg" block busy={busy} onClick={save}><Icon name="check" />Записать</Button>
    </div>
  );
}

export function FuelList() {
  const s = useSession();
  const refs = useRefs(s.companyId);
  const [range, setRange] = useState(() => monthRange());
  const seeAll = s.isOffice || s.is(['mechanic']);
  const logs = useQuery(`fuel:${s.companyId}:${seeAll ? 'all' : s.membership.id}:${range.from}`, () => pb.collection('fuel_logs').getFullList({
    filter: f('company = {:c} && at >= {:from} && at <= {:to}' + (seeAll ? '' : ' && member = {:m}'),
      { c: s.companyId, m: s.membership.id, from: range.from + ' 00:00:00.000Z', to: range.to + ' 23:59:59.999Z' }), sort: '-at',
  }), { deps: [range.to] });
  const report = useQuery(seeAll && `gsm:${s.companyId}:${range.from}`, () => pb.send('/api/ordius/fuel', { query: { company: s.companyId, from: range.from, to: range.to } }), { deps: [range.to] });
  const shiftMonth = (n) => setRange(monthRange(addDays(n > 0 ? range.to : range.from, n)));
  async function csv() {
    const r = await fetch(pb.buildURL('/api/ordius/fuel') + `?company=${s.companyId}&from=${range.from}&to=${range.to}&format=csv`, { headers: { Authorization: pb.authStore.token } });
    const b = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = `gsm-${range.from}.csv`; a.click();
  }

  return (
    <div className="stack-lg">
      <PageTitle title="Заправки и ГСМ" eyebrow={`${shortDay(range.from)} — ${shortDay(range.to)}`}>
        <button type="button" className="btn sm" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц"><Icon name="left" size={18} /></button>
        <button type="button" className="btn sm" onClick={() => shiftMonth(1)} aria-label="Следующий месяц"><Icon name="chevron" size={18} /></button>
        <Link to="/fuel/new" className="btn primary sm"><Icon name="plus" size={18} />Заправка</Link>
      </PageTitle>
      {seeAll && (
        <section className="card" style={{ overflow: 'hidden' }}>
          <div className="row between" style={{ padding: '14px 16px' }}>
            <h2 className="h2">Расход по машинам</h2>
            <Button size="sm" onClick={csv}><Icon name="download" size={18} />CSV</Button>
          </div>
          <ErrorBox text={report.error} />
          <div className="table-scroll">
            <table className="t">
              <thead><tr><th>Машина</th><th className="r">Км</th><th className="r">Моточ.</th><th className="r">Расход, л</th><th className="r">Норма, л</th><th className="r">Перерасход</th><th className="r">Залито, л</th><th className="r">Не в путевых, л</th><th className="r">Сумма</th></tr></thead>
              <tbody>
                {((report.data && report.data.rows) || []).length === 0 && <tr><td colSpan={9} className="subtle">Нет данных за месяц</td></tr>}
                {((report.data && report.data.rows) || []).map((r) => (
                  <tr key={r.vehicle}>
                    <td>{r.vehicle_name}</td><td className="r">{qty(r.km)}</td><td className="r">{qty(r.hours)}</td><td className="r">{qty(r.used_l)}</td>
                    <td className="r">{r.norm_l === null ? '—' : qty(r.norm_l)}</td>
                    <td className="r">{r.overrun_l === null ? '—' : <span className={r.overrun_l > 0 ? 'bad' : 'good'}>{qty(r.overrun_l)} л ({qty(r.overrun_pct)} %)</span>}</td>
                    <td className="r">{qty(r.refueled_l)}</td>
                    <td className="r">{r.not_in_waybills_l > 0 ? <span className="warn">{qty(r.not_in_waybills_l)}</span> : qty(r.not_in_waybills_l)}</td>
                    <td className="r">{rub(r.spent_kop)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note" style={{ padding: '10px 16px 14px' }}>Норма — по нормам расхода машины (карточка техники). «Не в путевых» — залито по чекам и картам больше, чем записано в путевых: повод разобраться.</p>
        </section>
      )}
      <section className="stack">
        <h2 className="h2">Заправки</h2>
        {logs.loading && !logs.data ? <Loading /> : (
          <div className="list">
            {(logs.data || []).length === 0 && <div className="list-empty">Заправок за месяц нет</div>}
            {(logs.data || []).map((l) => (
              <div key={l.id} className="list-item" style={{ cursor: 'default' }}>
                <div className="t">
                  <b>{qty(l.liters)} л · {refs.vehicle[l.vehicle] ? refs.vehicle[l.vehicle].name : ''}</b>
                  <span>{dayLabel(l.at)} {timeOf(l.at)}{seeAll && refs.member[l.member] ? ' · ' + refs.member[l.member].display_name : ''}{l.station ? ' · ' + l.station : ''}</span>
                </div>
                <div className="r">{l.amount_kop ? <span className="num">{rub(l.amount_kop)}</span> : null}{(l.receipt || []).length > 0 && <Badge>чек</Badge>}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
