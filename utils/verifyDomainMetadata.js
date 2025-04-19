// === 📁 server/utils/verifyDomainMetadata.js ===
import dns from 'dns/promises';
import https from 'https';
import http from 'http';
import { performance } from 'perf_hooks';
import DomainMeta from '../models/DomainMeta.js';

const httpGet = (url, timeout = 3000) => new Promise((resolve) => {
  const lib = url.startsWith('https') ? https : http;
  const req = lib.get(url, { timeout }, (res) => {
    resolve({ statusCode: res.statusCode, headers: res.headers });
    res.resume();
  });
  req.on('error', () => resolve(null));
  req.on('timeout', () => {
    req.destroy();
    resolve(null);
  });
});

const knownEmailProviders = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'googlemail.com', 'aol.com', 'protonmail.com', 'zoho.com'
];

const isTypoDomain = (domain) => {
  return knownEmailProviders.some(provider => {
    const distance = levenshtein(provider, domain);
    return distance <= 2;
  });
};

function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export async function verifyDomainMetadata(domain) {
  if (!domain) return null;

  const existing = await DomainMeta.findOne({ domain });
  if (existing) return existing.metadata;

  const result = {
    hasMX: false,
    websiteLive: false,
    isTypo: isTypoDomain(domain),
    responseTimeMs: null,
    confidenceScore: 0.0
  };

  try {
    const mxRecords = await dns.resolveMx(domain);
    if (mxRecords.length > 0) result.hasMX = true;
  } catch (_) {}

  try {
    const t0 = performance.now();
    const res = await httpGet(`https://${domain}`);
    const t1 = performance.now();
    if (res && res.statusCode && res.statusCode < 400) {
      result.websiteLive = true;
      result.responseTimeMs = Math.round(t1 - t0);
    }
  } catch (_) {}

  let score = 0;
  if (result.hasMX) score += 0.5;
  if (result.websiteLive) score += 0.4;
  if (!result.isTypo) score += 0.1;
  result.confidenceScore = parseFloat(score.toFixed(2));

  await DomainMeta.findOneAndUpdate(
    { domain },
    {
      domain,
      verified: result.websiteLive || result.hasMX,
      source: 'verifyDomainMetadata',
      metadata: result,
      lastChecked: new Date()
    },
    { upsert: true }
  );

  return result;
}
