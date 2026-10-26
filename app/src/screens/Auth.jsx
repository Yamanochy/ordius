// Вход, регистрация и восстановление пароля. Номер подтверждается звонком:
// человек звонит со своего телефона на номер, который покажет экран (бесплатно, звонок сбрасывается).
// Запасной путь — робот звонит человеку, и тот вводит последние 4 цифры входящего номера.
import React, { useEffect, useRef, useState } from 'react';
import { pb, errText } from '../lib/pb.js';
import { normalizePhone, prettyPhone } from '../lib/format.js';
import { Logo, Button, Field, Icon, ErrorBox } from '../ui.jsx';

const start = (phone, purpose, method) => pb.send('/api/ordius/phone/start', { method: 'POST', body: { phone, purpose, method } });

function AuthFrame({ title, text, children }) {
  return (
    <div className="auth">
      <div className="auth-top">
        <Logo onDark size={26} />
        <div className="stack" style={{ gap: 6 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: '32px', fontWeight: 700 }}>{title}</h1>
          {text && <p>{text}</p>}
        </div>
      </div>
      <div className="auth-card"><div className="auth-card-in">{children}</div></div>
    </div>
  );
}

// Подтверждение номера звонком → билет на 15 минут.
export function PhoneCheck({ purpose, onTicket, initialPhone = '', submitLabel = 'Продолжить' }) {
  const [phone, setPhone] = useState(initialPhone);
  const [step, setStep] = useState('phone'); // phone | call | code
  const [check, setCheck] = useState(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  async function begin(method) {
    const p = normalizePhone(phone);
    if (!p) { setErr('Введите номер полностью: 8 9XX XXX-XX-XX'); return; }
    if (!/^\+79\d{9}$/.test(p)) { setErr('Нужен российский мобильный номер: +7 9…'); return; }
    setErr(''); setBusy(true);
    try {
      const r = await start(p, purpose, method);
      setCheck({ ...r, phone: p });
      if (r.method === 'call') { setStep('code'); return; }
      setStep('call');
      clearInterval(timer.current);
      timer.current = setInterval(async () => {
        try {
          const s = await pb.send('/api/ordius/phone/status', { method: 'POST', body: { check: r.check } });
          if (s.status === 'verified') { clearInterval(timer.current); onTicket(r.ticket, p); }
          else if (s.status === 'expired') { clearInterval(timer.current); setStep('phone'); setErr('Время вышло — запросите проверку ещё раз'); }
        } catch (_) { /* связь мигнула — спросим ещё раз */ }
      }, 2500);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await pb.send('/api/ordius/phone/verify', { method: 'POST', body: { check: check.check, code } });
      onTicket(r.ticket, check.phone);
    } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
  }

  if (step === 'call' && check) {
    const tel = '+' + String(check.call_phone || '').replace(/\D/g, '');
    return (
      <div className="stack">
        <div className="call-box">
          <span className="muted">Позвоните с номера {prettyPhone(check.phone)} на</span>
          <span className="call-num">{check.call_phone_pretty || prettyPhone(tel)}</span>
          <a className="btn primary lg block" href={'tel:' + tel}><Icon name="phone" />Позвонить</a>
          <span className="small muted">Звонок бесплатный и сразу сбросится. Потом вернитесь сюда — экран сам продолжит.</span>
        </div>
        <div className="row muted small" style={{ justifyContent: 'center' }}><span className="spinner" aria-hidden="true" />Ждём ваш звонок…</div>
        <ErrorBox text={err} />
        <Button variant="ghost" onClick={() => { clearInterval(timer.current); begin('call'); }} busy={busy}>Не получается позвонить — пусть позвонят мне</Button>
        <Button variant="ghost" onClick={() => { clearInterval(timer.current); setStep('phone'); }}>Другой номер</Button>
      </div>
    );
  }
  if (step === 'code') {
    return (
      <form className="stack" onSubmit={verify}>
        <div className="alert info"><Icon name="phone" size={20} /><span>Сейчас на {prettyPhone(check.phone)} позвонит робот. Брать трубку не нужно — введите последние 4 цифры номера, с которого звонили.</span></div>
        <Field label="Последние 4 цифры входящего номера">
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
        </Field>
        <ErrorBox text={err} />
        <Button type="submit" variant="primary" size="lg" block busy={busy} disabled={code.length !== 4}>Подтвердить</Button>
        <Button variant="ghost" onClick={() => setStep('phone')}>Назад</Button>
      </form>
    );
  }
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); begin('callcheck'); }}>
      <Field label="Номер мобильного">
        <input type="tel" inputMode="tel" autoComplete="tel" placeholder="8 9XX XXX-XX-XX" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
      </Field>
      <ErrorBox text={err} />
      <Button type="submit" variant="primary" size="lg" block busy={busy}>{submitLabel}</Button>
    </form>
  );
}

function Links({ items }) {
  return (
    <div className="stack" style={{ gap: 4, alignItems: 'center' }}>
      {items.map(([label, fn]) => <Button key={label} variant="ghost" onClick={fn}>{label}</Button>)}
    </div>
  );
}

export default function Auth() {
  const [mode, setMode] = useState(() => (window.location.hash.includes('signup') ? 'signup' : 'login'));
  if (mode === 'signup') return <Signup setMode={setMode} />;
  if (mode === 'reset') return <Reset setMode={setMode} />;
  if (mode === 'phone') return <PhoneLogin setMode={setMode} />;
  return <Login setMode={setMode} />;
}

function Login({ setMode }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const p = normalizePhone(phone);
    if (!p) { setErr('Введите номер полностью'); return; }
    setBusy(true); setErr('');
    try {
      await pb.collection('users').authWithPassword(p, password);
    } catch (e2) {
      setErr(e2.status === 400 ? 'Неверный номер или пароль' : errText(e2));
    } finally { setBusy(false); }
  }
  return (
    <AuthFrame title="Вход" text="Смены, техника и зарплата — в одном приложении.">
      <form className="stack" onSubmit={submit}>
        <Field label="Номер мобильного">
          <input type="tel" inputMode="tel" autoComplete="username" placeholder="8 9XX XXX-XX-XX" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Пароль">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorBox text={err} />
        <Button type="submit" variant="primary" size="lg" block busy={busy}>Войти</Button>
      </form>
      <Links items={[['Войти по звонку, без пароля', () => setMode('phone')], ['Забыли пароль?', () => setMode('reset')], ['Регистрация', () => setMode('signup')]]} />
    </AuthFrame>
  );
}

function PhoneLogin({ setMode }) {
  const [err, setErr] = useState('');
  return (
    <AuthFrame title="Вход по звонку" text="Подтвердите номер — и вы в приложении, пароль не нужен.">
      <PhoneCheck purpose="login" submitLabel="Подтвердить номер" onTicket={async (ticket) => {
        try {
          const r = await pb.send('/api/ordius/phone/login', { method: 'POST', body: { ticket } });
          pb.authStore.save(r.token, r.record);
        } catch (e) { setErr(errText(e)); }
      }} />
      <ErrorBox text={err} />
      <Links items={[['Войти с паролем', () => setMode('login')]]} />
    </AuthFrame>
  );
}

function Signup({ setMode }) {
  const [ticket, setTicket] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (name.trim().length < 2) { setErr('Укажите имя и фамилию'); return; }
    if (password.length < 8) { setErr('Пароль — не короче 8 символов'); return; }
    if (!agree) { setErr('Нужно согласие на обработку персональных данных'); return; }
    setBusy(true); setErr('');
    try {
      const r = await pb.send('/api/ordius/signup', { method: 'POST', body: { ticket, name, password } });
      pb.authStore.save(r.token, r.record);
    } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
  }

  if (!ticket) {
    return (
      <AuthFrame title="Регистрация" text="Сначала подтвердим номер: вы позвоните на номер, который покажет экран. Это бесплатно.">
        <PhoneCheck purpose="signup" submitLabel="Подтвердить номер" onTicket={(t, p) => { setTicket(t); setPhone(p); }} />
        <Links items={[['Уже есть аккаунт — войти', () => setMode('login')]]} />
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Почти готово" text={`Номер ${prettyPhone(phone)} подтверждён.`}>
      <form className="stack" onSubmit={submit}>
        <Field label="Имя и фамилия" hint="Так вас увидит руководитель">
          <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Пароль" hint="Не короче 8 символов">
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <label className="check small">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>Соглашаюсь на обработку персональных данных по <a href="https://ordius.ru/privacy.html" target="_blank" rel="noreferrer">политике Ordius</a></span>
        </label>
        <ErrorBox text={err} />
        <Button type="submit" variant="primary" size="lg" block busy={busy}>Зарегистрироваться</Button>
      </form>
    </AuthFrame>
  );
}

function Reset({ setMode }) {
  const [ticket, setTicket] = useState('');
  const [phone, setPhone] = useState('');
  const [viaCode, setViaCode] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (password.length < 8) { setErr('Пароль — не короче 8 символов'); return; }
    const p = normalizePhone(phone);
    setBusy(true); setErr('');
    try {
      await pb.send('/api/ordius/password-reset', { method: 'POST', body: viaCode ? { phone: p, code, password } : { ticket, password } });
      await pb.collection('users').authWithPassword(p, password);
    } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
  }

  if (!ticket && !viaCode) {
    return (
      <AuthFrame title="Новый пароль" text="Подтвердите номер звонком — и задайте новый пароль.">
        <PhoneCheck purpose="reset" submitLabel="Подтвердить номер" onTicket={(t, p) => { setTicket(t); setPhone(p); }} />
        <Links items={[['У меня код от руководителя', () => setViaCode(true)], ['Вспомнил — войти', () => setMode('login')]]} />
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Новый пароль" text={viaCode ? 'Введите номер и код, который выдал руководитель.' : `Номер ${prettyPhone(phone)} подтверждён.`}>
      <form className="stack" onSubmit={submit}>
        {viaCode && (
          <>
            <Field label="Номер мобильного"><input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Field label="Код от руководителя"><input autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          </>
        )}
        <Field label="Новый пароль" hint="Не короче 8 символов">
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorBox text={err} />
        <Button type="submit" variant="primary" size="lg" block busy={busy}>Сохранить и войти</Button>
      </form>
      <Links items={[['Назад ко входу', () => setMode('login')]]} />
    </AuthFrame>
  );
}
