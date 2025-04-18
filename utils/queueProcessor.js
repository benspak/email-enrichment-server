
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { createObjectCsvWriter } from 'csv-writer';
import pLimit from 'p-limit';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { Resend } from 'resend';

import { getDomainFromCompany } from './getDomainFromCompany.js';
import { generateEmailPatterns } from './generateEmailPatterns.js';
import { verifyEmailSMTP } from './verifyEmailSMTP.js';
import Contact from '../models/Contact.js';
import Job from '../models/Job.js';

dotenv.config();
const resend = new Resend(process.env.RESEND_API_KEY);
const pipe = promisify(pipeline);

const BATCH_SIZE = 25;
const SCRAPE_CONCURRENCY = 6;
const VERIFY_CONCURRENCY = 8;

global.queue = [];

const cacheFile = path.join('cache', 'verifiedPatternCache.json');
let verifiedPatternCache = new Map();
try {
  if (fs.existsSync(cacheFile)) {
    verifiedPatternCache = new Map(Object.entries(JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))));
    console.log(`🧠 Pattern cache loaded (${verifiedPatternCache.size} entries)`);
  }
} catch (err) {
  console.warn('⚠️ Could not load pattern cache:', err.message);
}
const savePatternCacheToDisk = () => {
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(verifiedPatternCache), null, 2));
    console.log('💾 Pattern cache saved');
  } catch (err) {
    console.error('❌ Failed to save cache:', err);
  }
};

export const queueProcessor = () => {
  setInterval(async () => {
    if (global.queue.length === 0) return;

    const queueItem = global.queue.shift();
    const { jobId, email, filePath } = queueItem;

    const job = await Job.findById(jobId);
    if (!job) return;

    const startTime = Date.now();
    job.status = 'processing';
    await job.save();

    const enriched = [];
    let batch = [];
    let skippedRows = 0;

    const scrapeLimiter = pLimit(SCRAPE_CONCURRENCY);
    const verifyLimiter = pLimit(VERIFY_CONCURRENCY);

    const processBatch = async (batchToProcess) => {
      const results = await Promise.all(batchToProcess.map(contact => scrapeLimiter(async () => {
        try {
          const domain = contact.domain;
          const patterns = generateEmailPatterns(contact.firstName, contact.lastName, domain);

          for (const pattern of patterns) {
            const key = `${domain}|${pattern.pattern}`;
            if (verifiedPatternCache.has(key)) {
              contact.guessedEmail = pattern.email;
              contact.guessedEmails = patterns.map(p => ({
                ...p,
                verified: p.email === pattern.email
              }));
              console.log(`⚡ Reused verified pattern for ${contact.firstName} ${contact.lastName}: ${pattern.pattern}`);
              return contact;
            }
          }

          contact.guessedEmails = patterns;
          let bestScore = 0;
          let bestGuess = null;

          for (const guess of contact.guessedEmails) {
            const isValid = await verifyLimiter(() => verifyEmailSMTP(guess.email));
            guess.verified = isValid;

            if (isValid) {
              verifiedPatternCache.set(`${domain}|${guess.pattern}`, true);
              if (guess.confidence > bestScore) {
                bestGuess = guess.email;
                bestScore = guess.confidence;
              }
            }

            console.log(`🔍 Tried: ${guess.email} | Verified: ${isValid} | Confidence: ${guess.confidence}`);
          }

          if (bestGuess) {
            contact.guessedEmail = bestGuess;
            await Contact.updateOne(
              { linkedinUrl: contact.linkedinUrl },
              { $set: { guessedEmail: bestGuess, guessedEmails: contact.guessedEmails } },
              { upsert: true }
            );
            savePatternCacheToDisk();
          }

          return contact;
        } catch (err) {
          console.error('❌ processBatch error:', err.message);
          return contact;
        }
      })));

      enriched.push(...results);
      job.enriched += results.length;
      job.total += batchToProcess.length;
      await job.save();
    };

    try {
      await pipe(
        fs.createReadStream(filePath).on('error', (err) => console.error('❌ File stream error:', err)),
        csv().on('error', (err) => console.error('❌ CSV parse error:', err)),
        async function* (source) {
          for await (const data of source) {
            const contact = {
              firstName: data['First Name'],
              lastName: data['Last Name'],
              company: data['Company'],
              position: data['Position'],
              linkedinUrl: data['URL'],
              connectedOn: data['Connected On'] || '',
              email: data['Email Address'] || null,
              rawEmail: data['Email Address'] || null,
              guessedEmails: [],
              guessedEmail: data['Email Address'] || null,
              notes: ''
            };

            if (!contact.firstName || !contact.lastName) {
              console.warn('⚠️ Missing name fields in row — skipping:', data);
              skippedRows++;
              continue;
            }

            const companyNormalized = contact.company?.toLowerCase() || '';
            if (['self', 'self-employed', 'freelancer', 'upwork'].some(term => companyNormalized.includes(term))) {
              console.log(`🚫 Skipping domain resolution for: ${contact.company}`);
              contact.domain = '';
            } else {
              contact.domain = await getDomainFromCompany(contact.company);
            }

            batch.push(contact);
            if (batch.length >= BATCH_SIZE) {
              await processBatch(batch);
              batch = [];
            }
          }

          if (batch.length > 0) {
            await processBatch(batch);
          }
        }
      );
    } catch (err) {
      console.error('❌ Pipeline failure:', err);
    }

    const filename = `${uuidv4()}.csv`;
    const exportPath = path.join('exports', filename);
    const csvWriter = createObjectCsvWriter({
      path: exportPath,
      header: [
        { id: 'firstName', title: 'First Name' },
        { id: 'lastName', title: 'Last Name' },
        { id: 'company', title: 'Company' },
        { id: 'position', title: 'Position' },
        { id: 'linkedinUrl', title: 'LinkedIn URL' },
        { id: 'domain', title: 'Domain' },
        { id: 'guessedEmail', title: 'Guessed Email' }
      ]
    });

    await csvWriter.writeRecords(enriched);

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    console.log(`⏱ Job completed in ${min}m ${sec}s`);
    console.log(`📉 Skipped rows: ${skippedRows}`);

    const fileUrl = `${process.env.BASE_URL}/exports/${filename}`;
    job.status = 'done';
    job.downloadLink = fileUrl;
    await job.save();

    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: email,
      subject: '✅ Your contact enrichment is complete',
      html: `<p>Your contacts are ready. <a href="${fileUrl}">Download here</a>.</p>`
    });

  }, 5000);
};
