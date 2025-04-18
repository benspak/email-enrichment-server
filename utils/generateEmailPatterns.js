
export function generateEmailPatterns(firstName, lastName, domain) {
  if (!firstName || !domain) return [];

  const full = (text) => text?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
  const f = firstName.charAt(0).toLowerCase();
  const l = lastName ? lastName.charAt(0).toLowerCase() : '';

  const fn = full(firstName);
  const ln = full(lastName);
  const fl = f + ln;
  const lf = ln + f;

  const patterns = [
    { pattern: 'first@', email: `${fn}@${domain}`, confidence: 0.70 },
    { pattern: 'first.last@', email: `${fn}.${ln}@${domain}`, confidence: 0.95 },
    { pattern: 'f.last@', email: `${f}.${ln}@${domain}`, confidence: 0.85 },
    { pattern: 'firstl@', email: `${fn}${l}@${domain}`, confidence: 0.65 },
    { pattern: 'first_last@', email: `${fn}_${ln}@${domain}`, confidence: 0.80 },
    { pattern: 'first-last@', email: `${fn}-${ln}@${domain}`, confidence: 0.80 },
    { pattern: 'flast@', email: `${f}${ln}@${domain}`, confidence: 0.80 },
    { pattern: 'first.l@', email: `${fn}.${l}@${domain}`, confidence: 0.60 },
    { pattern: 'lfirst@', email: `${lf}@${domain}`, confidence: 0.60 }
  ];

  return patterns;
}
