// «Ещё»: разделы по роли, профиль, неотправленное, настройки компании.
import React, { useState } from 'react';
import { pb, errText } from '../lib/pb.js';
import { useSession } from '../lib/session.jsx';
import { subscribe, flush, removeItem } from '../lib/outbox.js';
import { Link } from '../lib/router.jsx';
import { ROLES, prettyPhone, dayLabel, timeOf } from '../lib/format.js';
import { Button, Field, Icon, PageTitle, ErrorBox, Badge, Select, Sheet, useToast } from '../ui.jsx';
import { PhoneCheck } from './Auth.jsx';

function Item({ to, icon, title, sub }) {
  return (
    <Link to={to} className="list-item">
      <Icon name={icon} />
      <div className="t"><b>{title}</b>{sub && <span>{sub}</span>}</div>
      <Icon name="chevron" size={18} />
    </Link>
  );
}

export function More() {
  const s = useSession();
  const office = s.isOffice;
  return (
    <div className="stack-lg">
      <PageTitle title="Ещё" />
      {office && (
        <>
          <span className="section-label">Учёт</span>
          <div className="list">
            <Item to="/payouts" icon="wallet" title="Выплаты, премии, удержания" sub="Авансы, зарплата, штрафы, дорога" />
            <Item to="/rates" icon="rate" title="Ставки" sub="За смену, час, рейс, т·км, суточные, оклад" />
            <Item to="/fuel" icon="fuel" title="Заправки и ГСМ" sub="Расход против нормы" />
            <Item to="/tasks" icon="wrench" title="Задачи" />
            <Item to="/maintenance" icon="truck" title="ТО техники" />
          </div>
          <span className="section-label">Справочники</span>
          <div className="list">
            <Item to="/vehicles" icon="truck" title="Техника" />
            <Item to="/sites" icon="pin" title="Заказчики и объекты" />
            <Item to="/company" icon="building" title="Компания" sub="Код вступления, настройки ведомости" />
          </div>
        </>
      )}
      {!office && (
        <div className="list">
          <Item to="/fuel/new" icon="fuel" title="Записать заправку" />
          <Item to="/fuel" icon="list" title="Мои заправки" />
          <Item to="/tasks" icon="wrench" title="Задачи" />
          {s.is(['mechanic']) && <Item to="/maintenance" icon="truck" title="ТО техники" />}
          <Item to="/shift/new" icon="camera" title="Новая смена" />
        </div>
      )}
      <span className="section-label">Я</span>
      <div className="list">
        <Item to="/profile" icon="users" title="Профиль" sub={prettyPhone(s.user && s.user.phone)} />
        <Item to="/outbox" icon="upload" title="Неотправленное" />
        <Item to="/join" icon="building" title="Вступить в другую компанию" />
      </div>
      <p className="note" style={{ textAlign: 'center' }}>Ordius · вопросы — ordius.info@yandex.ru</p>
    </div>
  );
}

export function Profile() {
  const s = useSession();
  const toast = useToast();
  const [name, setName] = useState((s.user && s.user.name) || '');
  const [pass, setPass] = useState({ old: '', next: '' });
  const [phoneSheet, setPhoneSheet] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const theme = (() => { try { return localStorage.getItem('ordius-theme') || 'auto'; } catch (_) { return 'auto'; } })();
  const [th, setTh] = useState(theme);

  async function saveName() {
    setBusy('name'); setErr('');
    try { await pb.collection('users').update(s.user.id, { name }); toast('Имя сохранено'); } catch (e) { setErr(errText(e)); } finally { setBusy(''); }
  }
  async function savePass() {
    if (pass.next.length < 8) { setErr('Новый пароль — не короче 8 символов'); return; }
    setBusy('pass'); setErr('');
    try {
      await pb.collection('users').update(s.user.id, { oldPassword: pass.old, password: pass.next, passwordConfirm: pass.next });
      await pb.collection('users').authWithPassword(s.user.phone, pass.next);
      setPass({ old: '', next: '' });
      toast('Пароль изменён');
    } catch (e) { setErr(errText(e)); } finally { setBusy(''); }
  }
  function setTheme(v) {
    setTh(v);
    try { if (v === 'auto') localStorage.removeItem('ordius-theme'); else localStorage.setItem('ordius-theme', v); } catch (_) { /* нет */ }
    if (v === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v);
  }
  async function logout() {
    const items = await new Promise((r) => { const un = subscribe((x) => { r(x); setTimeout(() => un(), 0); }); });
    if (items.length && !window.confirm(`Не отправлено: ${items.length}. Если выйти, это пропадёт. Выйти всё равно?`)) return;
    s.logout();
  }

  return (
    <div className="stack-lg">
      <PageTitle title="Профиль" backTo="/more" />
      {s.active.length > 1 && (
        <section className="card card-pad">
          <span className="section-label">Компания</span>
          <Select value={s.companyId} onChange={(v) => s.setCompany(v)} options={s.active.map((m) => ({ value: m.company, label: m.company_name || m.company }))} />
        </section>
      )}
      <section className="card card-pad">
        <div className="row between"><span className="muted">Телефон</span><b>{prettyPhone(s.user.phone)}</b></div>
        <div className="row between"><span className="muted">Роли</span><span>{(s.membership.roles || []).map((r) => ROLES[r]).join(', ')}</span></div>
        <Button size="sm" variant="ghost" onClick={() => setPhoneSheet(true)} style={{ alignSelf: 'flex-start' }}>Сменить номер</Button>
      </section>
      <section className="card card-pad">
        <Field label="Имя и фамилия"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Button busy={busy === 'name'} onClick={saveName} disabled={!name.trim() || name === s.user.name}>Сохранить имя</Button>
      </section>
      <section className="card card-pad">
        <span className="section-label">Пароль</span>
        <Field label="Текущий пароль"><input type="password" autoComplete="current-password" value={pass.old} onChange={(e) => setPass({ ...pass, old: e.target.value })} /></Field>
        <Field label="Новый пароль" hint="Не короче 8 символов; все другие входы сбросятся"><input type="password" autoComplete="new-password" value={pass.next} onChange={(e) => setPass({ ...pass, next: e.target.value })} /></Field>
        <Button busy={busy === 'pass'} onClick={savePass} disabled={!pass.old || !pass.next}>Сменить пароль</Button>
      </section>
      <section className="card card-pad">
        <span className="section-label">Оформление</span>
        <div className="chips">
          {[['auto', 'Как в телефоне'], ['light', 'Светлое'], ['dark', 'Тёмное']].map(([v, l]) => (
            <button key={v} type="button" className={'chip' + (th === v ? ' on' : '')} onClick={() => setTheme(v)}>{l}</button>
          ))}
        </div>
      </section>
      <ErrorBox text={err} />
      <Button block className="danger" onClick={logout}><Icon name="logout" />Выйти</Button>
      {phoneSheet && (
        <Sheet title="Новый номер" onClose={() => setPhoneSheet(false)}>
          <PhoneCheck purpose="change" submitLabel="Подтвердить новый номер" onTicket={async (ticket) => {
            try {
              await pb.send('/api/ordius/phone/change', { method: 'POST', body: { ticket } });
              await pb.collection('users').authRefresh();
              toast('Номер изменён'); setPhoneSheet(false);
            } catch (e) { setErr(errText(e)); setPhoneSheet(false); }
          }} />
        </Sheet>
      )}
    </div>
  );
}

export function Outbox({ outbox }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const items = outbox || [];
  async function retry() {
    setBusy(true);
    const left = await flush();
    setBusy(false);
    toast(left ? `Осталось: ${left}` : 'Всё отправлено');
  }
  return (
    <div className="stack-lg">
      <PageTitle title="Неотправленное" backTo="/more" />
      {items.length === 0 ? <div className="alert success"><Icon name="check" size={20} /><span>Всё отправлено на сервер</span></div> : (
        <>
          <p className="note">Это сохранено на телефоне и уйдёт на сервер само, когда будет связь. Не выходите из приложения и не очищайте данные браузера, пока список не опустеет.</p>
          <div className="list">
            {items.map((i) => (
              <div key={i.seq} className="list-item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                <div className="t">
                  <b>{i.label || i.col}</b>
                  <span>{i.op === 'create' ? 'Новая запись' : i.op === 'update' ? 'Изменение' : 'Удаление'} · {dayLabel(new Date(i.at).toISOString())} {timeOf(new Date(i.at).toISOString())}</span>
                  {i.error && <span style={{ color: 'var(--danger)' }}>{i.error}</span>}
                </div>
                {i.error ? (
                  <Button size="sm" variant="ghost" className="danger" onClick={() => { if (window.confirm('Удалить эту запись с телефона? На сервер она не попадёт.')) removeItem(i.seq); }}>Удалить</Button>
                ) : <Badge tone="warning">Ждёт связи</Badge>}
              </div>
            ))}
          </div>
          <Button variant="primary" block busy={busy} onClick={retry}><Icon name="refresh" />Отправить сейчас</Button>
        </>
      )}
    </div>
  );
}

export function CompanySettings() {
  const s = useSession();
  const toast = useToast();
  const c = s.company || {};
  const [form, setForm] = useState({ name: c.name || '', inn: c.inn || '', rates_basis: c.rates_basis || 'net', per_diem_free: c.per_diem_free_kop ? String(c.per_diem_free_kop / 100) : '700' });
  const [code, setCode] = useState(c.join_code || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  async function save() {
    setBusy('save'); setErr('');
    try {
      await pb.collection('companies').update(c.id, { name: form.name, inn: form.inn, rates_basis: form.rates_basis, per_diem_free_kop: Math.round(Number(String(form.per_diem_free).replace(',', '.')) * 100) || 0 });
      await s.reload(); toast('Сохранено');
    } catch (e) { setErr(errText(e)); } finally { setBusy(''); }
  }
  async function newCode() {
    if (!window.confirm('Выпустить новый код? Старый перестанет работать.')) return;
    setBusy('code');
    try { const r = await pb.send(`/api/ordius/companies/${c.id}/join-code`, { method: 'POST' }); setCode(r.join_code || r.code); await s.reload(); toast('Новый код выпущен'); }
    catch (e) { setErr(errText(e)); } finally { setBusy(''); }
  }
  return (
    <div className="stack-lg">
      <PageTitle title="Компания" backTo="/more" />
      <section className="card card-pad">
        <span className="section-label">Код вступления</span>
        <span className="num" style={{ fontSize: 28, letterSpacing: '.12em' }}>{code || '—'}</span>
        <p className="note">Водитель вводит этот код в приложении — появляется заявка, вы её одобряете в «Людях». Удобнее — завести человека заранее с телефоном: тогда он попадёт в компанию сам, без кода.</p>
        {s.isMgmt && <Button size="sm" busy={busy === 'code'} onClick={newCode} style={{ alignSelf: 'flex-start' }}>Выпустить новый код</Button>}
      </section>
      <section className="card card-pad">
        <Field label="Название"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!s.isMgmt} /></Field>
        <Field label="ИНН"><input inputMode="numeric" value={form.inn} onChange={(e) => setForm({ ...form, inn: e.target.value.replace(/\D/g, '') })} disabled={!s.isMgmt} /></Field>
        <Field label="Ставки в Ordius внесены" hint="От этого считается НДФЛ в ведомости">
          <Select value={form.rates_basis} onChange={(v) => setForm({ ...form, rates_basis: v })} disabled={!s.isMgmt}
            options={[{ value: 'net', label: '«На руки» — НДФЛ считается сверху' }, { value: 'gross', label: 'До НДФЛ — НДФЛ удерживается' }]} />
        </Field>
        <Field label="Суточные без НДФЛ, ₽ в день" hint="700 ₽ — как для командировочных суточных (п. 3 ст. 217 НК РФ). Сверьте с бухгалтером">
          <input inputMode="decimal" value={form.per_diem_free} onChange={(e) => setForm({ ...form, per_diem_free: e.target.value })} disabled={!s.isMgmt} />
        </Field>
        {s.isMgmt && <Button variant="primary" busy={busy === 'save'} onClick={save}>Сохранить</Button>}
      </section>
      <ErrorBox text={err} />
    </div>
  );
}
