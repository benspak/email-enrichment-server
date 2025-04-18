
import dns from 'dns';
import { promisify } from 'util';
import fs from 'fs';

const resolveMx = promisify(dns.resolveMx);
const resolveA = promisify(dns.resolve4);

// Load disposable domains from a static list
let disposableDomains = new Set();
try {
  const lines = fs.readFileSync('disposable-domains.txt', 'utf8')
    .split('\n')
    .map(line => line.trim().toLowerCase())
    .filter(Boolean);
  disposableDomains = new Set(lines);
} catch (err) {
  console.warn('⚠️ No disposable-domains.txt found. Skipping disposable filter.');
}

export const verifyEmailSMTP = async (email) => {
  // 1. Validate syntax with RFC 5322 regex
  const syntaxRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!syntaxRegex.test(email)) {
    console.warn(`❌ Invalid email syntax: ${email}`);
    return false;
  }

  // 2. Extract domain
  const domain = email.split('@')[1].toLowerCase();

  // 3. Check disposable domain list
  if (disposableDomains.has(domain)) {
    console.warn(`❌ Disposable email domain detected: ${domain}`);
    return false;
  }

  // 4. Try resolving MX records
  try {
    const mxRecords = await resolveMx(domain);
    if (mxRecords && mxRecords.length > 0) {
      console.log(`✅ MX records found for domain: ${domain}`);
      return true;
    } else {
      console.warn(`⚠️ No MX records found. Trying A record fallback for domain: ${domain}`);
    }
  } catch (err) {
    console.warn(`⚠️ MX lookup failed for domain: ${domain} — ${err.message}`);
  }

  // 5. Fallback to A record
  try {
    const aRecords = await resolveA(domain);
    if (aRecords && aRecords.length > 0) {
      console.log(`✅ A record found for domain: ${domain}`);
      return true;
    } else {
      console.warn(`❌ No A record found for domain: ${domain}`);
      return false;
    }
  } catch (err) {
    console.warn(`❌ A record lookup failed for domain: ${domain} — ${err.message}`);
    return false;
  }
};
