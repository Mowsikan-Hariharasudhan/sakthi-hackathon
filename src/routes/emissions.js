const express = require('express');
const EmissionData = require('../models/EmissionData');
const { sendHighEmissionAlert } = require('../utils/mailer');
const { sendHighEmissionSMS } = require('../utils/sms');

const router = express.Router();

// POST /api/emissions - store emission data
router.post('/', async (req, res) => {
  try {
    // Optional simple auth: require header when INGEST_TOKEN is set
    if (process.env.INGEST_TOKEN) {
      const token = req.header('X-INGEST-TOKEN');
      if (!token || token !== process.env.INGEST_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    const { department, scope, current, voltage, power, energy, co2_emissions, timestamp } = req.body;
    if (!department || ![1,2,3].includes(Number(scope))) {
      return res.status(400).json({ error: 'department and scope (1|2|3) are required' });
    }
    const nums = [current, voltage, power, energy, co2_emissions];
    if (nums.some((n) => typeof n !== 'number' || Number.isNaN(n))) {
      return res.status(400).json({ error: 'numeric fields must be numbers' });
    }
    const data = new EmissionData({ department, scope, current, voltage, power, energy, co2_emissions, timestamp });
    await data.save();

    // High emission alert
    const threshold = Number(process.env.HIGH_EMISSION_THRESHOLD || '0.001');
    if (typeof co2_emissions === 'number' && co2_emissions > threshold) {
      // Fire and forget; don't block response
      sendHighEmissionAlert({
        department,
        scope,
        value: co2_emissions,
        timestamp: timestamp || new Date().toISOString(),
      }).catch((e) => console.warn('Failed to send high emission alert:', e.message));
      sendHighEmissionSMS({
        department,
        scope,
        value: co2_emissions,
        timestamp: timestamp || new Date().toISOString(),
      }).catch((e) => console.warn('Failed to send high emission SMS:', e.message));
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error saving emission data:', err);
    res.status(400).json({ error: 'Invalid data', details: err.message });
  }
});

// GET /api/emissions/recent - last N records, optional from/to and department filter
router.get('/recent', async (req, res) => {
  try {
    const { limit, from, to, department } = req.query;
    const lim = Math.min(500, Math.max(1, parseInt(limit || '50', 10)));
    const query = {};
    if (department) query.department = department;
    if (from || to) {
      query.timestamp = {};
      if (from) query.timestamp.$gte = new Date(from);
      if (to) query.timestamp.$lte = new Date(to);
    }
    const items = await EmissionData.find(query).sort({ timestamp: -1 }).limit(lim).lean();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch recent emissions' });
  }
});

// GET /api/emissions/hotspots - top 3 departments by co2
router.get('/hotspots', async (req, res) => {
  try {
    const agg = await EmissionData.aggregate([
      { $group: { _id: '$department', totalCO2: { $sum: '$co2_emissions' } } },
      { $sort: { totalCO2: -1 } },
      { $limit: 3 },
    ]);
    res.json(agg.map((d) => ({ department: d._id, totalCO2: d.totalCO2 })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute hotspots' });
  }
});

// GET /api/emissions/predict?minutesAhead=60[&department=] - linear regression on time vs CO2
router.get('/predict', async (req, res) => {
  try {
    const minutesAhead = Math.max(1, Math.min(24 * 60, parseInt(req.query.minutesAhead || '60', 10)));
  const dept = req.query.department;
  const q = dept ? { department: dept } : {};
  const items = await EmissionData.find(q).sort({ timestamp: 1 }).limit(5000).lean();
    if (items.length < 2) {
      return res.json({ prediction: null, message: 'Insufficient data' });
    }
    // Prepare X (time in minutes since first), y (co2)
    const t0 = new Date(items[0].timestamp).getTime();
    const X = items.map((i) => (new Date(i.timestamp).getTime() - t0) / 60000);
    const y = items.map((i) => i.co2_emissions);
    const n = X.length;
    const sumX = X.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = X.reduce((acc, xi, idx) => acc + xi * y[idx], 0);
    const sumXX = X.reduce((acc, xi) => acc + xi * xi, 0);
    const denom = n * sumXX - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;

    const lastT = X[X.length - 1];
    const targetT = lastT + minutesAhead;
    const predicted = slope * targetT + intercept;

    res.json({ prediction: predicted, slope, intercept, minutesAhead });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute prediction' });
  }
});

module.exports = router;
