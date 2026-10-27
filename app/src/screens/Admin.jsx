// Администратор Ordius: коды подключения компаний. Раздел виден только номерам из ORDIUS_ADMIN_PHONES на сервере.
// На пилоте компанию создаёт только тот, кому выдан код: код вводится при «Я руководитель — создать компанию».
import React, { useState } from 'react';
import { pb, errText } from '../lib/pb.js';
import { useQuery } from '../lib/data.js';
import { Link } from '../lib/router.jsx';
import { dayLabel, day10, isoDay, prettyPhone } from '../lib/format.js';
import { Button, Badge, Field, Icon, PageTitle, ErrorBox, Loading, Sheet, Select, Seg, useToast } from '../ui.jsx';

// Ответ /api/ordius/me: администратор ли и нужен ли код для новой компании. Без связи — «код нужен».
export function useMe() {
  const uid = pb.authStore.record ? pb.authStore.record.id : '';
  const q = useQuery(uid ? 'me:' + uid : '', () => pb.send('/api/ordius/me', {}), { cache: true, refreshOnSync: false });
  return { admin: !!(q.data && q.data.platform_admin), codeRequired: !(q.data && q.data.company_code_required === false), loading: q.loading };
}

const inviteText = (code) =>
  `Код подключения к Ordius: ${code}\n\n` +
  '1. Откройте app.ordius.ru на телефоне и зарегистрируйтесь по своему номеру.\n' +
  '2. Нажмите «Я руководитель — создать компанию», впишите название и этот код, отметьте условия.\n' +
  '3. Добавьте сотрудников в разделе «Люди» с их номерами: приглашение они увидят, когда зарегистрируются в app.ordius.ru.';

const MONO = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' };

function state(c) {
  if (c.used >= c.max_uses) return { label: 'Использован', tone: '', active: false };
  if (c.expires && c.expires.replace(' ', 'T') <= new Date().toISOString()) return { label: 'Не действует', tone: '', active: false };
  return { label: 'Действует', tone: 'success', active: true };
}

export function ConnectCodes() {
  const toast = useToast();
  const me = useMe();
  const q = useQuery(me.admin ? 'connect-codes' : '', () => pb.send('/api/ordius/connect-codes', {}), { cache: false });
  const [sheet, setSheet] = useState(false);
  const [shown, setShown] = useState(null);
  const [err, setErr] = useState('');

  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg); } catch (_) { setErr('Не получилось скопировать — выделите текст вручную'); }
  }
  async function revoke(c) {
    setErr('');
    try { await pb.send(`/api/ordius/connect-codes/${c.id}/revoke`, { method: 'POST' }); q.reload(); toast('Код отозван'); } catch (e) { setErr(errText(e)); }
  }

  if (me.loading && !me.admin) return <Loading />;
  if (!me.admin) return <div className="stack"><PageTitle title="Коды подключения" backTo="/more" /><p className="note">Раздел только для администратора Ordius.</p></div>;
  const items = (q.data && q.data.items) || [];
  return (
    <div className="stack-lg">
      <PageTitle title="Коды подключения" eyebrow="Администратор Ordius" backTo="/more">
        <Button variant="primary" onClick={() => setSheet(true)}><Icon name="plus" size={20} />Новый код</Button>
      </PageTitle>
      <p className="note">На пилоте компанию создаёт только тот, кому вы выдали код. Код вводят в приложении: «Я руководитель — создать компанию».</p>
      <ErrorBox text={err || q.error} />
      {q.loading && !items.length ? <Loading /> : (
        <div className="list">
          {items.length === 0 && <div className="list-empty">Кодов пока нет</div>}
          {items.map((c) => {
            const st = state(c);
            return (
              <button key={c.id} type="button" className="list-item" onClick={() => st.active && setShown(c)}>
                <div className="t">
                  <b><span style={MONO}>{c.code}</span> · {c.note}</b>
                  <span>
                    {`Компаний: ${c.used} из ${c.max_uses}`}
                    {c.expires ? ` · до ${dayLabel(day10(c.expires), day10(c.expires).slice(0, 4) !== isoDay().slice(0, 4))}` : ''}
                    {c.companies.length ? ` · ${c.companies.map((x) => x.name).join(', ')}` : ''}
                  </span>
                </div>
                <div className="r"><Badge tone={st.tone}>{st.label}</Badge></div>
              </button>
            );
          })}
        </div>
      )}
      {sheet && <NewCodeSheet onClose={() => setSheet(false)} onDone={(c) => { setSheet(false); q.reload(); setShown(c); }} />}
      {shown && (
        <Sheet title="Код подключения" onClose={() => setShown(null)}>
          <p className="note" style={{ margin: 0 }}>Для: {shown.note}</p>
          <div style={{ ...MONO, fontSize: 32, lineHeight: '40px', letterSpacing: '0.12em', textAlign: 'center', padding: '8px 0' }}>{shown.code}</div>
          <p className="note">Отправьте клиенту сообщение целиком — в нём код и что делать.</p>
          <div className="small" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', borderRadius: 12, padding: '12px 14px' }}>{inviteText(shown.code)}</div>
          <Button variant="primary" block onClick={() => copy(inviteText(shown.code), 'Сообщение скопировано')}>Скопировать сообщение</Button>
          <Button block onClick={() => copy(shown.code, 'Код скопирован')}>Скопировать только код</Button>
          <Button block variant="ghost" className="danger" onClick={() => { revoke(shown); setShown(null); }}>Отозвать код</Button>
        </Sheet>
      )}
    </div>
  );
}

function NewCodeSheet({ onClose, onDone }) {
  const [form, setForm] = useState({ note: '', max_uses: '1', days: '30' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (form.note.trim().length < 2) { setErr('Укажите, кому код'); return; }
    setBusy(true); setErr('');
    try {
      const c = await pb.send('/api/ordius/connect-codes', { method: 'POST', body: { note: form.note.trim(), max_uses: Number(form.max_uses) || 1, days: Number(form.days) || 30 } });
      onDone(c);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet title="Новый код подключения" onClose={onClose}>
      <Field label="Кому" hint="Название компании или имя — чтобы потом понять, чей код"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="ИП Мандров С.Н." autoFocus /></Field>
      <div className="field-row">
        <Field label="Компаний по коду"><input inputMode="numeric" value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Действует, дней"><input inputMode="numeric" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value.replace(/\D/g, '') })} /></Field>
      </div>
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} onClick={save}>Выдать код</Button>
    </Sheet>
  );
}

// ---------- Кабинет Ordius ----------
// Сводные цифры по компаниям, контакты владельцев, заявки с сайта, тарифы. Данных работников клиентов здесь нет:
// их Ordius обрабатывает только по поручению клиента.
const PLANS = { pilot: 'Пилот', free: 'Бесплатный', start: 'Старт', business: 'Бизнес' };
const LEAD_STATUS = { new: 'Новая', in_work: 'В работе', connected: 'Подключили', rejected: 'Отказ' };
const LEAD_TONE = { new: 'info', in_work: 'warning', connected: 'success', rejected: '' };
const short = (v) => (v ? dayLabel(day10(v), day10(v).slice(0, 4) !== isoDay().slice(0, 4)) : '—');

export function AdminCabinet() {
  const me = useMe();
  const [tab, setTab] = useState('companies');
  const summary = useQuery(me.admin ? 'admin-summary' : '', () => pb.send('/api/ordius/admin/summary', {}), { cache: false });
  const companies = useQuery(me.admin ? 'admin-companies' : '', () => pb.send('/api/ordius/admin/companies', {}), { cache: false });
  const leads = useQuery(me.admin ? 'admin-leads' : '', () => pb.send('/api/ordius/admin/leads', {}), { cache: false });
  const [co, setCo] = useState(null);
  const [lead, setLead] = useState(null);

  if (me.loading && !me.admin) return <Loading />;
  if (!me.admin) return <div className="stack"><PageTitle title="Кабинет Ordius" backTo="/more" /><p className="note">Раздел только для администратора Ordius.</p></div>;
  const sm = summary.data || {};
  const cos = (companies.data && companies.data.items) || [];
  const lds = (leads.data && leads.data.items) || [];
  const v = (n) => (summary.data ? n : '…');
  return (
    <div className="stack-lg">
      <PageTitle title="Кабинет Ordius" eyebrow="Администратор Ordius" backTo="/more">
        <Link to="/connect-codes" className="btn"><Icon name="list" size={18} />Коды подключения</Link>
      </PageTitle>
      <section className="kpis">
        <div className="card stat"><span className="lbl">Компаний</span><span className="val">{v(sm.companies)}</span></div>
        <div className="card stat"><span className="lbl">Людей в работе</span><span className="val">{v(sm.people_active)}</span></div>
        <div className="card stat"><span className="lbl">Смен за 7 дней</span><span className="val">{v(sm.shifts7)}</span></div>
      </section>
      <Seg value={tab} onChange={setTab} label="Показать" options={[
        { value: 'companies', label: `Компании${cos.length ? ' · ' + cos.length : ''}` },
        { value: 'leads', label: `Заявки${sm.leads_new ? ' · новых ' + sm.leads_new : ''}` },
      ]} />
      {tab === 'companies' && (
        <>
          <ErrorBox text={companies.error} onRetry={companies.reload} />
          {companies.loading && !cos.length ? <Loading /> : (
            <div className="list">
              {cos.length === 0 && <div className="list-empty">Компаний пока нет</div>}
              {cos.map((c) => (
                <button key={c.id} type="button" className="list-item" onClick={() => setCo(c)}>
                  <div className="t">
                    <b>{c.name}</b>
                    <span>{[c.owner_name, prettyPhone(c.owner_phone)].filter(Boolean).join(' · ') || 'Владельца нет'}</span>
                    <span>{`Людей ${c.people}${c.pending ? ` (+${c.pending} заявки)` : ''} · техники ${c.vehicles} · смен за 30 дн. ${c.shifts30} · последняя ${short(c.last_shift)}`}</span>
                  </div>
                  <div className="r"><Badge tone={c.plan === 'pilot' ? 'info' : 'success'}>{PLANS[c.plan] || '—'}</Badge></div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {tab === 'leads' && (
        <>
          <ErrorBox text={leads.error} onRetry={leads.reload} />
          {leads.loading && !lds.length ? <Loading /> : (
            <div className="list">
              {lds.length === 0 && <div className="list-empty">Заявок с сайта пока нет</div>}
              {lds.map((l) => (
                <button key={l.id} type="button" className="list-item" onClick={() => setLead(l)}>
                  <div className="t">
                    <b>{l.name}{l.company ? ` · ${l.company}` : ''}</b>
                    <span>{`${prettyPhone(l.phone)} · техники ${l.fleet} · ${l.method} · ${short(l.created)}`}</span>
                    {(l.admin_note || l.comment) && <span className="ellipsis">{l.admin_note || l.comment}</span>}
                  </div>
                  <div className="r"><Badge tone={LEAD_TONE[l.status]}>{LEAD_STATUS[l.status] || l.status}</Badge></div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {co && <CompanySheet c={co} onClose={() => setCo(null)} onDone={() => { setCo(null); companies.reload(); }} />}
      {lead && <LeadSheet l={lead} onClose={() => setLead(null)} onDone={() => { setLead(null); leads.reload(); summary.reload(); }} />}
    </div>
  );
}

function CompanySheet({ c, onClose, onDone }) {
  const toast = useToast();
  const [plan, setPlan] = useState(c.plan || 'pilot');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr('');
    try { await pb.send(`/api/ordius/admin/companies/${c.id}/plan`, { method: 'POST', body: { plan } }); toast('Тариф изменён'); onDone(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  const rows = [
    ['ИНН', c.inn || '—'],
    ['Владелец', c.owner_name || '—'],
    ['Подключилась', `${short(c.created)}${c.code ? ` · код ${c.code} (${c.code_note})` : ' · без кода'}`],
    ['Условия приняты', c.terms_at ? short(c.terms_at) : 'нет отметки (создана до 27.10.2026)'],
    ['Люди', `${c.people} в работе${c.pending ? `, ${c.pending} заявки` : ''}`],
    ['Техника', String(c.vehicles)],
    ['Смен за 30 дней', String(c.shifts30)],
    ['Последняя смена', short(c.last_shift)],
  ];
  return (
    <Sheet title={c.name} onClose={onClose}>
      {c.owner_phone && <a className="btn block" href={`tel:${c.owner_phone}`}><Icon name="phone" size={18} />{prettyPhone(c.owner_phone)}</a>}
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', margin: 0, fontSize: 15, lineHeight: '20px' }}>
        {rows.map(([k, val]) => (
          <React.Fragment key={k}>
            <dt style={{ color: 'var(--ink-muted)' }}>{k}</dt>
            <dd style={{ margin: 0, fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' }}>{val}</dd>
          </React.Fragment>
        ))}
      </dl>
      <Field label="Тариф" hint="Владелец увидит запись о смене тарифа в журнале компании">
        <Select value={plan} onChange={setPlan} options={Object.entries(PLANS).map(([value, label]) => ({ value, label }))} />
      </Field>
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} disabled={plan === c.plan} onClick={save}>Сохранить тариф</Button>
    </Sheet>
  );
}

function LeadSheet({ l, onClose, onDone }) {
  const toast = useToast();
  const [status, setStatus] = useState(l.status || 'new');
  const [note, setNote] = useState(l.admin_note || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr('');
    try { await pb.send(`/api/ordius/admin/leads/${l.id}`, { method: 'POST', body: { status, admin_note: note } }); toast('Сохранено'); onDone(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet title={`Заявка #${l.ref}`} onClose={onClose}>
      <p className="note" style={{ margin: 0 }}>{`${l.name}${l.company ? ' · ' + l.company : ''} · ${short(l.created)}`}</p>
      <a className="btn block" href={`tel:${l.phone}`}><Icon name="phone" size={18} />{prettyPhone(l.phone)}</a>
      <p className="small" style={{ margin: 0 }}>{`Техники: ${l.fleet} · учёт: ${l.method}`}</p>
      {l.comment && <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{l.comment}</p>}
      <Field label="Статус">
        <Select value={status} onChange={setStatus} options={Object.entries(LEAD_STATUS).map(([value, label]) => ({ value, label }))} />
      </Field>
      <Field label="Заметка" hint="Видите только вы"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <ErrorBox text={err} />
      <Button variant="primary" block busy={busy} onClick={save}>Сохранить</Button>
    </Sheet>
  );
}
