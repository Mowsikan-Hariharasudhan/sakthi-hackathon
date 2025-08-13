const twilio = require('twilio');

// Required env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
// Optional: MANAGER_PHONE_MAP (JSON), SMS_DEFAULT_TO
let client = null;
function getClient() {
  if (client) return client;
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !token) {
    console.warn('[alerts] Twilio not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
    return null;
  }
  client = twilio(sid, token);
  return client;
}

function getManagerPhone(department) {
  try {
    const raw = (process.env.MANAGER_PHONE_MAP || '{}');
    const map = JSON.parse(raw);
    const v = department && map[department];
    if (v) return String(v).trim();
  } catch (e) {}
  const def = (process.env.SMS_DEFAULT_TO || '').trim();
  return def || null;
}

async function sendHighEmissionSMS({ department, scope, value, timestamp, to: toOverride }) {
  const to = (toOverride && String(toOverride).trim()) || getManagerPhone(department);
  const client = getClient();
  if (!to || !client) {
    console.warn('[alerts] SMS not sent. Missing recipient or Twilio config.', {
      toPresent: !!to,
      hasClient: !!client,
      env: {
        fromPresent: !!(process.env.TWILIO_FROM || '').trim(),
        defaultToPresent: !!(process.env.SMS_DEFAULT_TO || '').trim(),
      }
    });
    return;
  }
  const from = (process.env.TWILIO_FROM || '').trim();
  const org = process.env.REPORT_ORG_NAME || 'Your Organization';
  const timeStr = timestamp ? new Date(timestamp).toLocaleString() : new Date().toLocaleString();
  const msg = `High Emission Alert (${org}):\nDept: ${department}\nScope: ${scope}\nCO2: ${Number(value).toFixed(6)} kg\nTime: ${timeStr}`;
  const e164 = /^\+\d{7,15}$/;
  if (!e164.test(from) || !e164.test(to)) {
    console.warn('[alerts] SMS not sent. Numbers must be E.164 format (+countrycode...).', { fromValid: e164.test(from), toValid: e164.test(to) });
    return;
  }
  try {
    const result = await client.messages.create({ body: msg, from, to });
    console.info('[alerts] SMS sent', { to, sid: result.sid });
  } catch (err) {
    console.warn('[alerts] Failed to send SMS', { error: err && err.message });
  }
}

module.exports = { sendHighEmissionSMS, getManagerPhone };
