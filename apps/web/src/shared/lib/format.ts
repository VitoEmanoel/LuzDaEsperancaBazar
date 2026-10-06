/** Localização (RNF-14): pt-BR, dd/mm/aaaa, fuso America/Fortaleza. */
export const TZ = 'America/Fortaleza';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  // Datas "puras" (aaaa-mm-dd) não têm fuso: exibe sem conversão para não "voltar um dia".
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
  return dateFmt.format(new Date(iso));
}

export function formatDateTime(iso?: string | null): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : '—';
}

/** Data local (Fortaleza) de hoje no formato aaaa-mm-dd, para filtros de período. */
export function todayLocal(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return parts; // en-CA já retorna aaaa-mm-dd
}

/** Mascara telefone para exibição em listas (minimização de PII na tela). */
export function maskPhone(tel?: string | null): string {
  if (!tel) return '—';
  const digits = tel.replace(/\D/g, '');
  return digits.length >= 4 ? `(••) •••••-${digits.slice(-4)}` : '••••';
}

/** CNPJ (14 dígitos) → 00.000.000/0000-00; CPF (11) → 000.000.000-00. Outro tamanho volta como veio. */
export function formatDocumento(doc?: string | null): string {
  const d = (doc ?? '').replace(/\D/g, '');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return doc ?? '';
}
