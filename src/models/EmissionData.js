const mongoose = require('mongoose');

const EmissionDataSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  department: { type: String, required: true, index: true },
  scope: { type: Number, enum: [1, 2, 3], required: true },
  current: { type: Number, required: true },
  voltage: { type: Number, required: true },
  power: { type: Number, required: true },
  energy: { type: Number, required: true },
  co2_emissions: { type: Number, required: true, index: true },
});

module.exports = mongoose.model('EmissionData', EmissionDataSchema);
