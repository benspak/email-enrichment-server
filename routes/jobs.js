// === 📁 routes/jobs.js ===
import express from 'express';
import Job from '../models/Job.js';

const router = express.Router();

router.get('/:jobId', async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching job status' });
  }
});

export default router;
