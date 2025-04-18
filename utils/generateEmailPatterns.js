
export const generateEmailPatterns = (firstName, lastName, domain) => {
  if (!firstName || !lastName || !domain) return [];

  const sanitize = (str) => {
    return str
      .toLowerCase()
      .replace(/[\u{1F600}-\u{1F6FF}]/gu, '') // remove emojis
      .replace(/[^a-z0-9]/gi, '') // remove punctuation, spaces, special chars
      .trim();
  };

  const fn = sanitize(firstName);
  const ln = sanitize(lastName);
  const f = fn.charAt(0);
  const l = ln.charAt(0);

  const patterns = new Set([
    `${fn}@${domain}`,
    `${fn}.${ln}@${domain}`,
    `${fn}${ln}@${domain}`,
    `${f}${ln}@${domain}`,
    `${fn}_${ln}@${domain}`,
    `${fn}-${ln}@${domain}`,
    `${fn}${l}@${domain}`,
    `${fn}.${l}@${domain}`,
    `${ln}@${domain}`,
    `${ln}.${fn}@${domain}`,
  ]);

  return [...patterns].map(email => ({ email }));
};
