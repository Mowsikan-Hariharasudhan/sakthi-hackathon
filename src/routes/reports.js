const express = require('express');
const PDFDocument = require('pdfkit');
const EmissionData = require('../models/EmissionData');
const CarbonOffset = require('../models/CarbonOffset');

const router = express.Router();

function buildMatch(query) {
  const { from, to, department } = query || {};
  const match = {};
  if (department) match.department = department;
  if (from || to) {
    const range = {};
    if (from) {
      const d = new Date(from);
      if (!isNaN(d)) range.$gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(d)) range.$lte = d;
    }
    if (Object.keys(range).length) match.timestamp = range;
  }
  return match;
}

// GET /api/reports/summary - summary data in JSON
router.get('/summary', async (req, res) => {
  try {
    const match = buildMatch(req.query);
    const matchStage = Object.keys(match).length ? [{ $match: match }] : [];
    const [emissionsAgg] = await EmissionData.aggregate([
      ...matchStage,
      { $group: {
        _id: null,
        totalCO2: { $sum: '$co2_emissions' },
        totalEnergy: { $sum: '$energy' },
        count: { $sum: 1 },
      }},
    ]);
    const [offsetsAgg] = await CarbonOffset.aggregate([
      { $group: { _id: null, totalOffsets: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    const totalCO2 = emissionsAgg?.totalCO2 || 0;
    const totalEnergy = emissionsAgg?.totalEnergy || 0;
    const totalOffsets = offsetsAgg?.totalOffsets || 0;
    const netCO2 = Math.max(0, totalCO2 - totalOffsets);
    const progress = totalCO2 > 0 ? Math.min(100, (totalOffsets / totalCO2) * 100) : 0;
    const hotspots = await EmissionData.aggregate([
      ...matchStage,
      { $group: { _id: '$department', totalCO2: { $sum: '$co2_emissions' } } },
      { $sort: { totalCO2: -1 } },
      { $limit: 3 },
    ]);
    res.json({ totalCO2, totalEnergy, totalOffsets, netCO2, progress, hotspots });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

// GET /api/reports/generate - generate ESG PDF with summary data
router.get('/generate', async (req, res) => {
  try {
    const match = buildMatch(req.query);
    const matchStage = Object.keys(match).length ? [{ $match: match }] : [];
    const [emissionsAgg] = await EmissionData.aggregate([
      ...matchStage,
      { $group: {
        _id: null,
        totalCO2: { $sum: '$co2_emissions' },
        totalEnergy: { $sum: '$energy' },
        count: { $sum: 1 },
      }},
    ]);

    const [offsetsAgg] = await CarbonOffset.aggregate([
      { $group: { _id: null, totalOffsets: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    const totalCO2 = emissionsAgg?.totalCO2 || 0;
    const totalEnergy = emissionsAgg?.totalEnergy || 0;
    const totalOffsets = offsetsAgg?.totalOffsets || 0;
    const netCO2 = Math.max(0, totalCO2 - totalOffsets);
    const progress = totalCO2 > 0 ? Math.min(100, (totalOffsets / totalCO2) * 100) : 0;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="esg-report.pdf"');

    const doc = new PDFDocument();
    doc.pipe(res);

    doc.fontSize(20).text('ESG Report - AI-Driven Carbon Net-Zero Tracking', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Total CO2 Emissions: ${totalCO2.toFixed(3)} kg`);
    doc.text(`Total Energy: ${totalEnergy.toFixed(3)} kWh`);
    doc.text(`Total Offsets: ${totalOffsets.toFixed(3)} kg CO2`);
    doc.text(`Net CO2: ${netCO2.toFixed(3)} kg`);
    doc.text(`Net-Zero Progress: ${progress.toFixed(1)}%`);

    doc.moveDown();
    doc.text('Department Hotspots (Top 3):');

    const hotspots = await EmissionData.aggregate([
      ...matchStage,
      { $group: { _id: '$department', totalCO2: { $sum: '$co2_emissions' } } },
      { $sort: { totalCO2: -1 } },
      { $limit: 3 },
    ]);

    hotspots.forEach((h, idx) => {
      doc.text(`${idx + 1}. ${h._id}: ${h.totalCO2.toFixed(3)} kg`);
    });

    doc.end();
  } catch (err) {
    console.error('Failed generating report', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

module.exports = router;
