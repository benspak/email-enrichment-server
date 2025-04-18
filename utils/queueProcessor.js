
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

const BATCH_SIZE = 50;
const SCRAPE_CONCURRENCY = 8;
const VERIFY_CONCURRENCY = 10;

global.queue = [];

export const queueProcessor = () => {
  setInterval(async () => {
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

    const clean = (text) => text
      .replace(/["().,]|👨‍💻|👩‍💻|👨‍🔬|MBA|PhD|Dr\.?/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    const processBatch = async (batchToProcess) => {
      const results = await Promise.all(
        batchToProcess.map((contact) =>
          scrapeLimiter(async () => {
            const domain = await getDomainFromCompany(contact.company);
            contact.domain = domain || null;

            // Clean and parse names
            contact.firstName = clean(contact.firstName || '');
            contact.lastName = clean(contact.lastName || '');
            if (!contact.lastName && contact.firstName.includes(' ')) {
              const [first, ...rest] = contact.firstName.split(' ');
              contact.firstName = first;
              contact.lastName = rest.join(' ');
            }

            contact.guessedEmails = generateEmailPatterns(
              contact.firstName,
              contact.lastName,
              contact.domain
            );

            for (const guess of contact.guessedEmails) {
              const isValid = await verifyLimiter(() => verifyEmailSMTP(guess.email));
              guess.verified = isValid;

              if (isValid && !contact.verifiedEmail) {
                contact.verifiedEmail = guess.email;
                try {
                  await Contact.updateOne(
                    { linkedinUrl: contact.linkedinUrl },
                    { $set: { verifiedEmail: guess.email } },
                    { upsert: true }
                  );
                  console.log(`💾 Stored verified email for ${contact.firstName} ${contact.lastName}: ${guess.email}`);
                } catch (err) {
                  console.error(`❌ Failed to save verified email for ${contact.linkedinUrl}:`, err);
                }
              }
            }

            return contact;
          })
        )
      );

      enriched.push(...results);

      job.enriched += results.length;
      job.total += batchToProcess.length;
      await job.save();
    };

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
            email: data['Email Address'] || null
          };

          batch.push(contact);

          if (batch.length === BATCH_SIZE) {
            await processBatch(batch);
            batch = [];
          }
        }

        if (batch.length > 0) {
          await processBatch(batch);
        }
      }
    );

    const existingLinks = await Contact.find({
      linkedinUrl: { $in: enriched.map(c => c.linkedinUrl).filter(Boolean) }
    }).distinct('linkedinUrl');

    const uniqueContacts = enriched.filter(c => !existingLinks.includes(c.linkedinUrl));

    if (uniqueContacts.length) {
      try {
        await Contact.insertMany(uniqueContacts, { ordered: false });
      } catch (err) {
        console.warn('⚠️ Some duplicates skipped during insertMany:', err.message);
      }
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
        { id: 'verifiedEmail', title: 'Verified Email' }
      ]
    });

    await csvWriter.writeRecords(enriched);

    const fileUrl = `${process.env.BASE_URL}/exports/${filename}`;
    job.status = 'done';
    job.downloadLink = fileUrl;
    await job.save();

    console.log('📬 Sending final email to:', email);
    try {
      const result = await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: email,
        subject: '✅ Your contact enrichment is complete',
        html: `<p>Your contacts are ready. <a href="${fileUrl}">Click here to download them</a>.</p>`
      });
      console.log('📦 Resend API response:', result);
    } catch (err) {
      console.error('❌ Failed to send final email:', err);
    }
  }, 5000);
};
