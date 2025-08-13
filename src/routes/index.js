const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok', base: process.env.API_BASE || '/api', version: '1.0.0' });
});

module.exports = router;
