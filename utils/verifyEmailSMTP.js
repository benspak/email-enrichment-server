// === 📁 server/utils/verifyEmailSMTP.js ===
import dns from 'dns/promises';
import net from 'net';
import tls from 'tls';

const SMTP_PORT = 587;
const TIMEOUT = 3000;
const DEFAULT_MAIL_FROM_DOMAIN = process.env.VERIFY_DOMAIN || 'example.com';

const SKIP_MX_HOSTS = [
  'aspmx.l.google.com',
  'ASPMX.L.GOOGLE.COM',
  'alt1.aspmx.l.google.com',
  'alt2.aspmx.l.google.com',
  'aspmx2.googlemail.com',
  'aspmx3.googlemail.com',
  '*.mail.protection.outlook.com',
  'smtp.secureserver.net',
  'mail.protonmail.ch',
  'mx.zoho.com',
];

const shouldSkipHost = (host) => {
  return SKIP_MX_HOSTS.some(skipHost =>
    skipHost.startsWith('*.')
      ? host.endsWith(skipHost.replace('*.', ''))
      : host === skipHost
  );
};

export async function verifyEmailSMTP(email) {
  const [_, domain] = email.split('@');
  if (!domain) return { status: 'invalid_format', verified: false };

  try {
    const mxRecords = await dns.resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) throw new Error('No MX records');

    const sorted = mxRecords.sort((a, b) => a.priority - b.priority);

    if (shouldSkipHost(sorted[0].exchange)) {
      console.log(`🚫 Skipping SMTP check for known provider: ${sorted[0].exchange}`);
      return { status: 'skipped_known_provider', verified: false };
    }

    return await smtpCheck(email, sorted[0].exchange);
  } catch (err) {
    console.warn(`⚠️ MX lookup failed for ${domain}:`, err.message);
    try {
      const addresses = await dns.resolve(domain, 'A');
      if (addresses.length === 0) return { status: 'no_a_records', verified: false };

      console.log(`🧹 A record fallback used for ${domain}:`, addresses[0]);
      return await smtpCheck(email, addresses[0]);
    } catch (aErr) {
      console.warn(`❌ A record lookup failed for ${domain}:`, aErr.message);
      return { status: 'dns_failure', verified: false };
    }
  }
}

async function smtpCheck(email, host) {
  return new Promise((resolve) => {
    const socket = net.connect(SMTP_PORT, host);
    let verified = false;
    let timeout;
    let stepIndex = 0;
    let tlsSocket;
    let completed = false;

    const write = (msg) => socket.write(`${msg}\r\n`);

    const upgradeToTLS = () => {
      tlsSocket = tls.connect({
        socket,
        servername: host,
        timeout: TIMEOUT
      });

      const secureWrite = (msg) => tlsSocket.write(`${msg}\r\n`);

      tlsSocket.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) handleSMTP(line.trim(), secureWrite);
      });

      tlsSocket.on('error', () => {
        clearTimeout(timeout);
        resolve({ status: 'tls_error', verified: false });
      });

      tlsSocket.on('end', () => {
        clearTimeout(timeout);
        if (!completed) resolve({ status: 'early_disconnect', verified: false });
      });
    };

    const handleSMTP = (msg, secureWrite) => {
      if (stepIndex === 0 && /^220 /.test(msg)) {
        write('EHLO localhost');
        stepIndex++;
      } else if (stepIndex === 1 && /^250 /.test(msg)) {
        write('STARTTLS');
        stepIndex++;
      } else if (stepIndex === 2 && /^220 /.test(msg)) {
        upgradeToTLS();
        stepIndex++;
      } else if (stepIndex === 3 && secureWrite) {
        const domain = email.split('@')[1] || DEFAULT_MAIL_FROM_DOMAIN;
        secureWrite(`MAIL FROM:<verify@${domain}>`);
        stepIndex++;
      } else if (stepIndex === 4 && /^250 /.test(msg) && secureWrite) {
        secureWrite(`RCPT TO:<${email}>`);
        stepIndex++;
      } else if (stepIndex === 5 && /^250 /.test(msg)) {
        verified = true;
        completed = true;
        tlsSocket.end();
        resolve({ status: 'verified', verified: true });
      } else if (/^5\d\d /.test(msg)) {
        completed = true;
        if (tlsSocket) tlsSocket.end();
        else socket.end();
        resolve({ status: 'smtp_rejected', verified: false });
      }
    };

    socket.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) handleSMTP(line.trim(), null);
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      resolve({ status: 'connect_error', verified: false });
    });

    socket.on('end', () => {
      clearTimeout(timeout);
      if (!completed) resolve({ status: 'timeout_or_disconnect', verified: false });
    });

    timeout = setTimeout(() => {
      console.warn(`⏰ SMTP timeout for ${email} @ ${host}`);
      if (tlsSocket) tlsSocket.destroy();
      else socket.destroy();
      resolve({ status: 'timeout', verified: false });
    }, TIMEOUT);
  });
}
