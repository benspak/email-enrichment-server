// === 📁 server/models/Contact.js ===
import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  company: String,
  position: String,
  linkedinUrl: String,
  email: String,
  domain: String,
  guessedEmails: [
    {
      email: String,
      confidence: Number,
      verified: Boolean
    }
  ],
  verifiedEmail: String,
  status: String
}, { timestamps: true });

contactSchema.index({ linkedinUrl: 1 }, { unique: true, sparse: true });

const Contact = mongoose.model('Contact', contactSchema);
export default Contact;
