# 📬 Email Enrichment Server

This is the Node.js + MongoDB backend for the Email Enrichment App. It processes uploaded CSVs of LinkedIn contacts, enriches them with company domains, generates and verifies likely email addresses, and sends download links via email.

---

## 🚀 Features

- ✅ CSV ingestion + parsing
- 🧠 Pattern-based email guessing (e.g. `first.last@domain.com`)
- 📬 SMTP-based email verification
- 🌐 Fallback metadata scoring (MX records, HTTP 200 status)
- 🧪 Caches verification results to avoid rechecks
- 🧾 Export results as downloadable CSVs
- 📤 Sends notification via Resend

---

## 🛠 Setup

1. Clone this repo and `cd server`
2. Copy the `.env.example` → `.env` and fill in values:

```.env
MONGODB_URI=
RESEND_API_KEY=
BASE_URL=http://localhost:3000
VERIFY_DOMAIN=example.com
```

3. Install dependencies:

```bash
npm install
```

4. Start dev server:

```
npm run dev
```

## 📦 Project Structure

server/
│
├── models/
│   ├── Contact.js          # Contact schema
│   └── Job.js              # Job tracking schema
│
├── utils/
│   ├── queueProcessor.js   # Main logic for batch enrichment
│   ├── verifyEmailSMTP.js  # SMTP email verifier
│   ├── generateEmailPatterns.js # Pattern generator
│   ├── getDomainFromCompany.js  # Domain detection (Clearbit, fallback)
│   └── verifyDomainMetadata.js  # MX + A record + HTTP metadata scoring
│
├── cache/
│   ├── verifiedPatternCache.json  # Known verified/unverified patterns
│   └── domain-cache.json          # Known domains for companies
│
├── uploads/               # Temporary CSV storage
├── exports/               # Final enriched CSV output
└── index.js               # Entry point, Express app

## 📈 Pattern Caching Strategy
•	✅ Caches all verified true results
•	❌ Also caches false results to prevent repeated SMTP timeouts
•	Cache file path: server/cache/verifiedPatternCache.json

## 🧠 Domain Metadata Scoring

If SMTP fails or is skipped:
	•	Checks MX records
	•	Sends HTTP GET to https://domain.com
	•	Applies confidence scoring:
	•	+0.5 for MX record
	•	+0.4 for live site
	•	+0.1 for non-typo domain

If score ≥ 1.0, pattern is marked verified: true.

## 💡 Developer Notes

	•	Batch size: 200 rows at a time
	•	SMTP concurrency: 20 parallel checks
	•	Skips Google/Outlook SMTP (timeouts)
	•	Queue interval: every 5 seconds

## 📨 Example Response

{
  "firstName": "Jane",
  "lastName": "Doe",
  "company": "Example Inc",
  "domain": "example.com",
  "guessedEmail": "jane.doe@example.com",
  "guessedEmails": [
    {
      "pattern": "first.last@",
      "email": "jane.doe@example.com",
      "confidence": 0.95,
      "verified": { "status": "verified", "verified": true }
    },
    ...
  ],
  "bestGuessScore": "95%"
}

## 🧪 Tests (TODO)
	•	Unit test verifyDomainMetadata.js
	•	Add test CSVs to test/fixtures
	•	CI pipeline for queue processing

⸻

## 🧩 Future Ideas
	•	Use Clearbit enrichment API for job titles
	•	Add social scraping for Twitter / GitHub
	•	Stripe usage billing per row or batch

⸻

## 👤 Author

Built by @benvspak
