import mongoose from 'mongoose';

const failedVerificationSchema = new mongoose.Schema({
  email: { type: String, required: true },
  domain: { type: String, required: true },
  attempt: { type: Number, required: true },
  reason: { type: String },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('FailedVerification', failedVerificationSchema);
