// Helper to seed some sample data (optional)
const EmissionData = require('../models/EmissionData');

async function seedSample() {
  const now = Date.now();
  const depts = ['Forging', 'Casting', 'Assembly', 'Packaging'];
  const docs = [];
  for (let i = 0; i < 80; i++) {
    const d = depts[i % depts.length];
    const t = new Date(now - (80 - i) * 60 * 1000);
    const current = 2 + Math.random() * 3;
    const voltage = 220 + Math.random() * 20;
    const power = current * voltage * 0.5;
    const energy = power / 1000;
    const co2_emissions = energy * 0.005;
    docs.push({ department: d, scope: ((i % 3) + 1), current, voltage, power, energy, co2_emissions, timestamp: t });
  }
  // Add some scope 3 heavy entries for testing
  for (let i = 0; i < 10; i++) {
    const t = new Date(now - i * 5 * 60 * 1000);
    docs.push({
      department: 'Melting',
      scope: 3,
      current: 1 + Math.random(),
      voltage: 230,
      power: 200 + Math.random() * 50,
      energy: 0.3 + Math.random() * 0.1,
      co2_emissions: 0.3 + Math.random() * 0.2,
      timestamp: t,
    });
  }
  await EmissionData.insertMany(docs);
  return docs.length;
}

module.exports = { seedSample };
