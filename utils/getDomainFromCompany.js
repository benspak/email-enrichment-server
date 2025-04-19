// === 📁 server/utils/getDomainFromCompany.js ===
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';
import { bruteForceDomain } from './bruteForceDomain.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const domainCache = new Map();
const overridesPath = path.resolve('./utils/domainOverrides.json');
const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));

export const getDomainFromCompany = async (companyName) => {
  if (!companyName || typeof companyName !== 'string') return '';
  const key = companyName.trim().toLowerCase();

  if (domainCache.has(key)) return domainCache.get(key);

  // Load from domain-cache.json if available
  try {
    const cacheFile = path.resolve(__dirname, '../cache/domain-cache.json');
    if (fs.existsSync(cacheFile)) {
      const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (saved[key] && saved[key] !== 'search.app.goo.gl') {
        domainCache.set(key, saved[key]);
        return saved[key];
      }
    }
  } catch (err) {
    console.warn('⚠️ Failed reading domain-cache.json:', err.message);
  }

  // 1. Domain override
  if (overrides[key]) {
    const domain = overrides[key];
    domainCache.set(key, domain);
    persistCache(key, domain);
    console.log(`📘 Used override for ${key}: ${domain}`);
    return domain;
  }

  // 2. Clearbit Autocomplete (no API key required)
  try {
    const clearbitRes = await fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(companyName)}`);
    const suggestions = await clearbitRes.json();

    if (Array.isArray(suggestions) && suggestions.length > 0) {
      let domain = suggestions[0].domain;
      if (domain === 'search.app.goo.gl') domain = '';

      console.log(`✅ Clearbit match for ${key}:`, domain);

      if (domain && domain !== 'search.app.goo.gl') {
        domainCache.set(key, domain);
        persistCache(key, domain);
        return domain;
      }
    }
  } catch (err) {
    console.error('❌ Clearbit API failed:', err);
  }

  // 3. Brute-force fallback
  try {
    const fallbackDomain = await bruteForceDomain(companyName);
    if (fallbackDomain) {
      domainCache.set(key, fallbackDomain);
      persistCache(key, fallbackDomain);
      console.log(`🛠️ Brute-forced domain for ${key}: ${fallbackDomain}`);
      return fallbackDomain;
    }
  } catch (err) {
    console.warn(`⚠️ Brute-force lookup failed for ${key}:`, err.message);
  }

  // Final fallback
  domainCache.set(key, '');
  persistCache(key, '');
  return '';
};

function persistCache(company, domain) {
  const file = path.resolve(__dirname, '../cache/domain-cache.json');
  let cache = {};
  if (fs.existsSync(file)) {
    try {
      cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      console.warn('⚠️ Failed to load domain-cache.json');
    }
  }
  cache[company] = domain;
  fs.writeFileSync(file, JSON.stringify(cache, null, 2));
}
