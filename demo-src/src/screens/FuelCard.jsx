import React, { useEffect, useState } from 'react';
import { useStore, nowLabel } from '../store.jsx';
import { DRIVERS, ROLES } from '../data.js';
import { Badge, Button } from '../ui.jsx';

// ============================================================
// ТОПЛИВНАЯ КАРТА — номер, привязка к технике, лимит, ПИН.
// Правила доступа к ПИН:
//   • видят только владелец и водитель, за которым закреплена машина;
//   • ПИН показывается на 10 секунд по кнопке;
//   • каждый показ пишется в журнал (кто и когда смотрел).
// Полный номер видит только владелец, остальные — последние 4 цифры.
// ============================================================

const PIN_SECONDS = 10;

export function maskNumber(n) { return '•••• ' + n.replace(/\s/g, '').slice(-4); }

export function canSeePin(role, card) {
  if (role === 'owner') return true;
  if (role === 'driver') return DRIVERS.some(d => d.id === 'd1' && d.unitId === card.unitId);
  return false;
}

export default function FuelCard({ card, role, compact }) {
  const { update } = useStore();
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  if (!card) return null;
  const pinAllowed = canSeePin(role, card);
  const blocked = card.status === 'blocked';
  const who = (ROLES.find(r => r.id === role) || {}).person || '';
  const whoShort = who ? who.split(' ')[1] + ' ' + who[0] + '.' : role;

  const showPin = () => {
    setLeft(PIN_SECONDS);
    update(s => { s.log.unshift({ t: nowLabel().slice(6), who: whoShort, what: `Посмотрел(а) ПИН топливной карты ${maskNumber(card.number)}` }); });
  };
  const toggleBlock = () => update(s => {
    const c = s.cards.find(x => x.id === card.id);
    c.status = blocked ? 'active' : 'blocked';
    s.log.unshift({ t: nowLabel().slice(6), who: whoShort, what: `${blocked ? 'Разблокировал(а)' : 'Заблокировал(а)'} топливную карту ${maskNumber(card.number)}` });
  }, blocked ? 'Карта разблокирована' : 'Карта заблокирована — заправиться по ней нельзя');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: blocked ? 'var(--surface-2)' : 'var(--graphite)', color: blocked ? 'var(--ink-muted)' : 'var(--on-graphite)', borderRadius: 16, padding: compact ? 16 : 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', opacity: .8 }}>Топливная карта</span>
          {blocked ? <Badge tone="danger">Заблокирована</Badge> : <Badge tone="success">Активна</Badge>}
        </div>
        <span className="num" style={{ fontSize: compact ? 20 : 22, fontWeight: 600, letterSpacing: '.04em' }}>
          {role === 'owner' ? card.number : maskNumber(card.number)}
        </span>
        <span style={{ fontSize: 13, opacity: .8 }}>{card.provider} · лимит {card.limit}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="muted" style={{ fontSize: 12 }}>Заправлено в октябре</span>
          <b className="num">{card.spent.toLocaleString('ru-RU')} л</b>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="muted" style={{ fontSize: 12 }}>ПИН-код</span>
          {pinAllowed
            ? <b className="num" aria-live="polite" style={{ letterSpacing: '.2em' }}>{left > 0 ? card.pin : '••••'}</b>
            : <span className="subtle" style={{ fontSize: 13 }}>нет доступа</span>}
        </span>
      </div>

      <div className="row">
        {pinAllowed && !blocked && (
          <Button size="sm" onClick={showPin} disabled={left > 0}>
            {left > 0 ? `Скроется через ${left} с` : 'Показать ПИН'}
          </Button>
        )}
        {role === 'owner' && <Button size="sm" variant={blocked ? 'primary' : 'danger'} onClick={toggleBlock}>{blocked ? 'Разблокировать' : 'Заблокировать'}</Button>}
      </div>
      <span className="subtle" style={{ fontSize: 12 }}>
        {pinAllowed ? 'Каждый показ ПИН-кода записывается в журнал.' : 'ПИН видят только владелец и водитель, за которым закреплена машина.'}
      </span>
    </div>
  );
}
