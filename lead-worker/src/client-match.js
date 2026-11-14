// Contact identifiers are not company identifiers. Never rank or choose by order.
const text = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const phone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
};
const profile = value => {
  try {
    const u = new URL(String(value));
    return u.hostname.toLowerCase().replace(/^www\./, '') + u.pathname.toLowerCase().replace(/\/+$/, '');
  } catch { return text(value); }
};
export function clientIdentity(fields = {}) {
  return {
    email: text(fields.email ?? fields.Email),
    phone: phone(fields.phone ?? fields['Teléfono']),
    linkedinUrl: profile(fields.linkedinUrl ?? fields['LinkedIn URL']),
    socialIdentity: text(fields.socialIdentity ?? fields['Social identity key']),
    company: text(fields.company ?? fields.Empresa),
    rut: text(fields.rut ?? fields.RUT).replace(/[.\s-]/g, ''),
  };
}
export function resolveClientMatch(input, records) {
  const p = clientIdentity(input);
  const same = (c, key) => !!p[key] && p[key] === c[key];
  const different = (c, key) => !!p[key] && !!c[key] && p[key] !== c[key];
  const candidates = records.map(record => ({record, c: clientIdentity(record.fields)}))
    .filter(({c}) => Object.keys(p).some(key => same(c, key)));
  const strong = candidates.filter(({c}) => ['email', 'linkedinUrl', 'socialIdentity'].some(key => same(c, key)));
  const safe = strong.filter(({c}) => {
    const conflict = ['email', 'company', 'rut', 'linkedinUrl', 'socialIdentity'].some(key => different(c, key));
    // A supplied business identity must be corroborated, not silently discarded
    // just because the existing contact has no company/RUT recorded.
    const businessKnown = !p.company && !p.rut || same(c, 'company') || same(c, 'rut');
    return !conflict && businessKnown;
  });
  if (strong.length === 1 && safe.length === 1) return {status: 'match', record: safe[0].record};
  if (candidates.length || !Object.values(p).some(Boolean)) return {
    status: 'ambiguous', reason: strong.length ? 'identity_conflict' : 'insufficient_identity',
    candidateIds: [...new Set(candidates.map(({record}) => record.id))].sort(),
  };
  return {status: 'not_found'};
}
