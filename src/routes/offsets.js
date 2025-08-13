const express = require('express');
const CarbonOffset = require('../models/CarbonOffset');

const router = express.Router();

// POST /api/offsets - store carbon offset record
router.post('/', async (req, res) => {
  try {
    const { description, amount, timestamp } = req.body;
    if (!description || typeof amount !== 'number' || Number.isNaN(amount)) {
      return res.status(400).json({ error: 'description and numeric amount are required' });
    }
    const item = new CarbonOffset({ description, amount, timestamp });
    await item.save();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(400).json({ error: 'Invalid data', details: err.message });
  }
});

// GET /api/offsets - list offsets
router.get('/', async (req, res) => {
  try {
    const items = await CarbonOffset.find().sort({ timestamp: -1 }).limit(200).lean();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch offsets' });
  }
});

module.exports = router;
