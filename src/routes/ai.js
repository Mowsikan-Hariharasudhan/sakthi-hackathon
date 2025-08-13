const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const EmissionData = require('../models/EmissionData');

// Primary & fallback model selection + caching configuration
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-1.5-flash-latest';
const CACHE_TTL_MS = parseInt(process.env.CACHE_AI_STRATEGIES_TTL_MS || '300000', 10); // 5 min default
const MAX_RETRIES = parseInt(process.env.GEMINI_MAX_RETRIES || '4', 10);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Simple in-memory cache (non-persistent)
// key => { expires, payload }
const cache = new Map();

function getCacheKey(hours, topN) {
  return `${hours}|${topN}`;
}

function getCached(key) {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.payload;
  if (entry) cache.delete(key);
  return null;
}

function setCache(key, payload) {
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, payload });
}

function isRetriable(err) {
  const msg = (err && (err.message || err.toString())) || '';
  const status = err && (err.status || err.code || (err.response && err.response.status));
  const retriableCodes = [429, 500, 502, 503, 504];
  if (retriableCodes.includes(Number(status))) return true;
  if (/temporarily|timeout|overload|unavailable|again later/i.test(msg)) return true;
  return false;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function generateWithRetry(prompt, primaryModel, fallbackModel) {
  let modelName = primaryModel;
  let usedFallback = false;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return { result, usedFallback };
    } catch (err) {
      const lastAttempt = attempt === MAX_RETRIES;
      if (!isRetriable(err) || lastAttempt) {
        // If primary failed & not yet tried fallback, swap and reset attempts
        if (!usedFallback && modelName !== fallbackModel) {
          modelName = fallbackModel;
          usedFallback = true;
          // restart retry loop for fallback model
          attempt = -1; // will increment to 0
          continue;
        }
        throw err;
      }
      const delay = Math.min(8000, 500 * 2 ** attempt) + Math.random() * 300;
      if (process.env.NODE_ENV !== 'test') console.warn(`[AI] Retrying (${attempt + 1}) after error:`, err.message);
      await sleep(delay);
    }
  }
}

function parseModelJSON(text) {
  const trimmed = (text || '').trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  const jsonRaw = jsonStart >= 0 && jsonEnd >= 0 ? trimmed.slice(jsonStart, jsonEnd + 1) : '{}';
  try {
    return JSON.parse(jsonRaw);
  } catch (e) {
    return null;
  }
}

function heuristicFallback(snapshot, topN) {
  const departments = snapshot.departments || [];
  const top = [...departments]
    .sort((a,b)=> b.co2_kg - a.co2_kg)
    .slice(0, topN);
  return {
    windowHours: snapshot.windowHours,
    strategies_by_department: top.map(d => ({
      department: d.department,
      summary: { co2_kg: d.co2_kg, energy_kWh: d.energy_kWh },
      strategies: [
        {
          title: 'Target idle load reduction',
            rationale: 'Department shows significant cumulative CO₂; review off-shift consumption patterns.',
            expected_impact_kg_co2_per_day: +(d.co2_kg * 0.02).toFixed(2),
            difficulty: 'med',
            actions: ['Analyze 24h load curve', 'Identify machines left energized', 'Implement shutdown checklist']
        },
        {
          title: 'Preventive maintenance energy tune-up',
          rationale: 'Routine calibration can trim avoidable energy waste in motors & compressors.',
          expected_impact_kg_co2_per_day: +(d.co2_kg * 0.01).toFixed(2),
          difficulty: 'low',
          actions: ['Inspect motor bearings', 'Verify sensor calibration', 'Check compressed air leaks']
        }
      ]
    })),
    global_recommendations: [
      {
        title: 'Establish energy performance baseline',
        rationale: 'A stable baseline enables early anomaly detection and prioritization.',
        expected_impact_kg_co2_per_day: 3,
        difficulty: 'low',
        actions: ['Define baseline window', 'Tag abnormal peaks', 'Automate baseline drift alerts']
      },
      {
        title: 'Implement real-time anomaly alerts',
        rationale: 'Faster reaction to spikes reduces wasted kWh and associated CO₂.',
        expected_impact_kg_co2_per_day: 5,
        difficulty: 'med',
        actions: ['Set threshold rules', 'Route alerts to operations chat', 'Weekly review of false positives']
      }
    ],
    fallback: true,
    note: 'Heuristic fallback used (model unavailable).'
  };
}

/**
 * GET /api/ai/strategies?hours=6&topN=5
 * Returns AI-generated reduction strategies based on recent emissions.
 */
router.get('/strategies', async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(48, parseInt(req.query.hours || '6', 10)));
    const topN = Math.max(1, Math.min(10, parseInt(req.query.topN || '5', 10)));
    const cacheKey = getCacheKey(hours, topN);

    if (!req.query.noCache) {
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json({ ...cached, cached: true });
      }
    }

    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const data = await EmissionData.find({ timestamp: { $gte: since } })
      .sort({ timestamp: 1 })
      .lean();

    if (!data.length) {
      const emptyPayload = { windowHours: hours, strategies_by_department: [], global_recommendations: [], note: 'No recent data to analyze.' };
      setCache(cacheKey, emptyPayload);
      return res.json(emptyPayload);
    }

    // Aggregate telemetry
    const byDept = {};
    const totals = { co2: 0, energy: 0, power: 0, current: 0, count: 0 };
    for (const d of data) {
      const dep = d.department || 'Unknown';
      byDept[dep] ||= { co2: 0, energy: 0, power: 0, current: 0, samples: 0, scope: d.scope };
      byDept[dep].co2 += d.co2_emissions || 0;
      byDept[dep].energy += d.energy || 0;
      byDept[dep].power += d.power || 0;
      byDept[dep].current += d.current || 0;
      byDept[dep].samples += 1;
      totals.co2 += d.co2_emissions || 0;
      totals.energy += d.energy || 0;
      totals.power += d.power || 0;
      totals.current += d.current || 0;
      totals.count += 1;
    }

    const snapshot = {
      windowHours: hours,
      totals: {
        co2_kg: +totals.co2.toFixed(3),
        energy_kWh: +totals.energy.toFixed(3),
        avg_power_W: totals.count ? +(totals.power / totals.count).toFixed(2) : 0,
        avg_current_A: totals.count ? +(totals.current / totals.count).toFixed(2) : 0,
      },
      departments: Object.entries(byDept).map(([dep, v]) => ({
        department: dep,
        scope: v.scope ?? 1,
        co2_kg: +v.co2.toFixed(3),
        energy_kWh: +v.energy.toFixed(3),
        avg_power_W: v.samples ? +(v.power / v.samples).toFixed(2) : 0,
        avg_current_A: v.samples ? +(v.current / v.samples).toFixed(2) : 0,
        samples: v.samples,
      }))
    };

    const prompt = `You are an industrial energy & carbon reduction expert.\nGiven the snapshot of recent telemetry, propose practical, high-ROI reduction strategies.\nRules:\n- Output strict JSON only (no commentary).\n- For each department, list 2–4 strategies.\n- Each strategy: {title, rationale, expected_impact_kg_co2_per_day, difficulty: \"low|med|high\", actions: [..]}\n- Also include \"global_recommendations\" for site-wide actions (2–5 items).\n- Be conservative; if unsure, use low impacts (0–5 kg/day).\n- Prefer strategies inferred from current (A), power (W), energy (kWh) patterns.\n- If abnormal spikes or idle load appear, call that out.\n- DO NOT suggest scope 2/3; only scope 1, on-site actions.\nSNAPSHOT: ${JSON.stringify(snapshot)}`;

    let parsed = null; let usedFallback = false; let modelText = '';
    try {
      const { result, usedFallback: uf } = await generateWithRetry(prompt, PRIMARY_MODEL, FALLBACK_MODEL);
      usedFallback = uf;
      modelText = result.response.text();
      parsed = parseModelJSON(modelText);
    } catch (modelErr) {
      if (process.env.NODE_ENV !== 'test') console.warn('[AI] Model generation failed, using heuristic fallback:', modelErr.message);
    }

    let payload;
    if (!parsed) {
      payload = heuristicFallback(snapshot, topN);
    } else {
      // Trim departments if provided
      const sorted = (parsed.strategies_by_department || []).sort((a, b) => (b?.summary?.co2_kg || 0) - (a?.summary?.co2_kg || 0)).slice(0, topN);
      payload = {
        windowHours: hours,
        strategies_by_department: sorted,
        global_recommendations: parsed.global_recommendations || [],
        usedFallbackModel: usedFallback,
        fallback: false,
      };
    }

    setCache(cacheKey, payload);
    return res.json(payload);
  } catch (err) {
    console.error('AI strategies error (unhandled):', err.message);
    // Final safety net fallback
    return res.status(200).json(heuristicFallback({ windowHours: parseInt(req.query.hours||'6',10), departments: [] }, parseInt(req.query.topN||'5',10)));
  }
});

module.exports = router;
