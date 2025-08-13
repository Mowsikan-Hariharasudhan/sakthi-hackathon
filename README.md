# Carbon Net-Zero Tracker (Backend)

- Node.js + Express + MongoDB (Mongoose) + PDFKit
- Configure .env from .env.example
- API Base: /api (configurable via API_BASE)

## Environment Variables

Copy `.env.example` to `.env` and set:

- PORT (default 4000)
- MONGODB_URI
- CORS_ORIGIN (comma-separated list or `*`)
- INGEST_TOKEN (optional) — require header `X-INGEST-TOKEN` for POST /api/emissions
- HIGH_EMISSION_THRESHOLD (optional, default `0.001`) — kg CO₂e threshold to trigger alert email
- SMTP_HOST, SMTP_PORT
- SMTP_USER, SMTP_PASS (if your SMTP requires auth)
- SMTP_SECURE (true/false)
- MAIL_FROM (e.g., alerts@your-org.com)
- ALERT_DEFAULT_TO (fallback recipient)
- MANAGER_MAP (JSON mapping department→email, e.g. { "Manufacturing": "mgr1@org.com", "Logistics": "mgr2@org.com" })
- FRONTEND_BASE_URL (optional URL included in alert emails)

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

## Alerts

When an emission record is ingested with `co2_emissions` greater than `HIGH_EMISSION_THRESHOLD` (default 0.001 kg CO₂e), an email alert is sent using Nodemailer.

Recipient resolution:
- If `MANAGER_MAP` contains the department, send to that address.
- Else, send to `ALERT_DEFAULT_TO`.

If SMTP is not configured, the app logs a warning and continues without blocking ingestion.
