const mongoose = require('mongoose');

const CarbonOffsetSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  description: { type: String, required: true },
  amount: { type: Number, required: true }, // kg of CO2 offset
});

module.exports = mongoose.model('CarbonOffset', CarbonOffsetSchema);
