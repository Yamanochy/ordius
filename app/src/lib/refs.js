// Справочники компании (техника, объекты, заказчики, люди, позиции контрактов) с запасной копией на телефоне.
import { useMemo } from 'react';
import { pb } from './pb.js';
import { useQuery } from './data.js';

const byId = (list) => Object.fromEntries((list || []).map((x) => [x.id, x]));
const f = (expr, params) => pb.filter(expr, params);

export function useRefs(companyId) {
  const vehicles = useQuery(companyId && 'vehicles:' + companyId, () =>
    pb.collection('vehicles').getFullList({ filter: f('company = {:c}', { c: companyId }), sort: 'name' }));
  const sites = useQuery(companyId && 'sites:' + companyId, () =>
    pb.collection('sites').getFullList({ filter: f('company = {:c}', { c: companyId }), sort: 'name' }));
  const customers = useQuery(companyId && 'customers:' + companyId, () =>
    pb.collection('customers').getFullList({ filter: f('company = {:c}', { c: companyId }), sort: 'name' }));
  const members = useQuery(companyId && 'members:' + companyId, () =>
    pb.collection('memberships').getFullList({ filter: f('company = {:c}', { c: companyId }), sort: 'display_name' }));
  const items = useQuery(companyId && 'items:' + companyId, () =>
    pb.collection('contract_items').getFullList({ filter: f('company = {:c} && active = true', { c: companyId }), sort: 'name' }));
  return useMemo(() => {
    const v = vehicles.data || [];
    const s = sites.data || [];
    const c = customers.data || [];
    const m = members.data || [];
    const it = items.data || [];
    return {
      vehicles: v, sites: s, customers: c, members: m, items: it,
      vehicle: byId(v), site: byId(s), customer: byId(c), member: byId(m), item: byId(it),
      loading: vehicles.loading || sites.loading || members.loading,
      reload() { vehicles.reload(); sites.reload(); customers.reload(); members.reload(); items.reload(); },
    };
  }, [vehicles.data, sites.data, customers.data, members.data, items.data, vehicles.loading, sites.loading, members.loading]); // eslint-disable-line
}

export const vehicleLabel = (v) => (v ? [v.name, v.plate].filter(Boolean).join(' · ') : '');

// Временный токен для закрытых файлов (фото документов), живёт несколько минут.
let tokenCache = { token: '', at: 0 };
export async function fileToken() {
  if (tokenCache.token && Date.now() - tokenCache.at < 90e3) return tokenCache.token;
  const token = await pb.files.getToken();
  tokenCache = { token, at: Date.now() };
  return token;
}
export const fileUrl = (rec, name, token, thumb) => pb.files.getURL(rec, name, thumb ? { token, thumb } : { token });
