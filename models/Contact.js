import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  company: String,
  position: String,
  linkedinUrl: String,
  connectedOn: String, // Optional metadata
  email: String,
  domain: String,
  notes: String,
  guessedEmails: [
    {
      email: String,
      confidence: Number,
      verified: Boolean
    }
  ],
  guessedEmail: String,
  status: String
}, { timestamps: true });

contactSchema.index({ linkedinUrl: 1 }, { unique: true, sparse: true });

const Contact = mongoose.model('Contact', contactSchema);
export default Contact;
