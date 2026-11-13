// WhatsApp Cloud API (Meta Graph API) client
const crypto = require('crypto');

const cfg = () => ({
  token: process.env.WA_TOKEN,
  phoneId: process.env.WA_PHONE_NUMBER_ID,
  wabaId: process.env.WA_BUSINESS_ACCOUNT_ID,
  secret: process.env.WA_APP_SECRET,
  verifyToken: process.env.WA_VERIFY_TOKEN,
  version: process.env.GRAPH_VERSION || 'v23.0',
});

const base = () => `https://graph.facebook.com/${cfg().version}`;

async function graph(path, { method = 'GET', body, token, query } = {}) {
  const url = new URL(base() + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token || cfg().token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error ? `${data.error.message} (code ${data.error.code})` : `HTTP ${res.status}`;
    const err = new Error(msg);
    err.details = data.error;
    throw err;
  }
  return data;
}

function sendText(to, text, previewUrl = true) {
  return graph(`/${cfg().phoneId}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text, preview_url: previewUrl } },
  });
}

function sendTemplate(to, name, language = 'en_US', components) {
  const template = { name, language: { code: language } };
  if (components && components.length) template.components = components;
  return graph(`/${cfg().phoneId}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', to, type: 'template', template },
  });
}

function sendButtons(to, text, buttons) {
  return graph(`/${cfg().phoneId}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text },
        action: { buttons: buttons.slice(0, 3).map((b, i) => ({ type: 'reply', reply: { id: `btn_${i}`, title: b.slice(0, 20) } })) },
      },
    },
  });
}

// Bot question with choices: reply buttons (≤3 short options) or a list (≤10 rows).
// Row/button ids are opt_<index> so a tap maps back to the full option label.
function sendOptions(to, text, options, shortTitles = {}) {
  const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + '…');
  const opts = options.slice(0, 10);
  const useButtons = opts.length <= 3 && opts.every((o) => o.length <= 20) && text.length <= 1024;
  const interactive = useButtons
    ? { type: 'button', body: { text }, action: { buttons: opts.map((o, i) => ({ type: 'reply', reply: { id: `opt_${i}`, title: o } })) } }
    : {
        type: 'list',
        body: { text: cut(text, 4096) },
        action: {
          button: 'Choose an option',
          sections: [{ title: 'Options', rows: opts.map((o, i) => {
            const title = cut(shortTitles[o] || o, 24);
            return { id: `opt_${i}`, title, ...(title !== o ? { description: cut(o, 72) } : {}) };
          }) }],
        },
      };
  return graph(`/${cfg().phoneId}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', to, type: 'interactive', interactive } });
}

function markRead(messageId) {
  return graph(`/${cfg().phoneId}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
  });
}

// Marks the message read and shows "typing…" to the customer while the AI writes
function typing(messageId) {
  return graph(`/${cfg().phoneId}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } },
  });
}

function listTemplates() {
  return graph(`/${cfg().wabaId}/message_templates`, { query: { limit: 200, fields: 'name,status,category,language,components' } });
}

function phoneInfo() {
  return graph(`/${cfg().phoneId}`, { query: { fields: 'display_phone_number,verified_name,quality_rating,code_verification_status,messaging_limit_tier' } });
}

// Media: get temporary URL, then download with auth
async function downloadMedia(mediaId) {
  const meta = await graph(`/${mediaId}`);
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${cfg().token}` } });
  if (!res.ok) throw new Error(`Media download failed: HTTP ${res.status}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: meta.mime_type || res.headers.get('content-type') };
}

// Point the Meta app webhook at our public URL and subscribe the WABA to the app
async function registerWebhook(callbackUrl) {
  const { token, secret, wabaId, verifyToken } = cfg();
  const app = await graph('/app', { token });
  const appToken = `${app.id}|${secret}`;
  const url = new URL(`${base()}/${app.id}/subscriptions`);
  const form = new URLSearchParams({
    object: 'whatsapp_business_account',
    callback_url: callbackUrl,
    verify_token: verifyToken,
    fields: 'messages',
    include_values: 'true',
    access_token: appToken,
  });
  const r = await fetch(url, { method: 'POST', body: form });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error('App subscription failed: ' + (d.error ? d.error.message : `HTTP ${r.status}`));
  await graph(`/${wabaId}/subscribed_apps`, { method: 'POST' });
  return { appId: app.id, appName: app.name };
}

function verifySignature(rawBody, header) {
  const secret = cfg().secret;
  if (!secret) return true; // not configured -> skip
  if (!header || !rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { cfg, graph, sendText, sendTemplate, sendButtons, sendOptions, markRead, typing, listTemplates, phoneInfo, downloadMedia, registerWebhook, verifySignature };
