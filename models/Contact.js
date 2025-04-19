import mongoose from 'mongoose';

const VerifiedStatusSchema = new mongoose.Schema({
  status: { type: String, default: 'unknown' },
  verified: { type: Boolean, default: false }
}, { _id: false });

const GuessedEmailSchema = new mongoose.Schema({
  pattern: { type: String },
  email: { type: String },
  confidence: { type: Number },
  verified: { type: VerifiedStatusSchema, default: () => ({ status: 'unknown', verified: false }) }
}, { _id: false });

const ContactSchema = new mongoose.Schema({
  firstName: { type: String },
  lastName: { type: String },
  company: { type: String },
  position: { type: String },

  linkedinUrl: { type: String, unique: true, sparse: true },
  connectedOn: { type: String },

  email: { type: String },         // user-provided email
  rawEmail: { type: String },      // original from CSV
  guessedEmail: { type: String },  // best match
  guessedEmails: [GuessedEmailSchema],

  domain: { type: String },
  notes: { type: String },

  sourceFile: { type: String },    // optional: filename for tracking source
}, {
  timestamps: true // adds createdAt and updatedAt
});

export default mongoose.model('Contact', ContactSchema);
