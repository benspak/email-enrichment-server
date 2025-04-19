import mongoose from 'mongoose';

const domainMetaSchema = new mongoose.Schema({
  domain: { type: String, required: true, unique: true },
  verified: { type: Boolean, default: false },
  source: { type: String, default: 'unknown' }, // e.g., 'dns', 'http', 'smtp', etc.
  metadata: { type: mongoose.Schema.Types.Mixed }, // for any additional context
  lastChecked: { type: Date, default: Date.now }
});

export default mongoose.model('DomainMeta', domainMetaSchema);
