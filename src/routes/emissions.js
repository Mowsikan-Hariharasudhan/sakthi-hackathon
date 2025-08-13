const express = require('express');
const EmissionData = require('../models/EmissionData');

const router = express.Router();

// Simple Linear Regression helper
function linearRegression(points) {
  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumX2 = points.reduce((a, p) => a + p.x * p.x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

router.get("/predict", async (req, res) => {
  try {
    const minutesAhead = parseInt(req.query.minutesAhead || "60", 10);
    const recent = await Emission.find({})
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    if (recent.length < 2) {
      return res.json({ error: "Not enough data" });
    }

    // Map to {x, y} where x = index, y = co2_emissions
    const points = recent
      .reverse()
      .map((r, i) => ({ x: i, y: r.co2_emissions }));

    const { slope, intercept } = linearRegression(points);

    const predictions = [];
    const lastIndex = points.length - 1;
    for (let i = 1; i <= minutesAhead / (5 / 60); i++) {
      const nextIndex = lastIndex + i;
      predictions.push({
        timestamp: new Date(
          Date.now() + i * 5 * 60 * 1000
        ).toISOString(),
        predicted: slope * nextIndex + intercept,
      });
    }

    res.json({ predictions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Prediction failed" });
  }
});

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
