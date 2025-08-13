const express = require('express');
const PDFDocument = require('pdfkit');
const EmissionData = require('../models/EmissionData');
const CarbonOffset = require('../models/CarbonOffset');

const router = express.Router();

function buildMatch(query) {
  const { from, to, department, scope } = query || {};
  const match = {};
  if (department) match.department = department;
  if (scope) {
    const s = Number(scope);
    if ([1, 2, 3].includes(s)) match.scope = s;
  }
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

  const doc = new PDFDocument({ margin: 48 });
  doc.pipe(res);
  let streaming = true;
  let drawingHeaderFooter = false;

    const brand = {
      primary: '#2E7D32',
      secondary: '#1565C0',
      grey: '#90A4AE',
    };

    const org = process.env.REPORT_ORG_NAME || 'Sakthi Industries';
    const title = 'ESG Report — AI-Driven Carbon Net-Zero Tracking';
    const now = new Date();

    const fmt = {
      kg: (v) => `${(v || 0).toFixed(3)} kg`,
      kwh: (v) => `${(v || 0).toFixed(3)} kWh`,
      pct: (v) => `${(v || 0).toFixed(1)}%`,
    };

    // Header and footer helpers (bolder visuals)
    const drawHeader = () => {
      doc.save();
      const headerY = 24;
      const headerH = 36;
      const headerW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      doc.fillColor(brand.primary).rect(doc.page.margins.left, headerY, headerW, headerH).fill();
      // Keep these single-line with ellipsis to prevent wrap/page adds
      doc.fillColor('white').fontSize(12).text(org, doc.page.margins.left + 12, headerY + 10, { width: headerW / 3, ellipsis: true });
      doc.fontSize(12).text(now.toLocaleDateString(), doc.page.margins.left + headerW - 160, headerY + 10, { width: 148, align: 'right', ellipsis: true });
      doc.fontSize(14).fillColor('#ffffff').text(title, doc.page.margins.left + 12, headerY + headerH + 8, { width: headerW - 24, ellipsis: true });
      doc.restore();
    };
    const drawFooter = () => {
      const y = doc.page.height - 40;
      doc.save();
      doc.strokeColor(brand.grey).lineWidth(0.5).moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke();
      doc.fillColor('#546E7A').fontSize(8).text(`Generated: ${now.toLocaleString()}`, doc.page.margins.left, y + 6, { width: 300, lineBreak: false });
      doc.text(`Page ${doc.page.number}`, doc.page.width - doc.page.margins.right - 80, y + 6, { width: 80, align: 'right', lineBreak: false });
      doc.restore();
    };
    doc.on('pageAdded', () => {
      if (drawingHeaderFooter) return;
      drawingHeaderFooter = true;
      try {
        drawHeader();
        drawFooter();
      } finally {
        drawingHeaderFooter = false;
      }
    });

    // Handle PDF stream errors gracefully
    doc.on('error', (e) => {
      console.error('PDF stream error:', e.message);
      try { if (!res.writableEnded) res.end(); } catch (_) {}
    });
    res.on('close', () => {
      streaming = false;
    });

    // First page header
  drawHeader();
  doc.moveTo(doc.page.margins.left, 90);
  doc.y = 92;
  doc.fontSize(16).fillColor('#263238').text('Executive Summary');
    doc.moveDown(0.5);
    const filterParts = [];
    if (req.query.department) filterParts.push(`Department: ${req.query.department}`);
    if (req.query.from) filterParts.push(`From: ${new Date(req.query.from).toLocaleString()}`);
    if (req.query.to) filterParts.push(`To: ${new Date(req.query.to).toLocaleString()}`);
    const sub = filterParts.length ? `Filters — ${filterParts.join(' | ')}` : 'No filters applied';
    doc.fontSize(10).fillColor('#607D8B').text(sub);

  doc.moveDown(0.8);
  // Net-zero progress bar (prominent visual)
  const pbX = doc.page.margins.left;
  const pbW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const pbY = doc.y + 8;
  const pbH = 12;
  doc.fontSize(10).fillColor('#455A64').text('Net-Zero Progress', pbX, pbY - 14);
  doc.save();
  doc.roundedRect(pbX, pbY, pbW, pbH, 6).stroke('#CFD8DC');
  const pbFill = Math.max(0, Math.min(1, progress / 100)) * pbW;
  doc.rect(pbX, pbY, pbFill, pbH).fill(brand.secondary);
  doc.restore();
  doc.fontSize(9).fillColor('#263238').text(fmt.pct(progress), pbX + pbW - 60, pbY - 14, { width: 60, align: 'right', lineBreak: false });

  // Records processed
  doc.moveDown(2);
  const records = emissionsAgg?.count || 0;
  doc.fontSize(10).fillColor('#607D8B').text(`Records processed: ${records}`);
    // KPI grid (2x3)
    const kpi = [
      { label: 'Total CO2 Emissions', value: fmt.kg(totalCO2), color: brand.primary },
      { label: 'Total Energy', value: fmt.kwh(totalEnergy), color: brand.secondary },
      { label: 'Total Offsets', value: fmt.kg(totalOffsets), color: '#6A1B9A' },
      { label: 'Net CO2', value: fmt.kg(netCO2), color: '#C62828' },
      { label: 'Net-Zero Progress', value: fmt.pct(progress), color: '#00897B' },
    ];
    const startX = doc.page.margins.left;
    const cardW = (doc.page.width - doc.page.margins.left - doc.page.margins.right - 24) / 3; // 3 per row
    const cardH = 64;
    kpi.forEach((card, i) => {
      const row = Math.floor(i / 3);
      const col = i % 3;
      const x = startX + col * (cardW + 12);
      const y = 160 + row * (cardH + 12);
      doc.save();
      doc.roundedRect(x, y, cardW, cardH, 6).stroke('#CFD8DC');
      doc.rect(x, y, 6, cardH).fill(card.color);
      doc.fillColor('#263238').fontSize(10).text(card.label, x + 14, y + 10, { width: cardW - 20 });
      doc.fontSize(18).fillColor('#1B5E20').text(card.value, x + 14, y + 32);
      doc.restore();
    });

    // Move cursor below KPI grid
  doc.moveDown(5);
  doc.y = 160 + Math.ceil(kpi.length / 3) * (cardH + 12) + 16;

    // Hotspots section
    doc.moveDown(1);
    doc.fontSize(14).fillColor('#263238').text('Department Hotspots (Top 3)');
    const hotspots = await EmissionData.aggregate([
      ...matchStage,
      { $group: { _id: '$department', totalCO2: { $sum: '$co2_emissions' } } },
      { $sort: { totalCO2: -1 } },
      { $limit: 3 },
    ]);
    const maxCO2 = Math.max(0, ...hotspots.map(h => h.totalCO2 || 0));

    // Draw table header
    const tX = doc.page.margins.left;
    let tY = doc.y + 8;
    const tW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const barMax = Math.max(60, tW * 0.5);
    doc.fontSize(10).fillColor('#37474F');
    doc.text('Department', tX, tY, { width: tW * 0.35 });
    doc.text('CO2 (kg)', tX + tW * 0.35, tY, { width: tW * 0.15, align: 'right' });
    doc.text('Share', tX + tW * 0.52, tY, { width: tW * 0.15, align: 'left' });
    tY += 16;
    doc.strokeColor('#ECEFF1').lineWidth(1).moveTo(tX, tY).lineTo(tX + tW, tY).stroke();
    tY += 8;

    hotspots.forEach((h) => {
      const dept = h._id || 'Unknown';
      const co2 = h.totalCO2 || 0;
      const pct = maxCO2 > 0 ? (co2 / maxCO2) : 0;
      const barW = Math.max(6, Math.round(pct * barMax));
      // Row texts
      doc.fillColor('#263238').fontSize(11).text(dept, tX, tY, { width: tW * 0.35 });
      doc.fillColor('#263238').fontSize(11).text(co2.toFixed(3), tX + tW * 0.35, tY, { width: tW * 0.15, align: 'right' });
      // Bar
      const bx = tX + tW * 0.52;
      const by = tY + 4;
      doc.save();
      doc.roundedRect(bx, by, barMax, 10, 5).stroke('#CFD8DC');
      doc.rect(bx, by, barW, 10).fill(brand.primary);
      doc.restore();
      tY += 22;
    });

    // Footer on first page
    drawFooter();

    // Conclude
    doc.end();
  } catch (err) {
    console.error('Failed generating report', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to generate report' });
    }
    // If headers already sent, ensure stream ends but don't send another response
    try { if (!res.writableEnded) res.end(); } catch (_) {}
  }
});

module.exports = router;
