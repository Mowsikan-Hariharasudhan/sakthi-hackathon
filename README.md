# Carbon Net-Zero Tracker (Backend)

- Node.js + Express + MongoDB (Mongoose) + PDFKit
- Configure .env from .env.example
- API Base: /api (configurable via API_BASE)

ESP32 ingestion format (POST /api/emissions):
{
  "department": "Forging",
  "scope": 1,
  "current": 2.5,
  "voltage": 230,
  "power": 575,
  "energy": 1.2,
  "co2_emissions": 0.006
}
Response: { "status": "ok" }
