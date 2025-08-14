const nodemailer = require('nodemailer');

// Create a reusable transporter using SMTP settings from env
// Required env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
// Optional: SMTP_SECURE=true|false, MAIL_FROM, MANAGER_MAP (JSON), ALERT_DEFAULT_TO, FRONTEND_BASE_URL
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT) {
  // Transporter not configured; we'll no-op and log instead
  console.warn('[alerts] SMTP not configured. Set SMTP_HOST and SMTP_PORT (and optional SMTP_USER/SMTP_PASS).');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  return transporter;
}

function getManagerEmail(department) {
  try {
    const map = JSON.parse(process.env.MANAGER_MAP || '{}');
    if (department && map[department]) return map[department];
  } catch (e) {
    // ignore JSON parse errors
  }
  return process.env.ALERT_DEFAULT_TO || null;
}

async function sendHighEmissionAlert({ department, scope, value, timestamp }) {
  const to = getManagerEmail(department);
  const tx = getTransporter();
  if (!to || !tx) {
    if (!to) console.warn('[alerts] Email not sent: No recipient resolved. Set MANAGER_MAP for department or ALERT_DEFAULT_TO.', { department });
    if (!tx) console.warn('[alerts] Email not sent: SMTP transporter unavailable.');
    return;
  }
  const from = process.env.MAIL_FROM || 'mowsikan02@gmail.com';
  const org = process.env.REPORT_ORG_NAME || 'Your Organization';
  const dashUrl = 'https://sakthi-hackathon-frontend-ekcy.vercel.app/' ? `https://sakthi-hackathon-frontend-ekcy.vercel.app/` : null;

  const subject = `High Emission Alert (${org}): ${department} exceeded ${value.toFixed(6)} kg CO₂e`;
  const timeStr = timestamp ? new Date(timestamp).toLocaleString() : new Date().toLocaleString();
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="margin:0 0 8px; color:#b00020;">High Emission Alert</h2>
      <p style="margin:0 0 16px; color:#333;">An emission reading exceeded the defined threshold.</p>
      <table style="border-collapse: collapse; width: 100%;">
        <tr>
          <td style="padding:8px; border:1px solid #eee;">Organization</td>
          <td style="padding:8px; border:1px solid #eee; font-weight:600;">${org}</td>
        </tr>
        <tr>
          <td style="padding:8px; border:1px solid #eee;">Department</td>
          <td style="padding:8px; border:1px solid #eee; font-weight:600;">${department}</td>
        </tr>
        <tr>
          <td style="padding:8px; border:1px solid #eee;">Scope</td>
          <td style="padding:8px; border:1px solid #eee;">${scope}</td>
        </tr>
        <tr>
          <td style="padding:8px; border:1px solid #eee;">Emission</td>
          <td style="padding:8px; border:1px solid #eee; color:#b00020; font-weight:700;">${value.toFixed(6)} kg CO₂e</td>
        </tr>
        <tr>
          <td style="padding:8px; border:1px solid #eee;">Timestamp</td>
          <td style="padding:8px; border:1px solid #eee;">${timeStr}</td>
        </tr>
      </table>
      ${dashUrl ? `<p style="margin-top:16px;">View details on the dashboard: <a href="${dashUrl}" target="_blank">${dashUrl}</a></p>` : ''}
      <p style="font-size:12px; color:#888; margin-top:16px;">This is an automated alert. Please investigate the source and take corrective actions.</p>
    </div>
  `;

  const text = `High Emission Alert\n\n` +
    `Organization: ${org}\n` +
    `Department: ${department}\n` +
    `Scope: ${scope}\n` +
    `Emission: ${value.toFixed(6)} kg CO2e\n` +
    `Timestamp: ${timeStr}\n` +
    (dashUrl ? `Dashboard: ${dashUrl}\n` : '') +
    `\nThis is an automated alert.`;

  try {
    console.info('[alerts] Sending high emission email', { to, department, scope, value: Number(value).toFixed(6) });
    const info = await tx.sendMail({ from, to, subject, html, text });
    console.info('[alerts] Email sent', { messageId: info && info.messageId });
  } catch (err) {
    console.warn('[alerts] Failed to send email', { error: err && err.message });
    throw err;
  }
}

module.exports = { sendHighEmissionAlert, getManagerEmail };
