// === 📁 models/Job.js ===
import mongoose from 'mongoose';

const jobSchema = new mongoose.Schema({
  email: String,
  filePath: String,
  originalName: String,
  status: { type: String, default: 'queued' },
  enriched: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  downloadLink: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  fileHash: { type: String, required: true, unique: true }
});

export default mongoose.model('Job', jobSchema);
