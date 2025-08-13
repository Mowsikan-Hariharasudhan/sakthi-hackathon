require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
const corsOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*';
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/carbon_net_zero';
const API_BASE = process.env.API_BASE || '/api';
const IS_TEST = process.env.NODE_ENV === 'test';

// MongoDB connection
mongoose
  .connect(MONGODB_URI, { dbName: undefined })
  .then(() => { if (!IS_TEST) console.log('MongoDB connected'); })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
  if (!IS_TEST) process.exit(1);
  });

// Models
const EmissionData = require('./src/models/EmissionData');
const CarbonOffset = require('./src/models/CarbonOffset');

// Routes
const emissionsRouter = require('./src/routes/emissions');
const offsetsRouter = require('./src/routes/offsets');
const reportsRouter = require('./src/routes/reports');
const apiRootRouter = require('./src/routes/index');
const devRouter = require('./src/routes/dev');
const aiRouter = require('./src/routes/ai');

app.use(`${API_BASE}/emissions`, emissionsRouter);
app.use(`${API_BASE}/offsets`, offsetsRouter);
app.use(`${API_BASE}/reports`, reportsRouter);
app.use(`${API_BASE}`, apiRootRouter);
app.use(`${API_BASE}/ai`, aiRouter);

if (process.env.NODE_ENV !== 'production') {
  app.use(`${API_BASE}/dev`, devRouter);
}

// Health check for root
app.get('/', (_req, res) => res.send('Carbon Net-Zero API'));

// Start server
// Start server unless running tests
if (!IS_TEST) {
  app.listen(4000, '0.0.0.0', () => console.log("Server running"));
}

module.exports = app;
