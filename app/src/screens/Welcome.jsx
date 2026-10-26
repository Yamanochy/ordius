// Человек вошёл, но ещё ни в одной компании не работает: приглашения, код компании или своя компания.
import React, { useState } from 'react';
import { pb, errText } from '../lib/pb.js';
import { useSession } from '../lib/session.jsx';
import { useQuery } from '../lib/data.js';
import { ROLES } from '../lib/format.js';
import { Logo, Button, Field, Icon, ErrorBox, Badge, useToast } from '../ui.jsx';

export default function Welcome({ embedded }) {
  const s = useSession();
  const toast = useToast();
  const inv = useQuery('invitations', () => pb.send('/api/ordius/invitations', {}), { cache: false });
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [newCo, setNewCo] = useState(false);
  const [coName, setCoName] = useState('');
  const [coInn, setCoInn] = useState('');
  const pending = s.memberships.filter((m) => m.status === 'pending');

  async function accept(id) {
    setBusy(id); setErr('');
    try {
      const r = await pb.send(`/api/ordius/invitations/${id}/accept`, { method: 'POST' });
      await s.reload();
      if (r && r.company) s.setCompany(r.company);
      toast('Вы в компании');
    } catch (e) { setErr(errText(e)); } finally { setBusy(''); }
  }
  async function join(e) {
    e.preventDefault();
    setBusy('code'); setErr('');
    try {
      const r = await pb.send('/api/ordius/join', { method: 'POST', body: { code } });
      await s.reload();
      if (r.status === 'active') { s.setCompany(r.company); toast('Вы в компании «' + r.company_name + '»'); }
      else toast('Заявка в «' + r.company_name + '» отправлена руководителю');
      setCode('');
    } catch (e2) { setErr(errText(e2)); } finally { setBusy(''); }
  }
  async function createCompany(e) {
    e.preventDefault();
    if (coName.trim().length < 2) { setErr('Укажите название компании'); return; }
    setBusy('co'); setErr('');
    try {
      const c = await pb.collection('companies').create({ name: coName.trim(), inn: coInn.trim() || undefined });
      await s.reload();
      s.setCompany(c.id);
      toast('Компания создана. Вы — владелец');
    } catch (e2) { setErr(errText(e2)); } finally { setBusy(''); }
  }

  const items = (inv.data && inv.data.items) || [];
  const body = (
    <div className="stack-lg">
      {items.length > 0 && (
        <section className="stack">
          <h2 className="h2">Вас пригласили</h2>
          {items.map((i) => (
            <div key={i.membership} className="card card-pad">
              <div className="row between">
                <div className="stack" style={{ gap: 2 }}>
                  <b>{i.company_name}</b>
                  <span className="small muted">{i.display_name} · {(i.roles || []).map((r) => ROLES[r]).join(', ')}</span>
                </div>
                <Button variant="primary" busy={busy === i.membership} onClick={() => accept(i.membership)}>Принять</Button>
              </div>
            </div>
          ))}
        </section>
      )}
      {pending.length > 0 && (
        <div className="alert info"><Icon name="cal" size={20} /><span>Заявка отправлена. Как только руководитель её одобрит, компания появится здесь. <button type="button" className="btn sm" style={{ marginLeft: 8 }} onClick={() => s.reload()}>Проверить</button></span></div>
      )}
      <form className="card card-pad" onSubmit={join}>
        <h2 className="h2">Код компании</h2>
        <p className="note">Код выдаёт руководитель: общий код компании или личный код приглашения.</p>
        <Field label="Код">
          <input autoCapitalize="characters" autoComplete="off" placeholder="Например, K7M2X9QD" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" block busy={busy === 'code'} disabled={code.trim().length < 6}>Вступить</Button>
      </form>
      <ErrorBox text={err} />
      {!newCo ? (
        <Button variant="ghost" onClick={() => setNewCo(true)}><Icon name="building" />Я руководитель — создать компанию</Button>
      ) : (
        <form className="card card-pad" onSubmit={createCompany}>
          <h2 className="h2">Новая компания</h2>
          <Field label="Название"><input value={coName} onChange={(e) => setCoName(e.target.value)} placeholder="ИП Иванов И.И." /></Field>
          <Field label="ИНН" hint="Необязательно"><input inputMode="numeric" value={coInn} onChange={(e) => setCoInn(e.target.value.replace(/\D/g, ''))} maxLength={12} /></Field>
          <Button type="submit" variant="primary" block busy={busy === 'co'}>Создать</Button>
        </form>
      )}
    </div>
  );
  if (embedded) return body;
  return (
    <div className="auth">
      <div className="auth-top">
        <div className="row between"><Logo onDark size={24} /><button type="button" className="icon-btn" onClick={s.logout} aria-label="Выйти"><Icon name="logout" size={20} /></button></div>
        <div className="stack" style={{ gap: 6 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: '32px', fontWeight: 700 }}>Здравствуйте, {(s.user && s.user.name || '').split(' ')[0]}</h1>
          <p>Осталось попасть в свою компанию.</p>
        </div>
      </div>
      <div className="auth-card"><div className="auth-card-in">{body}{pending.length > 0 && <Badge tone="info">Заявок: {pending.length}</Badge>}</div></div>
    </div>
  );
}
