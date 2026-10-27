// Администратор Ordius: коды подключения компаний. Раздел виден только номерам из ORDIUS_ADMIN_PHONES на сервере.
// На пилоте компанию создаёт только тот, кому выдан код: код вводится при «Я руководитель — создать компанию».
import React, { useState } from 'react';
import { pb, errText } from '../lib/pb.js';
import { useQuery } from '../lib/data.js';
import { dayLabel, day10, isoDay } from '../lib/format.js';
import { Button, Badge, Field, Icon, PageTitle, ErrorBox, Loading, Sheet, useToast } from '../ui.jsx';

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
