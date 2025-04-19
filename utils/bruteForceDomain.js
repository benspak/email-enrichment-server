// === 📁 server/utils/bruteForceDomain.js ===
import dns from 'dns/promises';
import pLimit from 'p-limit';

const COMMON_TLDS = ['.com', '.org', '.net', '.io', '.app', '.co', '.xzy', '.dev', '.ai'];
const CONCURRENCY_LIMIT = 50;
const limiter = pLimit(CONCURRENCY_LIMIT);

/**
 * Attempts to brute-force resolve an email-capable domain for a company name
 * @param {string} companyName
 * @returns {Promise<string|null>} - First valid MX domain, or null
 */
export const bruteForceDomain = async (companyName) => {
  if (!companyName) return null;

  const baseName = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]/gi, '')
    .replace(/\s+/g, '');

  const guesses = COMMON_TLDS.map(tld => `${baseName}${tld}`);

  const checks = guesses.map(domain =>
    limiter(async () => {
      try {
        const mx = await dns.resolveMx(domain);
        if (mx && mx.length > 0) {
          console.log(`✅ Brute-force found domain: ${domain}`);
          return domain;
        }
      } catch (err) {
        return null; // Silent fail
      }
    })
  );

  const results = await Promise.all(checks);
  const firstHit = results.find(Boolean);
  return firstHit || null;
};
