// Смены: список, новая смена со строками и фото путевого (работает без связи), просмотр, подтверждение.
import React, { useEffect, useMemo, useState } from 'react';
import { pb, errText } from '../lib/pb.js';
import { useSession } from '../lib/session.jsx';
import { useQuery } from '../lib/data.js';
import { useRefs, vehicleLabel, fileToken, fileUrl } from '../lib/refs.js';
import { enqueue, flush } from '../lib/outbox.js';
import { compressImage } from '../lib/image.js';
import { go, Link } from '../lib/router.jsx';
import {
  UNITS, WORK_UNITS, SHIFT_STATUS, DOC_KINDS, rub, qty, isoDay, dayLabel, shortDay, pbDate, day10, newId, toNum,
  monthRange, addDays, plural, unitQty,
} from '../lib/format.js';
import { Button, Badge, Field, Select, Icon, PageTitle, Sheet, Loading, ErrorBox, Empty, PhotoAdd, BlobImg, Seg, useToast } from '../ui.jsx';

const f = (expr, params) => pb.filter(expr, params);
const NEED_QTY = { hour: 'Сколько часов', trip: 'Сколько рейсов', lin_m: 'Сколько погонных метров', sq_m: 'Сколько м²', cu_m: 'Сколько м³', piece: 'Сколько штук' };

function entrySummary(e, refs) {
  const u = UNITS[e.unit] || { short: e.unit };
  let what;
  if (e.unit === 'tkm') what = `${qty(e.tons)} т × ${qty(e.km)} км`;
  else if (e.unit === 'shift') what = unitQty(e.quantity || 1, 'shift');
  else if (e.unit === 'km') what = `${qty(e.km || e.quantity)} км`;
  else if (e.unit === 'ton') what = `${qty(e.tons || e.quantity)} т`;
  else what = unitQty(e.quantity, e.unit);
  const v = refs.vehicle[e.vehicle];
  return [v ? v.name : '', what].filter(Boolean).join(' · ');
}

// ---------- список ----------
export function ShiftList({ outbox }) {
  const s = useSession();
  const [range, setRange] = useState(() => monthRange());
  const [filter, setFilter] = useState(s.isOffice ? 'submitted' : 'all');
  const refs = useRefs(s.companyId);
  const key = `shifts:${s.companyId}:${s.isOffice ? 'all' : s.membership.id}:${range.from}:${filter}`;
  const q = useQuery(key, () => {
    let expr = 'company = {:c} && date >= {:from} && date <= {:to}';
    if (!s.isOffice) expr += ' && member = {:m}';
    if (filter !== 'all') expr += ' && status = {:st}';
    return pb.collection('shifts').getFullList({
      filter: f(expr, { c: s.companyId, m: s.membership.id, from: range.from + ' 00:00:00.000Z', to: range.to + ' 23:59:59.999Z', st: filter }),
      sort: '-date,-created', expand: 'shift_entries_via_shift',
    });
  }, { deps: [range.from, filter] });
  const pending = (outbox || []).filter((i) => i.col === 'shifts' && i.op === 'create');
  const pendingIds = new Set((outbox || []).filter((i) => i.col === 'shifts').map((i) => i.id));
  const list = q.data || [];
  const shiftMonth = (n) => { const r = monthRange(addDays(n > 0 ? range.to : range.from, n)); setRange(r); };

  return (
    <div className="stack-lg">
      <PageTitle title="Смены" eyebrow={`${shortDay(range.from)} — ${shortDay(range.to)}`}>
        <Link to="/shift/new" className="btn primary"><Icon name="plus" size={20} />Смена</Link>
      </PageTitle>
      <div className="row between">
        <div className="row">
          <button type="button" className="btn sm" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц"><Icon name="left" size={18} /></button>
          <button type="button" className="btn sm" onClick={() => shiftMonth(1)} aria-label="Следующий месяц"><Icon name="chevron" size={18} /></button>
        </div>
        <Seg value={filter} onChange={setFilter} label="Показать" options={[
          ...(s.isOffice ? [{ value: 'submitted', label: 'На проверке' }] : []),
          { value: 'all', label: 'Все' }, { value: 'rejected', label: 'Возвращены' },
        ]} />
      </div>
      {pending.length > 0 && (
        <div className="list">
          {pending.map((p) => (
            <Link key={p.seq} to="/outbox" className="list-item">
              <div className="t"><b>{dayLabel(p.data.date)}</b><span>{p.label || 'Смена'}</span></div>
              <div className="r"><Badge tone="warning">{p.error ? 'Ошибка' : 'Не отправлена'}</Badge></div>
            </Link>
          ))}
        </div>
      )}
      <ErrorBox text={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : (
        <div className="list">
          {list.length === 0 && <Empty>{filter === 'submitted' ? 'Всё проверено — новых смен нет' : 'Смен за этот месяц нет'}</Empty>}
          {list.map((sh) => {
            const st = SHIFT_STATUS[sh.status] || {};
            const entries = (sh.expand && sh.expand.shift_entries_via_shift) || [];
            const who = refs.member[sh.member];
            return (
              <Link key={sh.id} to={'/shift/' + sh.id} className="list-item">
                <div className="t">
                  <b>{dayLabel(sh.date)}{s.isOffice && who ? ' · ' + who.display_name : ''}</b>
                  <span className="ellipsis">{[refs.site[sh.site] && refs.site[sh.site].name, ...entries.map((e) => entrySummary(e, refs))].filter(Boolean).join(' · ') || 'Без строк'}</span>
                </div>
                <div className="r">
                  <Badge tone={pendingIds.has(sh.id) ? 'warning' : st.tone}>{pendingIds.has(sh.id) ? 'Отправляется' : st.label}</Badge>
                  {sh.status === 'confirmed' && sh.amount_kop !== null && <span className="num small">{rub(sh.amount_kop)}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- новая смена / исправление ----------
const blankEntry = (last = {}) => ({
  key: newId(), id: '', vehicle: last.vehicle || '', unit: last.unit || 'shift', quantity: '', tons: '', km: '',
  contract_item: '', bill_qty: '', waybill_no: '', odometer_start: '', odometer_end: '', engine_hours_start: '', engine_hours_end: '',
  fuel_start: '', fuel_added: '', fuel_end: '', epl: false,
});
const LAST = 'ordius-last-entry';
const NUM_FIELDS = ['quantity', 'tons', 'km', 'bill_qty', 'odometer_start', 'odometer_end', 'engine_hours_start', 'engine_hours_end', 'fuel_start', 'fuel_added', 'fuel_end'];

export function ShiftForm({ params }) {
  const s = useSession();
  const toast = useToast();
  const refs = useRefs(s.companyId);
  const editId = params.id || '';
  const existing = useQuery(editId && 'shift:' + editId, () => pb.collection('shifts').getOne(editId, { expand: 'shift_entries_via_shift,documents_via_shift' }), { cache: false, refreshOnSync: false });
  const [form, setForm] = useState(null);
  const [errs, setErrs] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (form) return;
    if (!editId) {
      let last = {};
      try { last = JSON.parse(localStorage.getItem(LAST) || '{}'); } catch (_) { /* нет */ }
      setForm({ date: isoDay(), member: s.isOffice ? '' : s.membership.id, site: last.site || '', night: false, holiday: false, note: '', entries: [blankEntry(last)], photos: [], oldDocs: [], removedDocs: [], removedEntries: [] });
    } else if (existing.data) {
      const sh = existing.data;
      const ents = (sh.expand && sh.expand.shift_entries_via_shift) || [];
      setForm({
        date: day10(sh.date), member: sh.member, site: sh.site || '', night: !!sh.night, holiday: !!sh.holiday, note: sh.note || '',
        entries: ents.map((e) => ({ ...blankEntry(), ...Object.fromEntries(Object.entries(e).map(([k, v]) => [k, NUM_FIELDS.includes(k) ? (v ? String(v).replace('.', ',') : '') : v])), key: e.id, epl: !!(e.waybill_no || e.odometer_start || e.fuel_start) })),
        photos: [], oldDocs: (sh.expand && sh.expand.documents_via_shift) || [], removedDocs: [], removedEntries: [], status: sh.status,
      });
    }
  }, [existing.data, editId]); // eslint-disable-line

  if (editId && existing.error) return <ErrorBox text={existing.error} onRetry={existing.reload} />;
  if (!form) return <Loading />;

  const set = (patch) => setForm((x) => ({ ...x, ...patch }));
  const setEntry = (key, patch) => setForm((x) => ({ ...x, entries: x.entries.map((e) => (e.key === key ? { ...e, ...patch } : e)) }));
  const siteRec = refs.site[form.site];
  const contractItems = refs.items.filter((it) => siteRec && siteRec.contract && it.contract === siteRec.contract && it.unit !== 'month');
  const drivers = refs.members.filter((m) => m.status === 'active');
  const activeVehicles = refs.vehicles.filter((v) => v.active !== false);

  function validate() {
    const e = {};
    if (!form.date) e.date = 'Укажите дату';
    if (!form.member) e.member = 'Кто работал';
    if (!form.entries.length) e.entries = 'Добавьте хотя бы одну строку';
    form.entries.forEach((en) => {
      const n = (k) => toNum(en[k]);
      if (en.unit === 'tkm' && !(n('tons') > 0 && n('km') > 0)) e[en.key] = 'Укажите тонны и километры';
      else if (NEED_QTY[en.unit] && !(n('quantity') > 0)) e[en.key] = NEED_QTY[en.unit];
      else if (en.unit === 'km' && !(n('km') > 0 || n('quantity') > 0)) e[en.key] = 'Сколько километров';
      else if (en.unit === 'ton' && !(n('tons') > 0 || n('quantity') > 0)) e[en.key] = 'Сколько тонн';
      for (const k of NUM_FIELDS) if (Number.isNaN(n(k))) e[en.key] = 'Число записано с ошибкой';
      if (n('odometer_end') && n('odometer_start') && n('odometer_end') < n('odometer_start')) e[en.key] = 'Одометр на возврате меньше, чем на выезде';
    });
    setErrs(e);
    return Object.keys(e).length === 0;
  }

  async function save(status) {
    setErr('');
    if (!validate()) { setErr('Проверьте выделенные поля'); return; }
    setBusy(true);
    try {
      const shiftId = editId || newId();
      const ops = [];
      const head = { date: pbDate(form.date), site: form.site, night: form.night, holiday: form.holiday, note: form.note };
      const memberName = (refs.member[form.member] || {}).display_name || '';
      const label = [memberName && s.isOffice ? memberName : '', form.entries.map((e) => entrySummary(e, refs)).join(', ')].filter(Boolean).join(' · ');
      if (!editId) ops.push({ op: 'create', col: 'shifts', id: shiftId, data: { company: s.companyId, member: form.member, status: 'draft', ...head }, label });
      else ops.push({ op: 'update', col: 'shifts', id: shiftId, data: { ...head, ...(form.status === 'rejected' || form.status === 'submitted' ? { status: 'draft' } : {}) }, label });
      for (const en of form.entries) {
        const data = { vehicle: en.vehicle, unit: en.unit, contract_item: en.contract_item || '', waybill_no: en.waybill_no || '' };
        for (const k of NUM_FIELDS) data[k] = toNum(en[k]) ?? 0;
        if (en.unit === 'shift' && !(data.quantity > 0)) data.quantity = 1;
        if (en.id) ops.push({ op: 'update', col: 'shift_entries', id: en.id, data, label });
        else ops.push({ op: 'create', col: 'shift_entries', id: newId(), data: { company: s.companyId, shift: shiftId, ...data }, label });
      }
      for (const id of form.removedEntries) ops.push({ op: 'delete', col: 'shift_entries', id, label });
      for (const id of form.removedDocs) ops.push({ op: 'delete', col: 'documents', id, label: 'Фото смены' });
      for (const ph of form.photos) {
        ops.push({ op: 'create', col: 'documents', id: newId(), data: { company: s.companyId, shift: shiftId, kind: ph.kind, doc_date: pbDate(form.date) },
          files: { files: [{ blob: ph.blob, name: ph.name }] }, label: `${DOC_KINDS[ph.kind]} к смене ${shortDay(form.date)}` });
      }
      // Отправка на проверку — последним шагом, когда строки и фото уже на сервере
      if (status === 'submitted') ops.push({ op: 'update', col: 'shifts', id: shiftId, data: { status: 'submitted' }, label });
      const first = form.entries[0];
      try { localStorage.setItem(LAST, JSON.stringify({ vehicle: first.vehicle, unit: first.unit, site: form.site })); } catch (_) { /* нет */ }
      await enqueue(ops);
      const left = await flush();
      toast(left ? 'Сохранено на телефоне — отправится, когда появится связь' : status === 'submitted' ? 'Смена отправлена на проверку' : 'Черновик сохранён');
      go(editId ? '/shift/' + shiftId : '/shifts', { replace: true });
    } catch (e) {
      setErr(errText(e));
    } finally { setBusy(false); }
  }

  async function addPhotos(files, kind) {
    const out = [];
    for (const file of files) {
      const c = await compressImage(file);
      out.push({ key: newId(), kind, ...c });
    }
    setForm((x) => ({ ...x, photos: [...x.photos, ...out] }));
  }

  return (
    <div className="stack-lg">
      <PageTitle title={editId ? 'Исправить смену' : 'Новая смена'} backTo="/shifts" />
      {form.status === 'rejected' && existing.data && existing.data.reject_reason && (
        <div className="alert danger"><Icon name="alert" size={20} /><span>Вернули: {existing.data.reject_reason}</span></div>
      )}
      <section className="card card-pad">
        {s.isOffice && !editId && (
          <Field label="Кто работал" error={errs.member}>
            <Select value={form.member} onChange={(v) => set({ member: v })} placeholder="Выберите сотрудника"
              options={drivers.map((m) => ({ value: m.id, label: m.display_name }))} />
          </Field>
        )}
        <div className="field-row">
          <Field label="Дата" error={errs.date}>
            <input type="date" value={form.date} max={addDays(isoDay(), 1)} onChange={(e) => set({ date: e.target.value })} />
          </Field>
          <Field label="Объект">
            <Select value={form.site} onChange={(v) => set({ site: v })} placeholder="Не указан"
              options={refs.sites.filter((x) => x.active !== false || x.id === form.site).map((x) => ({ value: x.id, label: x.name }))} />
          </Field>
        </div>
        <div className="row" style={{ gap: 16 }}>
          <label className="check"><input type="checkbox" checked={form.night} onChange={(e) => set({ night: e.target.checked })} />Ночная</label>
          <label className="check"><input type="checkbox" checked={form.holiday} onChange={(e) => set({ holiday: e.target.checked })} />Праздник</label>
        </div>
      </section>

      <section className="stack">
        <div className="row between"><h2 className="h2">Что сделано</h2></div>
        {form.entries.map((en, i) => (
          <div key={en.key} className="entry">
            <div className="entry-head">
              <span className="section-label">Строка {i + 1}</span>
              {form.entries.length > 1 && (
                <button type="button" className="btn ghost sm danger" onClick={() => setForm((x) => ({
                  ...x, entries: x.entries.filter((e) => e.key !== en.key), removedEntries: en.id ? [...x.removedEntries, en.id] : x.removedEntries,
                }))}>Убрать</button>
              )}
            </div>
            <Field label="Техника">
              <Select value={en.vehicle} onChange={(v) => setEntry(en.key, { vehicle: v })} placeholder="Без техники"
                options={activeVehicles.map((v) => ({ value: v.id, label: vehicleLabel(v) }))} />
            </Field>
            <div className="field">
              <span className="label">За что</span>
              <div className="chips" role="radiogroup">
                {WORK_UNITS.slice(0, 4).concat(WORK_UNITS.slice(4).filter((u) => u === en.unit)).map((u) => (
                  <button key={u} type="button" role="radio" aria-checked={en.unit === u} className={'chip' + (en.unit === u ? ' on' : '')}
                    onClick={() => setEntry(en.key, { unit: u })}>{UNITS[u].label}</button>
                ))}
                <select className="chip" aria-label="Другая единица" value="" onChange={(e) => e.target.value && setEntry(en.key, { unit: e.target.value })}>
                  <option value="">Ещё…</option>
                  {WORK_UNITS.slice(4).map((u) => <option key={u} value={u}>{UNITS[u].label}</option>)}
                </select>
              </div>
            </div>
            {en.unit === 'tkm' ? (
              <div className="field-row">
                <Field label="Тонн"><input inputMode="decimal" value={en.tons} onChange={(e) => setEntry(en.key, { tons: e.target.value })} /></Field>
                <Field label="Километров"><input inputMode="decimal" value={en.km} onChange={(e) => setEntry(en.key, { km: e.target.value })} /></Field>
              </div>
            ) : en.unit === 'km' ? (
              <Field label="Километров"><input inputMode="decimal" value={en.km} onChange={(e) => setEntry(en.key, { km: e.target.value })} /></Field>
            ) : en.unit === 'ton' ? (
              <Field label="Тонн"><input inputMode="decimal" value={en.tons} onChange={(e) => setEntry(en.key, { tons: e.target.value })} /></Field>
            ) : (
              <Field label={en.unit === 'shift' ? 'Смен' : UNITS[en.unit].q} hint={en.unit === 'shift' ? 'Обычно 1' : ''}>
                <input inputMode="decimal" placeholder={en.unit === 'shift' ? '1' : ''} value={en.quantity} onChange={(e) => setEntry(en.key, { quantity: e.target.value })} />
              </Field>
            )}
            {contractItems.length > 0 && (
              <div className="field-row">
                <Field label="Позиция контракта" hint="Если не выбрать — подберётся сама">
                  <Select value={en.contract_item} onChange={(v) => setEntry(en.key, { contract_item: v })} placeholder="Подобрать"
                    options={contractItems.map((it) => ({ value: it.id, label: `${it.name}, ${UNITS[it.unit] ? UNITS[it.unit].short : it.unit}` }))} />
                </Field>
                {en.contract_item && refs.item[en.contract_item] && refs.item[en.contract_item].unit !== en.unit && (
                  <Field label={`Для заказчика, ${UNITS[refs.item[en.contract_item].unit].short}`}>
                    <input inputMode="decimal" value={en.bill_qty} onChange={(e) => setEntry(en.key, { bill_qty: e.target.value })} />
                  </Field>
                )}
              </div>
            )}
            {!en.epl ? (
              <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setEntry(en.key, { epl: true })}>
                <Icon name="plus" size={18} />Путевой: одометр, топливо
              </button>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                <Field label="№ путевого листа"><input value={en.waybill_no} onChange={(e) => setEntry(en.key, { waybill_no: e.target.value })} /></Field>
                <div className="field-row">
                  <Field label="Одометр, выезд"><input inputMode="decimal" value={en.odometer_start} onChange={(e) => setEntry(en.key, { odometer_start: e.target.value })} /></Field>
                  <Field label="Одометр, возврат"><input inputMode="decimal" value={en.odometer_end} onChange={(e) => setEntry(en.key, { odometer_end: e.target.value })} /></Field>
                </div>
                <div className="field-row">
                  <Field label="Моточасы, выезд"><input inputMode="decimal" value={en.engine_hours_start} onChange={(e) => setEntry(en.key, { engine_hours_start: e.target.value })} /></Field>
                  <Field label="Моточасы, возврат"><input inputMode="decimal" value={en.engine_hours_end} onChange={(e) => setEntry(en.key, { engine_hours_end: e.target.value })} /></Field>
                </div>
                <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <Field label="Топливо, выезд"><input inputMode="decimal" value={en.fuel_start} onChange={(e) => setEntry(en.key, { fuel_start: e.target.value })} /></Field>
                  <Field label="Заправлено"><input inputMode="decimal" value={en.fuel_added} onChange={(e) => setEntry(en.key, { fuel_added: e.target.value })} /></Field>
                  <Field label="Возврат"><input inputMode="decimal" value={en.fuel_end} onChange={(e) => setEntry(en.key, { fuel_end: e.target.value })} /></Field>
                </div>
              </div>
            )}
            {errs[en.key] && <span className="small" style={{ color: 'var(--danger)' }}>{errs[en.key]}</span>}
          </div>
        ))}
        <Button onClick={() => setForm((x) => ({ ...x, entries: [...x.entries, blankEntry(x.entries[x.entries.length - 1])] }))}>
          <Icon name="plus" size={20} />Ещё строка — другая техника или работа
        </Button>
      </section>

      <section className="stack">
        <h2 className="h2">Фото документов</h2>
        <PhotoKinds form={form} setForm={setForm} onAdd={addPhotos} />
      </section>

      <Field label="Комментарий">
        <textarea value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="Если нужно что-то пояснить" />
      </Field>

      <ErrorBox text={err} />
      <div className="stack" style={{ gap: 8 }}>
        <Button variant="primary" size="lg" block busy={busy} onClick={() => save('submitted')}><Icon name="check" />Отправить на проверку</Button>
        <Button block disabled={busy} onClick={() => save('draft')}>Сохранить черновик</Button>
      </div>
    </div>
  );
}

function PhotoKinds({ form, setForm, onAdd }) {
  const [kind, setKind] = useState('waybill');
  const [urls, setUrls] = useState({});
  useEffect(() => {
    let alive = true;
    if (!form.oldDocs.length) return undefined;
    fileToken().then((t) => {
      if (!alive) return;
      const u = {};
      for (const d of form.oldDocs) if (d.files && d.files[0]) u[d.id] = fileUrl(d, d.files[0], t, '480x0');
      setUrls(u);
    }).catch(() => {});
    return () => { alive = false; };
  }, [form.oldDocs]);
  const oldVisible = form.oldDocs.filter((d) => !form.removedDocs.includes(d.id));
  return (
    <>
      <div className="chips">
        {['waybill', 'ttn', 'act', 'receipt', 'photo'].map((k) => (
          <button key={k} type="button" className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{DOC_KINDS[k]}</button>
        ))}
      </div>
      <div className="photos">
        {oldVisible.map((d) => (
          <div key={d.id} className="photo">
            {urls[d.id] ? <img src={urls[d.id]} alt={DOC_KINDS[d.kind]} /> : null}
            <span className="tag">{DOC_KINDS[d.kind]}</span>
            <button type="button" className="x" aria-label="Убрать фото" onClick={() => setForm((x) => ({ ...x, removedDocs: [...x.removedDocs, d.id] }))}><Icon name="x" size={16} /></button>
          </div>
        ))}
        {form.photos.map((p) => (
          <div key={p.key} className="photo">
            <BlobImg blob={p.blob} alt={DOC_KINDS[p.kind]} />
            <span className="tag">{DOC_KINDS[p.kind]}</span>
            <button type="button" className="x" aria-label="Убрать фото" onClick={() => setForm((x) => ({ ...x, photos: x.photos.filter((y) => y.key !== p.key) }))}><Icon name="x" size={16} /></button>
          </div>
        ))}
        <PhotoAdd label={DOC_KINDS[kind]} onAdd={(files) => onAdd(files, kind)} />
      </div>
      <p className="note">Фото сжимаются на телефоне. Без связи они подождут и отправятся вместе со сменой.</p>
    </>
  );
}

// ---------- просмотр и проверка ----------
export function ShiftView({ params, outbox }) {
  const s = useSession();
  const toast = useToast();
  const refs = useRefs(s.companyId);
  const q = useQuery('shift:' + params.id, () => pb.collection('shifts').getOne(params.id, { expand: 'shift_entries_via_shift,documents_via_shift' }));
  const bill = useQuery(s.isMoney && 'bill:' + params.id, async () => {
    const r = await pb.collection('shift_bills').getList(1, 1, { filter: f('shift = {:s}', { s: params.id }) });
    return r.items[0] || null;
  });
  const [urls, setUrls] = useState({});
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [photo, setPhoto] = useState(null);
  const sh = q.data;
  const docs = (sh && sh.expand && sh.expand.documents_via_shift) || [];
  const entries = (sh && sh.expand && sh.expand.shift_entries_via_shift) || [];
  const pendingHere = (outbox || []).some((i) => i.id === params.id || (i.data && i.data.shift === params.id));

  useEffect(() => {
    let alive = true;
    if (!docs.length) return undefined;
    fileToken().then((t) => {
      if (!alive) return;
      const u = {};
      for (const d of docs) for (const fn of d.files || []) u[d.id + fn] = { thumb: fileUrl(d, fn, t, '480x0'), full: fileUrl(d, fn, t) };
      setUrls(u);
    }).catch(() => {});
    return () => { alive = false; };
  }, [docs.map((d) => d.id).join()]); // eslint-disable-line

  if (q.loading && !sh) return <Loading />;
  if (!sh) return <><PageTitle title="Смена" backTo="/shifts" /><ErrorBox text={q.error || 'Смена ещё не дошла до сервера'} onRetry={q.reload} /></>;

  const st = SHIFT_STATUS[sh.status] || {};
  const mine = sh.member === s.membership.id;
  const canEdit = sh.status !== 'confirmed' && (mine || s.is(['owner', 'manager', 'dispatcher']));
  const calcLines = (sh.calc && sh.calc.lines) || [];
  const who = refs.member[sh.member];

  async function setStatus(status, extra = {}) {
    setBusy(status); setErr('');
    try {
      await pb.collection('shifts').update(sh.id, { status, ...extra });
      toast(status === 'confirmed' ? 'Смена подтверждена' : status === 'rejected' ? 'Смена возвращена водителю' : status === 'submitted' ? 'Отправлено на проверку' : 'Подтверждение снято');
      setReject(false);
      q.reload(); bill.reload();
    } catch (e) { setErr(errText(e)); } finally { setBusy(''); }
  }
  async function remove() {
    if (!window.confirm('Удалить черновик смены?')) return;
    try { await pb.collection('shifts').delete(sh.id); toast('Черновик удалён'); go('/shifts', { replace: true }); } catch (e) { setErr(errText(e)); }
  }

  return (
    <div className="stack-lg">
      <PageTitle title={dayLabel(sh.date)} eyebrow={s.isOffice && who ? who.display_name : 'Смена'} backTo="/shifts">
        <Badge tone={pendingHere ? 'warning' : st.tone}>{pendingHere ? 'Отправляется' : st.label}</Badge>
      </PageTitle>
      {sh.status === 'rejected' && sh.reject_reason && <div className="alert danger"><Icon name="alert" size={20} /><span>Вернули: {sh.reject_reason}</span></div>}

      <section className="card card-pad">
        <div className="row between">
          <span className="muted">Объект</span><b>{refs.site[sh.site] ? refs.site[sh.site].name : '—'}</b>
        </div>
        {(sh.night || sh.holiday) && <div className="row">{sh.night && <Badge tone="info">Ночная</Badge>}{sh.holiday && <Badge tone="info">Праздник</Badge>}</div>}
        {sh.note && <p className="note">{sh.note}</p>}
      </section>

      <section className="list">
        {entries.length === 0 && <Empty>В смене нет строк</Empty>}
        {entries.map((e) => {
          const line = calcLines.find((l) => l.entry === e.id);
          const v = refs.vehicle[e.vehicle];
          const km = e.odometer_end && e.odometer_start ? e.odometer_end - e.odometer_start : 0;
          return (
            <div key={e.id} className="list-item" style={{ cursor: 'default' }}>
              <div className="t">
                <b>{v ? vehicleLabel(v) : 'Без техники'}</b>
                <span>{entrySummary({ ...e, vehicle: '' }, refs)}{e.contract_item && refs.item[e.contract_item] ? ' · ' + refs.item[e.contract_item].name : ''}</span>
                {(e.waybill_no || km > 0 || e.fuel_start > 0) && (
                  <span>{[e.waybill_no && 'путевой №' + e.waybill_no, km > 0 && `${qty(e.odometer_start)} → ${qty(e.odometer_end)} км (${qty(km)})`,
                    e.fuel_start > 0 && `топливо ${qty(e.fuel_start)} + ${qty(e.fuel_added || 0)} → ${qty(e.fuel_end || 0)} л`].filter(Boolean).join(' · ')}</span>
                )}
              </div>
              {line && <div className="r"><span className="num">{rub(line.amount_kop)}</span><span className="small subtle num">{rub(line.rate_kop)} × {qty(line.quantity)}</span></div>}
            </div>
          );
        })}
        {sh.status === 'confirmed' && sh.amount_kop !== null && (
          <div className="list-item" style={{ cursor: 'default' }}>
            <div className="t"><b>Итого за смену</b></div><div className="r"><b className="num">{rub(sh.amount_kop)}</b></div>
          </div>
        )}
      </section>

      {bill.data && (
        <section className="card card-pad">
          <div className="row between"><span className="section-label">Выручка по контракту</span><b className="num">{rub(bill.data.amount_kop)}</b></div>
          {bill.data.status === 'incomplete' && <div className="alert warning small"><Icon name="alert" size={18} /><span>Не всё выставлено: {(bill.data.missing || []).map((m) => m.reason).join('; ')}</span></div>}
        </section>
      )}

      {docs.length > 0 && (
        <section className="stack">
          <h2 className="h2">Документы</h2>
          <div className="photos">
            {docs.flatMap((d) => (d.files || []).map((fn) => (
              <button type="button" key={d.id + fn} className="photo" style={{ padding: 0, cursor: 'zoom-in' }} onClick={() => setPhoto(urls[d.id + fn])}>
                {urls[d.id + fn] && (/\.pdf$/i.test(fn) ? <span className="small" style={{ padding: 8 }}>PDF</span> : <img src={urls[d.id + fn].thumb} alt={DOC_KINDS[d.kind]} />)}
                <span className="tag">{DOC_KINDS[d.kind]}</span>
              </button>
            )))}
          </div>
        </section>
      )}

      <ErrorBox text={err} />
      {err && /ставк/.test(err) && s.isMgmt && <Link to="/rates" className="btn">Открыть ставки</Link>}

      <div className="stack" style={{ gap: 8 }}>
        {s.isMgmt && sh.status === 'submitted' && (
          <Button variant="primary" size="lg" block busy={busy === 'confirmed'} onClick={() => setStatus('confirmed')}><Icon name="check" />Подтвердить</Button>
        )}
        {s.is(['owner', 'manager', 'dispatcher']) && sh.status === 'submitted' && (
          <Button block onClick={() => setReject(true)}>Вернуть на доработку</Button>
        )}
        {mine && (sh.status === 'draft' || sh.status === 'rejected') && (
          <Button variant="primary" size="lg" block busy={busy === 'submitted'} onClick={() => setStatus('submitted')}>Отправить на проверку</Button>
        )}
        {canEdit && <Link to={`/shift/${sh.id}/edit`} className="btn block">Исправить</Link>}
        {s.isMgmt && sh.status === 'confirmed' && (
          <Button block variant="ghost" busy={busy === 'submitted'} onClick={() => { if (window.confirm('Снять подтверждение? Сумма смены пересчитается при повторном подтверждении.')) setStatus('submitted'); }}>Снять подтверждение</Button>
        )}
        {sh.status === 'draft' && (mine || s.isMgmt) && <Button block variant="ghost" className="danger" onClick={remove}>Удалить черновик</Button>}
      </div>

      {reject && (
        <Sheet title="Вернуть на доработку" onClose={() => setReject(false)}>
          <Field label="Что исправить" hint="Водитель увидит это сообщение">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Например: нет фото путевого" />
          </Field>
          <Button variant="primary" block busy={busy === 'rejected'} disabled={!reason.trim()} onClick={() => setStatus('rejected', { reject_reason: reason.trim() })}>Вернуть</Button>
        </Sheet>
      )}
      {photo && (
        <Sheet title="Документ" onClose={() => setPhoto(null)}>
          <img src={photo.full} alt="" style={{ width: '100%', borderRadius: 12 }} />
          <a className="btn block" href={photo.full} target="_blank" rel="noreferrer"><Icon name="download" />Открыть оригинал</a>
        </Sheet>
      )}
    </div>
  );
}

export const shiftsWord = (n) => `${n} ${plural(n, 'смена', 'смены', 'смен')}`;
