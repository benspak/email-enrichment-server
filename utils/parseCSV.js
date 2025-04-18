// === 📁 server/utils/parseCSV.js ===
import fs from 'fs';
import csv from 'csv-parser';
import Contact from '../models/Contact.js';
import { getDomainFromCompany } from './getDomainFromCompany.js';

export const parseCSVAndStore = (req, res) => {
  const results = [];

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => {
      results.push({
        firstName: data['First Name'],
        lastName: data['Last Name'],
        company: data['Company'],
        position: data['Position'],
        linkedinUrl: data['URL'],
        email: data['Email Address'] || null
      });
    })
    .on('end', async () => {
      const enrichedResults = [];
      for (const contact of results) {
        const domain = await getDomainFromCompany(contact.company);
        contact.domain = domain || null;
        enrichedResults.push(contact);
      }

      await Contact.insertMany(enrichedResults);
      res.json({ success: true, count: enrichedResults.length, contacts: enrichedResults });
    });
};
