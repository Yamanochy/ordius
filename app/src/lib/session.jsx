// Кто вошёл, в каких компаниях работает, какая компания открыта сейчас и какие в ней роли.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { pb, isNetworkError } from './pb.js';
import { kvClear, outboxClear } from './idb.js';
import { hasRole, OFFICE, MGMT, MONEY } from './format.js';

const Ctx = createContext(null);
const SAVED = 'ordius-session';
const CURRENT = 'ordius-company';

function readSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED) || 'null'); } catch (_) { return null; }
}

export function SessionProvider({ children }) {
  const [user, setUser] = useState(pb.authStore.isValid ? pb.authStore.record : null);
  const [memberships, setMemberships] = useState(() => (readSaved() || {}).memberships || null);
  const [companyId, setCompanyId] = useState(() => { try { return localStorage.getItem(CURRENT) || ''; } catch (_) { return ''; } });
  const [loading, setLoading] = useState(!!user && !memberships);

  useEffect(() => pb.authStore.onChange(() => setUser(pb.authStore.isValid ? pb.authStore.record : null)), []);

  const load = useCallback(async () => {
    if (!pb.authStore.isValid) { setMemberships(null); setLoading(false); return; }
    try {
      if (navigator.onLine) {
        try { await pb.collection('users').authRefresh(); } catch (err) {
          if (!isNetworkError(err) && (err.status === 401 || err.status === 404)) { pb.authStore.clear(); setLoading(false); return; }
        }
      }
      const list = await pb.collection('memberships').getFullList({
        filter: pb.filter('user = {:u}', { u: pb.authStore.record.id }), expand: 'company', sort: '-created',
      });
      const slim = list.map((m) => ({
        id: m.id, company: m.company, roles: m.roles || [], status: m.status, display_name: m.display_name,
        personnel_no: m.personnel_no, no_ndfl: m.no_ndfl,
        company_name: m.expand && m.expand.company ? m.expand.company.name : '',
        company_rec: m.expand && m.expand.company ? {
          id: m.expand.company.id, name: m.expand.company.name, inn: m.expand.company.inn, join_code: m.expand.company.join_code,
          plan: m.expand.company.plan, rates_basis: m.expand.company.rates_basis, per_diem_free_kop: m.expand.company.per_diem_free_kop,
        } : null,
      }));
      setMemberships(slim);
      try { localStorage.setItem(SAVED, JSON.stringify({ memberships: slim, user: pb.authStore.record.id })); } catch (_) { /* нет места */ }
    } catch (_) {
      // без связи — остаёмся на сохранённом
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (user) load(); else { setMemberships(null); setLoading(false); } }, [user && user.id]); // eslint-disable-line

  const active = useMemo(() => (memberships || []).filter((m) => m.status === 'active'), [memberships]);
  const membership = active.find((m) => m.company === companyId) || active[0] || null;

  const value = useMemo(() => ({
    user, memberships: memberships || [], active, membership, loading,
    company: membership ? membership.company_rec || { id: membership.company, name: membership.company_name } : null,
    companyId: membership ? membership.company : '',
    is: (roles) => hasRole(membership, roles),
    isOffice: hasRole(membership, OFFICE),
    isMgmt: hasRole(membership, MGMT),
    isMoney: hasRole(membership, MONEY),
    reload: load,
    setCompany(id) {
      setCompanyId(id);
      try { localStorage.setItem(CURRENT, id); } catch (_) { /* нет */ }
      window.location.hash = '/';
    },
    async logout() {
      pb.authStore.clear();
      try { localStorage.removeItem(SAVED); localStorage.removeItem(CURRENT); } catch (_) { /* нет */ }
      await kvClear();
      await outboxClear();
      setMemberships(null);
      window.location.hash = '/';
    },
  }), [user, memberships, active, membership, loading, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
