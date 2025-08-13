require('dotenv').config();
const mongoose = require('mongoose');
const { seedSample } = require('../src/utils/sampleData');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/carbon_net_zero';
  try {
    await mongoose.connect(uri);
    const count = await seedSample();
    console.log(`Inserted ${count} sample emission documents.`);
  } catch (e) {
    console.error('Seeding failed:', e);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
