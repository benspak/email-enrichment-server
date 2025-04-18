
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

const BATCH_SIZE = 25; // Reduce for memory safety
const SCRAPE_CONCURRENCY = 6;
const VERIFY_CONCURRENCY = 8;

global.queue = [];

const cacheFile = path.join('cache', 'verifiedPatternCache.json');
let verifiedPatternCache = new Map();

try {
  if (fs.existsSync(cacheFile)) {
    const json = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    verifiedPatternCache = new Map(Object.entries(json));
    console.log(`🧠 Pattern cache loaded (${verifiedPatternCache.size} entries)`);
  }
} catch (err) {
  console.warn('⚠️ Failed to load pattern cache:', err.message);
}

function savePatternCacheToDisk() {
  try {
    const json = JSON.stringify(Object.fromEntries(verifiedPatternCache), null, 2);
    fs.writeFileSync(cacheFile, json, 'utf-8');
    console.log('💾 Pattern cache saved');
  } catch (err) {
    console.error('❌ Failed to save pattern cache:', err);
  }
}

export const queueProcessor = () => {
  setInterval(async () => {
    try {
      if (global.queue.length === 0) return;

      const queueItem = global.queue.shift();
      const { jobId, email, filePath } = queueItem;

      const job = await Job.findById(jobId);
      if (!job) return;

      job.status = 'processing';
      await job.save();

      const enriched = [];
      let batch = [];

      const scrapeLimiter = pLimit(SCRAPE_CONCURRENCY);
      const verifyLimiter = pLimit(VERIFY_CONCURRENCY);

      const clean = (text) => text?.replace(/["().,]|👨‍💻|👩‍💻|👨‍🔬|MBA|PhD|Dr\.?/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      const processBatch = async (batchToProcess) => {
        const results = await Promise.all(
          batchToProcess.map((contact) =>
            scrapeLimiter(async () => {
              try {
                contact.firstName = clean(contact.firstName || '');
                contact.lastName = clean(contact.lastName || '');

                if (!contact.lastName && contact.firstName.includes(' ')) {
                  const [first, ...rest] = contact.firstName.split(' ');
                  contact.firstName = first;
                  contact.lastName = rest.join(' ');
                }

                const existing = await Contact.findOne({ linkedinUrl: contact.linkedinUrl });
                if (existing?.verifiedEmail) {
                  console.log(`✅ Already verified: ${contact.linkedinUrl}`);
                  return existing;
                }

                const domain = await getDomainFromCompany(contact.company);
                contact.domain = domain || null;

                for (let [key, value] of verifiedPatternCache.entries()) {
                  if (key.startsWith(domain + '|')) {
                    contact.verifiedEmail = value;
                    console.log(`⚡ Reused cache for ${domain}: ${value}`);
                    return contact;
                  }
                }

                contact.guessedEmails = generateEmailPatterns(contact.firstName, contact.lastName, contact.domain)
                  .map((g) => ({
                    email: g.email,
                    pattern: g.pattern,
                    confidence: g.confidence,
                    verified: false
                  }));

                let bestGuess = null;
                let bestScore = 0;

                for (const guess of contact.guessedEmails) {
                  const isValid = await verifyLimiter(() => verifyEmailSMTP(guess.email));
                  guess.verified = isValid;

                  if (isValid && guess.confidence > bestScore) {
                    bestGuess = guess.email;
                    bestScore = guess.confidence;
                    verifiedPatternCache.set(`${contact.domain}|${guess.pattern}`, guess.email);
                  }

                  console.log(`🔍 Tried: ${guess.email} | Verified: ${isValid} | Confidence: ${guess.confidence}`);
                }

                if (bestGuess) {
                  contact.verifiedEmail = bestGuess;

                  await Contact.updateOne(
                    { linkedinUrl: contact.linkedinUrl },
                    {
                      $set: {
                        verifiedEmail: bestGuess,
                        guessedEmails: contact.guessedEmails
                      }
                    },
                    { upsert: true }
                  );

                  savePatternCacheToDisk();
                }

                return contact;
              } catch (err) {
                console.error(`❌ processBatch contact failed:`, err.message);
                return contact;
              }
            })
          )
        );

        enriched.push(...results);
        job.enriched += results.length;
        job.total += batchToProcess.length;
        await job.save();
      };

      let rowCount = 0;
      await pipe(
        fs.createReadStream(filePath)
          .on('error', (err) => {
            console.error('❌ File stream error:', err);
          }),
        csv()
          .on('error', (err) => {
            console.error('❌ CSV parse error:', err);
          }),
        async function* (source) {
          for await (const data of source) {
            rowCount++;
            if (rowCount % 500 === 0) {
              console.log(`⏳ Parsed ${rowCount} rows...`);
            }

            // Inside CSV parsing loop:
            const contact = {
              firstName: data['First Name']?.trim(),
              lastName: data['Last Name']?.trim(),
              company: data['Company']?.trim(),
              position: data['Position']?.trim(),
              linkedinUrl: data['URL']?.trim(),
              connectedOn: data['Connected On'] || '',
              email: data['Email Address'] || null,
              rawEmail: data['Email Address'] || null,
              guessedEmails: [],
              verifiedEmail: data['Email Address'] || null,
              notes: ''
            };

            // Optional: Warn if names are missing
            if (!contact.firstName || !contact.lastName) {
              console.warn('⚠️ Missing name fields in row:', data);
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
          { id: 'verifiedEmail', title: 'Verified Email' }
        ]
      });

      await csvWriter.writeRecords(enriched);

      const fileUrl = `${process.env.BASE_URL}/exports/${filename}`;
      job.status = 'done';
      job.downloadLink = fileUrl;
      await job.save();

      console.log('📬 Sending results to:', email);
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: email,
        subject: '✅ Your contact enrichment is complete',
        html: `<p>Your contacts are ready. <a href="${fileUrl}">Download here</a>.</p>`
      });
    } catch (err) {
      console.error('❌ Queue job failed:', err.stack || err.message);
    }
  }, 5000);
};
