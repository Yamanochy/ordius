// Люди: заявки, сотрудники, приглашения, роли, увольнение, вахты, ставки человека.
import React, { useState } from 'react';
import { pb, errText } from '../lib/pb.js';
import { useSession } from '../lib/session.jsx';
import { useQuery } from '../lib/data.js';
import { useRefs } from '../lib/refs.js';
import { Link } from '../lib/router.jsx';
import { ROLES, ROTATION_STATUS, UNITS, normalizePhone, prettyPhone, shortDay, pbDate, day10, isoDay, addDays, rub, dayLabel } from '../lib/format.js';
import { Button, Badge, Field, Select, Icon, PageTitle, ErrorBox, Loading, Sheet, Seg, useToast } from '../ui.jsx';
import { RateSheet } from './Directory.jsx';

const f = (expr, params) => pb.filter(expr, params);
const ROLE_ORDER = ['driver', 'mechanic', 'dispatcher', 'accountant', 'manager', 'owner'];

function RoleChips({ value, onChange, allowOwner }) {
  return (
    <div className="chips">
      {ROLE_ORDER.filter((r) => r !== 'owner' || allowOwner).map((r) => {
        const on = value.includes(r);
        return <button key={r} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on}
          onClick={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}>{ROLES[r]}</button>;
      })}
    </div>
  );
}

export function People() {
  const s = useSession();
  const toast = useToast();
  const q = useQuery(`members:${s.companyId}`, () => pb.collection('memberships').getFullList({ filter: f('company = {:c}', { c: s.companyId }), sort: 'display_name' }));
  const [tab, setTab] = useState('active');
  const [add, setAdd] = useState(false);
  const [approve, setApprove] = useState(null);
  const list = q.data || [];
  const pending = list.filter((m) => m.status === 'pending');
  const shown = list.filter((m) => (tab === 'active' ? m.status === 'active' : m.status === 'dismissed'));
  return (
    <div className="stack-lg">
      <PageTitle title="Люди">
        {s.isMgmt && <Button variant="primary" onClick={() => setAdd(true)}><Icon name="plus" size={20} />Добавить</Button>}
      </PageTitle>
      <ErrorBox text={q.error} onRetry={q.reload} />
      {pending.length > 0 && (
        <section className="stack">
          <h2 className="h2">Заявки</h2>
          <div className="list">
            {pending.map((m) => (
              <div key={m.id} className="list-item" style={{ cursor: 'default' }}>
                <div className="t"><b>{m.display_name}</b><span>{prettyPhone(m.phone)} · вступил по коду компании</span></div>
                {s.isMgmt && <Button size="sm" variant="primary" onClick={() => setApprove(m)}>Одобрить</Button>}
              </div>
            ))}
          </div>
        </section>
      )}
      <Seg value={tab} onChange={setTab} label="Показать" options={[{ value: 'active', label: 'Работают' }, { value: 'dismissed', label: 'Уволены' }]} />
      {q.loading && !q.data ? <Loading /> : (
        <div className="list">
          {shown.length === 0 && <div className="list-empty">Никого</div>}
          {shown.map((m) => (
            <Link key={m.id} to={'/people/' + m.id} className="list-item">
              <div className="t">
                <b>{m.display_name}{m.personnel_no ? <span className="subtle num"> · №{m.personnel_no}</span> : null}</b>
                <span>{(m.roles || []).map((r) => ROLES[r]).join(', ')}{!m.user && m.status === 'active' ? ' · ещё не вошёл в приложение' : ''}</span>
              </div>
              <Icon name="chevron" size={18} />
            </Link>
          ))}
        </div>
      )}
      {add && <AddPerson onClose={() => setAdd(false)} onDone={(m) => { setAdd(false); q.reload(); toast('Сотрудник добавлен'); window.location.hash = '/people/' + m.id; }} />}
      {approve && (
        <ApproveSheet m={approve} onClose={() => setApprove(null)} onDone={() => { setApprove(null); q.reload(); toast('Одобрено'); }} />
      )}
    </div>
  );
}

function ApproveSheet({ m, onClose, onDone }) {
  const [roles, setRoles] = useState(['driver']);
  const [no, setNo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr('');
    try { await pb.collection('memberships').update(m.id, { status: 'active', roles, personnel_no: no, hired_on: pbDate(isoDay()) }); onDone(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  async function decline() {
    if (!window.confirm('Отклонить заявку?')) return;
    try { await pb.collection('memberships').update(m.id, { status: 'dismissed' }); onDone(); } catch (e) { setErr(errText(e)); }
  }
  return (
    <Sheet title={m.display_name} onClose={onClose}>
      <span className="label muted small">Роли</span>
      <RoleChips value={roles} onChange={setRoles} />
      <Field label="Табельный номер" hint="Необязательно"><input value={no} onChange={(e) => setNo(e.target.value)} /></Field>
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} disabled={!roles.length} onClick={save}>Одобрить</Button>
      <Button block variant="ghost" className="danger" onClick={decline}>Отклонить</Button>
    </Sheet>
  );
}

function AddPerson({ onClose, onDone }) {
  const s = useSession();
  const [form, setForm] = useState({ display_name: '', phone: '', roles: ['driver'], personnel_no: '', hired_on: isoDay() });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    const phone = form.phone ? normalizePhone(form.phone) : '';
    if (form.display_name.trim().length < 2) { setErr('Укажите ФИО'); return; }
    if (form.phone && !phone) { setErr('Телефон записан не полностью'); return; }
    setBusy(true); setErr('');
    try {
      const m = await pb.collection('memberships').create({ company: s.companyId, display_name: form.display_name.trim(), phone, roles: form.roles, status: 'active', personnel_no: form.personnel_no, hired_on: pbDate(form.hired_on) });
      onDone(m);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet title="Новый сотрудник" onClose={onClose}>
      <Field label="ФИО"><input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} autoFocus /></Field>
      <Field label="Мобильный" hint="По этому номеру человек зарегистрируется и сразу увидит приглашение — коды не нужны">
        <input type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="8 9XX XXX-XX-XX" />
      </Field>
      <span className="label muted small">Роли</span>
      <RoleChips value={form.roles} onChange={(roles) => setForm({ ...form, roles })} />
      <div className="field-row">
        <Field label="Табельный №"><input value={form.personnel_no} onChange={(e) => setForm({ ...form, personnel_no: e.target.value })} /></Field>
        <Field label="Принят"><input type="date" value={form.hired_on} onChange={(e) => setForm({ ...form, hired_on: e.target.value })} /></Field>
      </div>
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} disabled={!form.roles.length} onClick={save}>Добавить</Button>
    </Sheet>
  );
}

export function Person({ params }) {
  const s = useSession();
  const toast = useToast();
  const refs = useRefs(s.companyId);
  const q = useQuery('member:' + params.id, () => pb.collection('memberships').getOne(params.id));
  const rates = useQuery(s.isMoney && 'mrates:' + params.id, () => pb.collection('rates').getFullList({ filter: f('member = {:m}', { m: params.id }), sort: '-valid_from' }));
  const rots = useQuery('mrot:' + params.id, () => pb.collection('rotations').getFullList({ filter: f('member = {:m}', { m: params.id }), sort: '-date_from' }));
  const [edit, setEdit] = useState(null);
  const [code, setCode] = useState(null);
  const [rateSheet, setRateSheet] = useState(false);
  const [rotSheet, setRotSheet] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const m = q.data;
  if (q.loading && !m) return <Loading />;
  if (!m) return <ErrorBox text={q.error} onRetry={q.reload} />;
  const form = edit || m;
  const isOwnerMe = s.is(['owner']);

  async function save() {
    setBusy('save'); setErr('');
    try {
      await pb.collection('memberships').update(m.id, { display_name: form.display_name, roles: form.roles, personnel_no: form.personnel_no, no_ndfl: !!form.no_ndfl, phone: m.user ? undefined : (normalizePhone(form.phone) || form.phone) });
      setEdit(null); q.reload(); refs.reload(); toast('Сохранено');
    } catch (e) { setErr(errText(e)); } finally { setBusy(''); }
  }
  async function dismiss(back) {
    if (!back && !window.confirm(`Уволить ${m.display_name}? Доступ закроется сразу, история смен и выплат останется.`)) return;
    setBusy('dismiss'); setErr('');
    try { await pb.collection('memberships').update(m.id, back ? { status: 'active', dismissed_on: '' } : { status: 'dismissed' }); q.reload(); toast(back ? 'Снова в работе' : 'Уволен'); }
    catch (e) { setErr(errText(e)); } finally { setBusy(''); }
  }
  async function invite() {
    setBusy('inv'); setErr('');
    try { const r = await pb.send(`/api/ordius/memberships/${m.id}/invite`, { method: 'POST' }); setCode({ kind: 'invite', ...r }); }
    catch (e) { setErr(errText(e)); } finally { setBusy(''); }
  }
  async function passCode() {
    setBusy('pc'); setErr('');
    try { const r = await pb.send(`/api/ordius/memberships/${m.id}/password-code`, { method: 'POST' }); setCode({ kind: 'password', ...r }); }
    catch (e) { setErr(errText(e)); } finally { setBusy(''); }
  }

  return (
    <div className="stack-lg">
      <PageTitle title={m.display_name} eyebrow={(m.roles || []).map((r) => ROLES[r]).join(', ')} backTo="/people">
        {m.status === 'dismissed' && <Badge tone="danger">Уволен</Badge>}
      </PageTitle>
      <section className="card card-pad">
        {m.phone && <div className="row between"><span className="muted">Телефон</span><a href={'tel:' + m.phone}>{prettyPhone(m.phone)}</a></div>}
        <div className="row between"><span className="muted">В приложении</span>{m.user ? <Badge tone="success">Вошёл</Badge> : <Badge>Ещё не входил</Badge>}</div>
        {m.hired_on && <div className="row between"><span className="muted">Принят</span><span>{dayLabel(m.hired_on, true)}</span></div>}
        {m.dismissed_on && <div className="row between"><span className="muted">Уволен</span><span>{dayLabel(m.dismissed_on, true)}</span></div>}
      </section>

      {s.isMgmt && (
        <section className="card card-pad">
          <span className="section-label">Данные и роли</span>
          <Field label="ФИО"><input value={form.display_name} onChange={(e) => setEdit({ ...form, display_name: e.target.value })} /></Field>
          {!m.user && <Field label="Мобильный" hint="По нему человек увидит приглашение после регистрации"><input type="tel" value={form.phone || ''} onChange={(e) => setEdit({ ...form, phone: e.target.value })} /></Field>}
          <RoleChips value={form.roles || []} onChange={(roles) => setEdit({ ...form, roles })} allowOwner={isOwnerMe} />
          <div className="field-row">
            <Field label="Табельный №"><input value={form.personnel_no || ''} onChange={(e) => setEdit({ ...form, personnel_no: e.target.value })} /></Field>
            <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={!!form.no_ndfl} onChange={(e) => setEdit({ ...form, no_ndfl: e.target.checked })} />НДФЛ не удерживается</label>
          </div>
          {edit && <Button variant="primary" busy={busy === 'save'} onClick={save}>Сохранить</Button>}
        </section>
      )}

      {s.isMoney && (
        <section className="stack">
          <div className="row between">
            <h2 className="h2">Личные ставки</h2>
            {s.isMgmt && <Button size="sm" onClick={() => setRateSheet(true)}><Icon name="plus" size={18} />Ставка</Button>}
          </div>
          <div className="list">
            {(rates.data || []).length === 0 && <div className="list-empty">Личных ставок нет — действуют общие ставки компании</div>}
            {(rates.data || []).map((r) => (
              <div key={r.id} className="list-item" style={{ cursor: 'default' }}>
                <div className="t"><b>{UNITS[r.unit] ? UNITS[r.unit].label : r.unit}{r.name ? ' · ' + r.name : ''}</b><span>с {shortDay(r.valid_from)}{r.valid_to ? ' по ' + shortDay(r.valid_to) : ''}{r.vehicle && refs.vehicle[r.vehicle] ? ' · ' + refs.vehicle[r.vehicle].name : ''}</span></div>
                <span className="num">{rub(r.amount_kop)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="stack">
        <div className="row between">
          <h2 className="h2">Вахты</h2>
          {s.is(['owner', 'manager', 'dispatcher']) && <Button size="sm" onClick={() => setRotSheet({})}><Icon name="plus" size={18} />Вахта</Button>}
        </div>
        <div className="list">
          {(rots.data || []).length === 0 && <div className="list-empty">Вахт нет</div>}
          {(rots.data || []).map((r) => (
            <button key={r.id} type="button" className="list-item" onClick={() => s.is(['owner', 'manager', 'dispatcher']) && setRotSheet(r)}>
              <div className="t"><b>{shortDay(r.date_from)} — {shortDay(r.date_to)}</b><span>{refs.site[r.site] ? refs.site[r.site].name : 'Объект не указан'}</span></div>
              <Badge tone={r.status === 'active' ? 'success' : r.status === 'planned' ? 'info' : ''}>{ROTATION_STATUS[r.status]}</Badge>
            </button>
          ))}
        </div>
      </section>

      {s.isMgmt && (
        <section className="stack" style={{ gap: 8 }}>
          {!m.user && m.status === 'active' && <Button busy={busy === 'inv'} onClick={invite}>Выдать личный код приглашения</Button>}
          {m.user && m.status === 'active' && m.user !== s.user.id && <Button busy={busy === 'pc'} onClick={passCode}>Код для смены пароля</Button>}
          {m.status === 'active' && m.user !== s.user.id && <Button variant="ghost" className="danger" busy={busy === 'dismiss'} onClick={() => dismiss(false)}>Уволить</Button>}
          {m.status === 'dismissed' && <Button busy={busy === 'dismiss'} onClick={() => dismiss(true)}>Вернуть на работу</Button>}
        </section>
      )}
      <ErrorBox text={err} />

      {code && (
        <Sheet title={code.kind === 'invite' ? 'Личный код приглашения' : 'Код для смены пароля'} onClose={() => setCode(null)}>
          <span className="num" style={{ fontSize: 32, letterSpacing: '.14em', textAlign: 'center' }}>{code.code}</span>
          <p className="note">{code.kind === 'invite'
            ? 'Передайте код человеку: он вводит его в приложении после регистрации и сразу попадает в компанию. Код действует 7 дней и срабатывает один раз.'
            : 'Человек открывает «Забыли пароль? → У меня код от руководителя», вводит свой номер, этот код и новый пароль. Код действует сутки.'}</p>
          <Button variant="primary" block onClick={() => { navigator.clipboard && navigator.clipboard.writeText(code.code); toast('Код скопирован'); }}>Скопировать</Button>
        </Sheet>
      )}
      {rateSheet && <RateSheet member={m.id} onClose={() => setRateSheet(false)} onDone={() => { setRateSheet(false); rates.reload(); toast('Ставка добавлена'); }} />}
      {rotSheet && <RotationSheet member={m.id} rot={rotSheet} onClose={() => setRotSheet(null)} onDone={() => { setRotSheet(null); rots.reload(); toast('График сохранён'); }} />}
    </div>
  );
}

function RotationSheet({ member, rot, onClose, onDone }) {
  const s = useSession();
  const refs = useRefs(s.companyId);
  const [form, setForm] = useState({ date_from: day10(rot.date_from) || isoDay(), date_to: day10(rot.date_to) || addDays(isoDay(), 44), site: rot.site || '', status: rot.status || 'planned', note: rot.note || '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr('');
    const data = { date_from: pbDate(form.date_from), date_to: pbDate(form.date_to), site: form.site, status: form.status, note: form.note };
    try {
      if (rot.id) await pb.collection('rotations').update(rot.id, data);
      else await pb.collection('rotations').create({ company: s.companyId, member, ...data });
      onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet title={rot.id ? 'Вахта' : 'Новая вахта'} onClose={onClose}>
      <div className="field-row">
        <Field label="С"><input type="date" value={form.date_from} onChange={(e) => setForm({ ...form, date_from: e.target.value })} /></Field>
        <Field label="По"><input type="date" value={form.date_to} onChange={(e) => setForm({ ...form, date_to: e.target.value })} /></Field>
      </div>
      <div className="chips">
        {[15, 30, 45, 60].map((n) => <button key={n} type="button" className="chip" onClick={() => setForm({ ...form, date_to: addDays(form.date_from, n - 1) })}>{n} дн.</button>)}
      </div>
      <Field label="Объект"><Select value={form.site} onChange={(v) => setForm({ ...form, site: v })} placeholder="Не указан" options={refs.sites.map((x) => ({ value: x.id, label: x.name }))} /></Field>
      <Field label="Статус" hint="Суточные начисляются за дни вахт «Идёт» (по сегодня) и «Закончена»">
        <Select value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={Object.entries(ROTATION_STATUS).map(([value, label]) => ({ value, label }))} />
      </Field>
      <Field label="Заметка"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} onClick={save}>Сохранить</Button>
    </Sheet>
  );
}
