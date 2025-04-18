// === 📁 server/index.js ===
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import contactRoutes from './routes/contacts.js';
import { queueProcessor } from './utils/queueProcessor.js';
import jobRoutes from './routes/jobs.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/exports', express.static('exports'));

app.use('/api/contacts', contactRoutes);
app.use('/api/jobs', jobRoutes);

queueProcessor();

mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log('✅ MongoDB connected');
  queueProcessor();
  app.listen(process.env.PORT || 5555, () => {
    console.log(`🚀 Server running on port ${process.env.PORT || 5555}`);
  });
}).catch(err => console.error('Mongo error →', err));
