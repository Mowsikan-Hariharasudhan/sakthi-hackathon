const express = require('express');
const { seedSample } = require('../utils/sampleData');

const router = express.Router();

router.post('/seed', async (_req, res) => {
  try {
    const count = await seedSample();
    res.json({ inserted: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
