// === 📁 server/utils/queueProcessor.js ===
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
import { verifyDomainMetadata } from './verifyDomainMetadata.js';
import Contact from '../models/Contact.js';
import Job from '../models/Job.js';

dotenv.config();
const resend = new Resend(process.env.RESEND_API_KEY);
const pipe = promisify(pipeline);

const BATCH_SIZE = 200;
const VERIFY_CONCURRENCY = 20;

const cachePath = path.resolve('cache/verifiedPatternCache.json');

const ensureDirectory = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

let verifiedPatternCache = new Map();
try {
  const exists = fs.existsSync(cachePath);
  if (exists) {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    verifiedPatternCache = new Map(Object.entries(raw));
    console.log(`🧐 Pattern cache loaded (${verifiedPatternCache.size} entries)`);
  } else {
    console.warn('📭 Pattern cache file not found at:', cachePath);
  }
} catch (err) {
  console.warn('⚠️ Could not load verifiedPatternCache:', err.message);
}

const savePatternCacheToDisk = () => {
  try {
    console.log('🧪 savePatternCacheToDisk() called. Cache size:', verifiedPatternCache.size);
    ensureDirectory(path.dirname(cachePath));

    const plainObject = {};
    for (const [key, value] of verifiedPatternCache.entries()) {
      if (value && typeof value === 'object' && 'verified' in value) {
        plainObject[key] = {
          status: value.status || 'unknown',
          verified: !!value.verified
        };
      }
    }

    fs.writeFileSync(cachePath, JSON.stringify(plainObject, null, 2));
    console.log('💾 Pattern cache saved');
  } catch (err) {
    console.error('❌ Failed to save pattern cache:', err);
  }
};

export const queueProcessor = () => {
  if (!global.queue) global.queue = [];

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
    const failedContacts = [];
    const verifyLimiter = pLimit(VERIFY_CONCURRENCY);
    let patternCacheChanged = false;

    const processBatch = async (batchToProcess) => {
      const results = await Promise.all(batchToProcess.map(contact => verifyLimiter(async () => {
        try {
          const domain = contact.domain;
          const metadata = await verifyDomainMetadata(domain);
          contact.domainMetadata = metadata;

          const patterns = generateEmailPatterns(contact.firstName, contact.lastName, domain);
          contact.guessedEmails = [];

          let bestScore = 0;
          let bestGuess = null;

          for (const pattern of patterns) {
            const key = `${domain}|${pattern.pattern}`;

            if (verifiedPatternCache.has(key)) {
              const cached = verifiedPatternCache.get(key);
              contact.guessedEmails.push({
                ...pattern,
                verified: {
                  status: cached.status || 'unknown',
                  verified: !!cached.verified
                }
              });
              if (cached.verified && pattern.confidence > bestScore) {
                bestGuess = pattern.email;
                bestScore = pattern.confidence;
              }
              continue;
            }

            let result = { status: 'unverified', verified: false };
            if (metadata.confidenceScore >= 1) {
              result = { status: 'metadata_confident', verified: true };
              verifiedPatternCache.set(key, result);
              patternCacheChanged = true;
            } else {
              result = await verifyEmailSMTP(pattern.email);
              if (result.verified) {
                verifiedPatternCache.set(key, result);
                patternCacheChanged = true;
              }
            }

            contact.guessedEmails.push({ ...pattern, verified: result });

            if (result.verified && pattern.confidence > bestScore) {
              bestGuess = pattern.email;
              bestScore = pattern.confidence;
            }
          }

          if (bestGuess) {
            contact.guessedEmail = bestGuess;
            contact.bestGuessScore = Math.round(bestScore * 100) + '%';
          } else if (contact.guessedEmails.length > 0) {
            const topGuess = contact.guessedEmails.reduce((prev, curr) =>
              curr.confidence > prev.confidence ? curr : prev
            );
            contact.guessedEmail = topGuess.email;
            contact.bestGuessScore = Math.round(topGuess.confidence * 100) + '%';
          }

          await Contact.updateOne(
            { linkedinUrl: contact.linkedinUrl },
            { $set: contact },
            { upsert: true }
          );

          return contact;
        } catch (err) {
          console.error('❌ Failed to process contact:', contact, err);
          failedContacts.push(contact);
          return null;
        }
      })));

      enriched.push(...results.filter(Boolean));
      job.enriched += results.length;
      job.total += batchToProcess.length;
      await job.save();
    };

    try {
      await pipe(
        fs.createReadStream(filePath),
        csv(),
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
              console.warn('⚠️ Skipping due to missing name:', data);
              skippedRows++;
              continue;
            }

            const companyNormalized = contact.company?.toLowerCase() || '';
            if (["self", "self-employed", "freelancer", "upwork"].some(term => companyNormalized.includes(term))) {
              contact.domain = '';
            } else {
              contact.domain = await getDomainFromCompany(contact.company);
            }

            batch.push(contact);
            await Contact.updateOne(
              { linkedinUrl: contact.linkedinUrl },
              { $set: contact },
              { upsert: true }
            );

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
      console.error('❌ CSV Processing Failed:', err.message);
    }

    if (patternCacheChanged) {
      console.log('📥 Writing updated cache to disk...');
      savePatternCacheToDisk();
    }

    console.log('💾 Final pattern cache save attempt');
    savePatternCacheToDisk();

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
        { id: 'guessedEmail', title: 'Guessed Email' },
        { id: 'bestGuessScore', title: 'Confidence Score' }
      ]
    });

    await csvWriter.writeRecords(enriched);

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    console.log(`⏱ Job completed in ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`);
    console.log(`📉 Skipped rows: ${skippedRows}`);
    if (failedContacts.length > 0) {
      console.warn(`❌ Failed to process ${failedContacts.length} contacts.`);
    }

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
