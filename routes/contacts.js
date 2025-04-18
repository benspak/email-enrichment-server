
import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Job from '../models/Job.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// Helper: Generate SHA256 hash of file contents
const getFileHash = (filePath) => {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    console.log('🔧 Upload route triggered');

    if (!req.file) {
      console.warn('⚠️ No file uploaded');
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    if (!req.body.email) {
      console.warn('⚠️ Missing email field');
      return res.status(400).json({ error: 'Missing email field.' });
    }

    const filePath = req.file.path;
    const email = req.body.email;
    console.log('📥 File received:', req.file);
    console.log('📧 Email field:', email);

    const fileHash = getFileHash(filePath);
    console.log('🔑 Calculated file hash:', fileHash);

    const existing = await Job.findOne({ fileHash });
    if (existing) {
      console.log('🛑 Duplicate file detected for hash:', fileHash);
      return res.status(400).json({ error: 'Duplicate file upload detected.' });
    }

    const job = await Job.create({
      email,
      filePath,
      fileHash,
      status: 'pending',
      enriched: 0,
      total: 0
    });

    console.log('✅ Job created:', job._id);

    global.queue.push({ jobId: job._id, email: job.email, filePath });
    console.log('📦 Job pushed to queue');

    res.status(200).json({ jobId: job._id, message: 'File uploaded and queued.' });
  } catch (err) {
    console.error('❌ Upload failed:', err.stack || err);
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

export default router;
