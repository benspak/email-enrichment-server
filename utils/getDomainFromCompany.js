
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const domainCache = new Map();
const overridesPath = path.resolve('./utils/domainOverrides.json');
const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));

export const getDomainFromCompany = async (companyName) => {
  if (domainCache.has(companyName)) return domainCache.get(companyName);

  // Load from domain-cache.json if available
  try {
    const cacheFile = 'domain-cache.json';
    if (fs.existsSync(cacheFile)) {
      const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (saved[companyName] && saved[companyName] !== 'search.app.goo.gl') {
        domainCache.set(companyName, saved[companyName]);
        return saved[companyName];
      }
    }
  } catch (err) {
    console.warn('⚠️ Failed reading domain-cache.json:', err.message);
  }

  // 1. Domain override
  if (overrides[companyName]) {
    const domain = overrides[companyName];
    domainCache.set(companyName, domain);
    persistCache(companyName, domain);
    console.log(`📘 Used override for ${companyName}: ${domain}`);
    return domain;
  }

  // 2. Clearbit Autocomplete (no API key required)
  try {
    const clearbitRes = await fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(companyName)}`);
    const suggestions = await clearbitRes.json();

    if (Array.isArray(suggestions) && suggestions.length > 0) {
      let domain = suggestions[0].domain;
      if (domain === 'search.app.goo.gl') domain = '';

      console.log(`✅ Clearbit match for ${companyName}:`, domain);

      if (domain && domain !== 'search.app.goo.gl') {
        domainCache.set(companyName, domain);
        persistCache(companyName, domain);
        return domain;
      }
    }
  } catch (err) {
    console.error('❌ Clearbit API failed:', err);
  }

  return '';
};

function persistCache(company, domain) {
  const file = 'domain-cache.json';
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
