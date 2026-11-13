require('dotenv').config();
const path = require('path');
const express = require('express');
const store = require('./lib/store');
const wa = require('./lib/whatsapp');
const auth = require('./lib/auth');
const engine = require('./lib/venonto/engine');
const spec = require('./lib/venonto/spec');

const ON_VERCEL = !!process.env.VERCEL;
const PORT = Number(process.env.PORT) || 3000;
const app = express();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); // async route errors → 500

// Keep background work (webhook processing, broadcasts) alive after the response.
// On Vercel this uses waitUntil; locally the promise simply keeps running.
function keepAlive(promise) {
  const p = Promise.resolve(promise).catch((e) => console.error('[bg]', e));
  if (ON_VERCEL) { try { require('@vercel/functions').waitUntil(p); } catch (_) {} }
  return p;
}

// Tunnel guard (local only): requests through ngrok may only reach the webhook.
app.use((req, res, next) => {
  if (ON_VERCEL) return next();
  const viaTunnel = !!req.headers['x-forwarded-for'] || /ngrok/i.test(req.headers.host || '');
  if (viaTunnel && !req.path.startsWith('/webhook') && process.env.PUBLIC_CRM !== 'true') return res.status(403).type('text').send('Forbidden');
  next();
});
app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
const WEB_DIR = path.join(__dirname, 'web', 'dist');
if (!ON_VERCEL) app.use(express.static(WEB_DIR));

// ---------------------------------------------------------------- live events (SSE locally; Vercel UI polls)
const clients = new Set();
function emit(type, data = {}) {
  const payload = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const c of clients) c.write(payload);
}

// ---------------------------------------------------------------- helpers
const HOUR = 3600 * 1000;
const windowOpen = (c) => !!c.lastInboundAt && Date.now() - new Date(c.lastInboundAt).getTime() < 24 * HOUR;
const publicContact = (c, openTasks = 0) => ({ ...c, windowOpen: windowOpen(c), openTasks });

async function openTaskCounts() {
  const rows = await store.tasks.list({ status: { $ne: 'done' }, contactId: { $ne: null } });
  const m = {};
  for (const t of rows) m[t.contactId] = (m[t.contactId] || 0) + 1;
  return m;
}

// Send something to a contact and keep it in the timeline
async function sendToContact(contact, { text, template, language, components, buttons, options, by = 'agent' }) {
  const opts = (options && options.length ? options : buttons) || [];
  const msg = await store.messages.insert({
    contactId: contact.id,
    direction: 'out',
    type: template ? 'template' : opts.length ? 'interactive' : 'text',
    text: template ? `📄 Template: ${template}` : text,
    ...(template ? { template } : {}),
    ...(!template && opts.length ? { options: opts } : {}),
    by,
  });
  try {
    let r;
    if (template) r = await wa.sendTemplate(contact.waId, template, language, components);
    else if (opts.length) { r = await wa.sendOptions(contact.waId, text, opts, spec.SHORT); contact.lastOptions = opts; }
    else r = await wa.sendText(contact.waId, text);
    msg.wamid = r.messages && r.messages[0] && r.messages[0].id;
    msg.status = 'sent';
  } catch (e) {
    msg.status = 'failed';
    msg.error = e.message;
  }
  await store.messages.set(msg.id, { status: msg.status, ...(msg.wamid ? { wamid: msg.wamid } : {}), ...(msg.error ? { error: msg.error } : {}) });
  contact.lastMessageAt = msg.timestamp;
  contact.lastMessage = (by === 'bot' ? '🤖 ' : by === 'ai' ? '✨ ' : 'You: ') + msg.text;
  await store.contacts.save(contact);
  emit('message', { contactId: contact.id, message: msg });
  return msg;
}

function describeInbound(m) {
  switch (m.type) {
    case 'text': return m.text.body;
    case 'image': return m.image.caption || '📷 Image';
    case 'video': return m.video.caption || '🎬 Video';
    case 'audio': return '🎤 Voice message';
    case 'document': return `📎 ${m.document.filename || 'Document'}`;
    case 'sticker': return '🙂 Sticker';
    case 'location': return `📍 ${m.location.name || ''} ${m.location.latitude},${m.location.longitude}`.trim();
    case 'contacts': return `👤 Contact card: ${(m.contacts[0] && m.contacts[0].name && m.contacts[0].name.formatted_name) || ''}`;
    case 'interactive': { const r = m.interactive.button_reply || m.interactive.list_reply || {}; return r.title || '[interactive reply]'; }
    case 'button': return m.button.text;
    case 'reaction': return `Reacted ${m.reaction.emoji || ''}`;
    default: return `[${m.type} message]`;
  }
}

function inBusinessHours(s) {
  const d = new Date();
  const bh = s.businessHours || {};
  if (bh.days && !bh.days.includes(d.getDay())) return false;
  const hm = d.toTimeString().slice(0, 5);
  return hm >= (bh.start || '00:00') && hm <= (bh.end || '23:59');
}

function matchRule(rules, text) {
  const t = (text || '').toLowerCase().trim();
  if (!t) return null;
  return rules.find((r) => r.enabled && r.keywords.some((k) => {
    const kw = k.toLowerCase().trim();
    if (!kw) return false;
    if (r.match === 'exact') return t === kw;
    if (r.match === 'starts') return t.startsWith(kw);
    return t.includes(kw);
  }));
}

// ---------------------------------------------------------------- webhook (public)
app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('[webhook] verified by Meta ✔');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  const v = req.body?.entry?.[0]?.changes?.[0]?.value || {};
  console.log(`[webhook] POST from Meta: phone_number_id=${v.metadata?.phone_number_id || '?'} messages=${(v.messages || []).length} statuses=${(v.statuses || []).length}`);
  if (!wa.verifySignature(req.rawBody, req.get('x-hub-signature-256'))) {
    console.warn('[webhook] ✖ invalid signature — check WA_APP_SECRET (and NODEJS_HELPERS=0 on Vercel)');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // ack fast, process after
  keepAlive(handleWebhook(req.body));
});

async function handleWebhook(body) {
  if (body.object !== 'whatsapp_business_account') return;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      for (const s of v.statuses || []) await handleStatus(s);
      for (const m of v.messages || []) {
        const profile = (v.contacts || []).find((c) => c.wa_id === m.from) || {};
        await handleInbound(m, profile);
      }
    }
  }
}

async function handleStatus(s) {
  const msg = await store.messages.byWamid(s.id);
  if (!msg) return;
  const order = ['pending', 'sent', 'delivered', 'read'];
  if (s.status === 'failed') {
    await store.messages.set(msg.id, { status: 'failed', error: (s.errors && s.errors[0] && (s.errors[0].error_data?.details || s.errors[0].title)) || 'Failed' });
  } else if (order.indexOf(s.status) > order.indexOf(msg.status)) {
    await store.messages.set(msg.id, { status: s.status });
  }
  emit('status', { contactId: msg.contactId, messageId: msg.id, status: s.status });
}

async function handleInbound(m, profile) {
  if (await store.messages.byWamid(m.id)) return; // dedupe Meta retries
  let contact = await store.contacts.byWaId(m.from);
  const isNew = !contact;
  const profileName = profile.profile && profile.profile.name;
  if (!contact) contact = await store.contacts.create({ waId: m.from, profileName });
  else if (profileName && contact.profileName !== profileName) {
    contact.profileName = profileName;
    if (!contact.name) contact.name = profileName;
  }

  let text = describeInbound(m);
  if (m.type === 'interactive') { // tapped button / list row → the full option label offered
    const r = m.interactive.button_reply || m.interactive.list_reply || {};
    const hit = /^opt_(\d+)$/.exec(r.id || '');
    if (hit && contact.lastOptions && contact.lastOptions[Number(hit[1])]) text = contact.lastOptions[Number(hit[1])];
  }
  if (m.type === 'location') { // a pin goes straight onto the lead record
    const L = m.location;
    contact.lead = contact.lead || engine.newLead();
    contact.lead.mapPin = { lat: L.latitude, lng: L.longitude, name: L.name || '', address: L.address || '' };
    text = `📍 Shared a map pin: ${[L.name, L.address].filter(Boolean).join(', ') || 'location'} (${L.latitude},${L.longitude})`;
  }
  const media = ['image', 'video', 'audio', 'document', 'sticker'].includes(m.type) ? { id: m[m.type].id, mime: m[m.type].mime_type, filename: m[m.type].filename } : undefined;
  let msg;
  try {
    msg = await store.messages.insert({
      contactId: contact.id, direction: 'in', type: m.type, text, ...(media ? { media } : {}), wamid: m.id,
      timestamp: new Date(Number(m.timestamp) * 1000 || Date.now()).toISOString(),
    });
  } catch (e) { if (e.code === 11000) return; throw e; } // duplicate delivery handled by another request
  contact.lastInboundAt = msg.timestamp;
  contact.lastMessageAt = msg.timestamp;
  contact.lastMessage = text;
  contact.unread = (contact.unread || 0) + 1;
  await store.contacts.save(contact);
  console.log(`[in] ${contact.phone}: ${text}`);
  emit('message', { contactId: contact.id, message: msg, isNew, contactName: contact.name || contact.profileName || contact.phone });

  const s = await store.getSettings();
  if (s.autoMarkRead) wa.markRead(m.id).catch(() => {});
  if (!s.botEnabled || contact.botPaused || m.type === 'reaction') return;
  if (s.aiEnabled && engine.isConfigured()) return enqueueAi(contact.id, () => botReply(contact.id, msg, s));
  await ruleBot(contact, text, isNew, s);
}

// Classic keyword bot. Returns true if it sent anything.
async function ruleBot(contact, text, isNew, s) {
  let replied = false;
  if (isNew && s.welcomeEnabled && s.welcomeMessage) { await sendToContact(contact, { text: s.welcomeMessage, by: 'bot' }); replied = true; }
  if (s.awayEnabled && s.awayMessage && !inBusinessHours(s)) {
    const last = contact.lastAwayAt ? new Date(contact.lastAwayAt).getTime() : 0;
    if (Date.now() - last > 12 * HOUR) {
      contact.lastAwayAt = store.now();
      await sendToContact(contact, { text: s.awayMessage, by: 'bot' });
      replied = true;
    }
  }
  const rule = matchRule(await store.rules.list(), text);
  if (rule) {
    await store.rules.set(rule.id, { hits: (rule.hits || 0) + 1 });
    if (rule.setStage) contact.stage = rule.setStage;
    if (rule.addTag && !contact.tags.includes(rule.addTag)) contact.tags.push(rule.addTag);
    await store.logActivity('bot', `Rule “${rule.name}” replied to ${contact.name || contact.phone}`, contact.id);
    if (rule.reply) { await sendToContact(contact, { text: rule.reply, buttons: rule.buttons, by: 'bot' }); replied = true; }
    else await store.contacts.save(contact);
    emit('contact', { contactId: contact.id });
  }
  return replied;
}

// ---------------------------------------------------------------- AI replies (GreenBuddy)
const aiQueues = new Map(); // in-process ordering per customer (cross-instance safety comes from DB checks below)
function enqueueAi(contactId, job) {
  const next = (aiQueues.get(contactId) || Promise.resolve()).then(job).catch((e) => console.error('[ai]', e));
  aiQueues.set(contactId, next);
  next.finally(() => { if (aiQueues.get(contactId) === next) aiQueues.delete(contactId); });
  return next;
}

const botSettingsFrom = (s) => ({ ...spec.DEFAULT_BOT_SETTINGS, ...(s.bot || {}) });
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const TEMP_TO_PRIORITY = { Hot: 'urgent', Warm: 'high', Nurture: 'low', Cold: 'low' };

// Push the lead record's results onto the CRM contact: name, stage, tags, priority, tasks, notes.
async function syncLeadToContact(contact, effects) {
  const lead = contact.lead;
  const name = lead.fields.name;
  if (name && name !== 'Not shared' && (!contact.name || contact.name === contact.profileName)) contact.name = name;
  if (!['won', 'lost'].includes(contact.stage) && contact.stage !== lead.status) {
    await store.logActivity('stage', `${contact.key} ${contact.name || contact.phone}: ${spec.STATUSES.find((s) => s.id === contact.stage)?.name || contact.stage} → ${spec.STATUSES.find((s) => s.id === lead.status)?.name}`, contact.id);
    contact.stage = lead.status;
  }
  contact.tags = [...new Set([...(contact.tags || []), ...lead.tags])];
  if (lead.temperature && TEMP_TO_PRIORITY[lead.temperature]) contact.priority = TEMP_TO_PRIORITY[lead.temperature];
  const who = `${contact.name || contact.phone}${lead.fields.location || lead.fields.rasLocation ? ` (${lead.fields.location || lead.fields.rasLocation})` : ''}`;
  for (const t of effects.tasks) {
    if (await store.tasks.findOne({ contactId: contact.id, type: t.type, status: { $ne: 'done' } })) continue;
    await store.createTask({ title: `${t.type} — ${who}`, description: t.note || '', type: t.type, contactId: contact.id, priority: t.type === 'Hot Lead' ? 'urgent' : lead.temperature === 'Hot' ? 'high' : 'medium' });
  }
  if (effects.handover) {
    await store.notes.insert({ id: store.id(), contactId: contact.id, text: engine.handoverText(lead, contact), at: store.now(), by: 'GreenBuddy' });
    await store.logActivity('handover', `Handed to sales: ${who} — ${lead.nextStep || ''}`, contact.id);
    emit('notify', { kind: 'handover', contactId: contact.id, title: `New lead for sales: ${who}`, text: lead.nextStep || '' });
  }
  if (effects.hot) {
    await store.logActivity('hot', `🔥 Hot lead: ${who}`, contact.id);
    emit('notify', { kind: 'hot', contactId: contact.id, title: `🔥 Hot lead: ${who}`, text: 'Call first' });
  }
  if (effects.tasks.length) emit('task');
}

async function botReply(contactId, inbound, s) {
  const contact = await store.contacts.get(contactId);
  if (!contact || contact.botPaused) return;
  const newerArrived = (c) => c && c.lastInboundAt && c.lastInboundAt > inbound.timestamp;
  if (newerArrived(contact)) return; // the newer message's job answers with full context
  const last = await store.messages.last(contactId);
  if (!last || last.direction !== 'in') return; // already answered (several quick messages → one reply)
  if (inbound.wamid) wa.typing(inbound.wamid).catch(() => {});
  contact.lead = contact.lead || engine.newLead();
  const lead = contact.lead;
  if (spec.STATUS_RANK[contact.stage] !== undefined) lead.status = contact.stage; // sales may have moved it
  const b = botSettingsFrom(s);
  const afterHours = engine.isAfterHours(b) && lead.afterHoursNoticeDate !== todayIST();
  try {
    const r = await engine.runTurn({
      lead, botSettings: b, extraInstructions: s.aiPersona,
      messages: await store.messages.forContact(contactId, 60),
      ctx: { phone: contact.phone, profileName: contact.profileName, afterHours },
    });
    if (newerArrived(await store.contacts.get(contactId))) return;
    if (r.refused) throw new Error('The model declined this message');
    if (afterHours) lead.afterHoursNoticeDate = todayIST();
    const { reply, options, effects } = engine.applyTurn(lead, r.out);
    await syncLeadToContact(contact, effects);
    console.log(`[ai] ${contact.phone} [${lead.journey}/${lead.status}${lead.temperature ? '/' + lead.temperature : ''}]: ${reply.slice(0, 70).replace(/\n/g, ' ')} (${r.usage?.output_tokens ?? '?'} out tokens)`);
    await sendToContact(contact, { text: reply, options, by: 'ai' });
    emit('contact', { contactId: contact.id });
  } catch (e) {
    console.error('[ai] reply failed, using keyword bot instead:', e.message);
    await store.logActivity('ai', `AI reply failed for ${contact.name || contact.phone} (keyword bot answered): ${String(e.message).slice(0, 120)}`, contact.id);
    const replied = await ruleBot(contact, inbound.text, false, s);
    if (!replied && s.aiFallbackMessage) await sendToContact(contact, { text: s.aiFallbackMessage, by: 'bot' });
    emit('contact', { contactId: contact.id });
  }
}

// ---------------------------------------------------------------- auth: everything below /api needs a login
auth.routes(app);

app.get('/api/events', (req, res) => {
  if (ON_VERCEL) return res.status(204).end(); // serverless: the UI polls instead
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

app.get('/api/ai', (_req, res) => res.json({ configured: engine.isConfigured(), model: process.env.AI_MODEL || 'claude-sonnet-5-5', effort: process.env.AI_EFFORT || 'medium' }));

// ---- GreenBuddy bot: spec, settings, simulator
app.get('/api/bot/spec', (_req, res) => res.json({ ...engine.specForUi(), defaults: spec.DEFAULT_BOT_SETTINGS }));
app.get('/api/bot/settings', ah(async (_req, res) => res.json(botSettingsFrom(await store.getSettings()))));
app.put('/api/bot/settings', ah(async (req, res) => {
  const allowed = ['botName', 'company', 'replyLanguage', 'siteVisitCity', 'siteVisitFee', 'workStart', 'workEnd', 'workDays', 'faq'];
  const s = await store.getSettings();
  const bot = { ...(s.bot || {}), ...Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k))) };
  res.json(botSettingsFrom(await store.saveSettings({ bot })));
}));

app.post('/api/bot/simulate', ah(async (req, res) => {
  const sid = String(req.body.session || 'default');
  const sim = (await store.sims.get(sid)) || { lead: engine.newLead('simulator'), messages: [] };
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Type a message' });
  sim.messages.push({ direction: 'in', text, status: 'received' });
  try {
    const s = await store.getSettings();
    const r = await engine.runTurn({ lead: sim.lead, messages: sim.messages, botSettings: botSettingsFrom(s), extraInstructions: s.aiPersona, ctx: { phone: '+91 98765 43210 (simulator)', profileName: 'Test customer', afterHours: !!req.body.afterHours } });
    if (r.refused) return res.status(502).json({ error: 'The model declined this message' });
    const { reply, options, effects } = engine.applyTurn(sim.lead, r.out);
    sim.messages.push({ direction: 'out', text: reply, options, status: 'sent' });
    await store.sims.save(sid, sim);
    res.json({ reply, options, lead: sim.lead, effects, missing: engine.missingFields(sim.lead), raw: r.out, usage: r.usage, handover: effects.handover ? engine.handoverText(sim.lead, { phone: 'simulator' }) : null });
  } catch (e) {
    res.status(e.status === 401 ? 401 : 502).json({ error: e.status === 401 ? 'Anthropic rejected the API key (401).' : e.message });
  }
}));
app.post('/api/bot/simulate/reset', ah(async (req, res) => { await store.sims.remove(String(req.body.session || 'default')); res.json({ ok: true }); }));

// ---------------------------------------------------------------- API: system
let ngrok = null; // loaded only when running locally
const tunnelState = () => (ON_VERCEL
  ? { publicUrl: `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL}`, status: 'online', error: null }
  : ngrok ? ngrok.state : { publicUrl: null, status: 'idle', error: null });
const webhookUrl = () => (tunnelState().publicUrl ? tunnelState().publicUrl + '/webhook' : null);
const system = { webhookRegistered: null, webhookError: null };

function configSummary() {
  const c = wa.cfg();
  const t = tunnelState();
  return {
    phoneId: c.phoneId, wabaId: c.wabaId, verifyToken: c.verifyToken, graphVersion: c.version, hasToken: !!c.token, hasSecret: !!c.secret,
    publicUrl: t.publicUrl, webhookUrl: webhookUrl(), ngrokStatus: t.status, ngrokError: t.error,
    webhookRegistered: system.webhookRegistered, webhookError: system.webhookError,
    localUrl: ON_VERCEL ? t.publicUrl : `http://localhost:${PORT}`, hosting: ON_VERCEL ? 'vercel' : 'local', realtime: ON_VERCEL ? 'poll' : 'sse',
  };
}

app.get('/api/bootstrap', ah(async (_req, res) => res.json({ stages: store.STAGES, settings: await store.getSettings(), config: configSummary() })));
app.get('/api/system', ah(async (_req, res) => {
  let phone = null; let phoneError = null;
  try { phone = await wa.phoneInfo(); } catch (e) { phoneError = e.message; }
  res.json({ ...configSummary(), phone, phoneError });
}));

async function doRegister() {
  if (!webhookUrl()) throw new Error('No public URL yet');
  const r = await wa.registerWebhook(webhookUrl());
  system.webhookRegistered = { url: webhookUrl(), at: store.now(), ...r };
  system.webhookError = null;
  await store.logActivity('system', `Webhook registered with Meta → ${webhookUrl()}`);
  return system.webhookRegistered;
}
app.post('/api/system/register-webhook', ah(async (_req, res) => {
  try { res.json(await doRegister()); } catch (e) { system.webhookError = e.message; res.status(400).json({ error: e.message }); }
}));
app.post('/api/system/ngrok/restart', ah(async (_req, res) => {
  if (ON_VERCEL || !ngrok) return res.status(400).json({ error: 'No ngrok tunnel in this environment' });
  await ngrok.stop();
  await ngrok.start(PORT);
  emit('system');
  res.json(configSummary());
}));

// ---------------------------------------------------------------- API: dashboard
app.get('/api/stats', ah(async (_req, res) => {
  const all = await store.contacts.list();
  const tasks = await store.tasks.list();
  const weekAgo = Date.now() - 7 * 24 * HOUR;
  const byStage = Object.fromEntries(store.STAGES.map((s) => [s.id, 0]));
  let pipelineValue = 0;
  for (const c of all) { byStage[c.stage] = (byStage[c.stage] || 0) + 1; if (!['won', 'lost'].includes(c.stage)) pipelineValue += Number(c.value) || 0; }
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 6);
  const recent = await store.messages.since(start.toISOString());
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const next = d.getTime() + 24 * HOUR;
    const inDay = recent.filter((m) => { const t = new Date(m.timestamp).getTime(); return t >= d.getTime() && t < next; });
    days.push({ date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, in: inDay.filter((m) => m.direction === 'in').length, out: inDay.filter((m) => m.direction === 'out').length });
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  res.json({
    contacts: all.length,
    newThisWeek: all.filter((c) => new Date(c.createdAt).getTime() > weekAgo).length,
    unread: all.reduce((a, c) => a + (c.unread || 0), 0),
    openConversations: all.filter(windowOpen).length,
    messagesToday: await store.messages.count({ timestamp: { $gte: new Date(Date.now() - 24 * HOUR).toISOString() } }),
    botReplies: await store.messages.count({ by: 'bot' }),
    aiReplies: await store.messages.count({ by: 'ai' }),
    failed: await store.messages.count({ status: 'failed' }),
    openTasks: tasks.filter((t) => t.status !== 'done').length,
    overdueTasks: tasks.filter((t) => t.status !== 'done' && t.dueDate && new Date(t.dueDate) < today).length,
    won: byStage.won || 0, pipelineValue, byStage, days,
    byService: Object.fromEntries(spec.SERVICES.map((s) => [s.id, all.filter((c) => c.lead?.service === s.id).length])),
    byTemperature: Object.fromEntries(['Hot', 'Warm', 'Nurture', 'Cold'].map((t) => [t, all.filter((c) => c.lead?.temperature === t).length])),
    hotLeads: all.filter((c) => c.lead?.temperature === 'Hot' && !['won', 'lost'].includes(c.stage)).map((c) => ({ id: c.id, key: c.key, name: c.name || c.phone, service: c.lead.service, location: c.lead.fields.location || c.lead.fields.rasLocation || '', nextStep: c.lead.nextStep || '', status: c.stage })),
  });
}));
app.get('/api/activity', ah(async (_req, res) => res.json(await store.listActivity(100))));

// ---------------------------------------------------------------- API: contacts
app.get('/api/contacts', ah(async (req, res) => {
  const { q, stage, tag, assignee } = req.query;
  let list = await store.contacts.list();
  if (q) { const s = q.toLowerCase(); list = list.filter((c) => [c.name, c.phone, c.email, c.company, c.key, c.profileName, ...(c.tags || [])].some((x) => (x || '').toLowerCase().includes(s))); }
  if (stage) list = list.filter((c) => c.stage === stage);
  if (tag) list = list.filter((c) => (c.tags || []).includes(tag));
  if (assignee) list = list.filter((c) => c.assignee === assignee);
  list.sort((a, b) => (b.lastMessageAt || b.createdAt).localeCompare(a.lastMessageAt || a.createdAt));
  const counts = await openTaskCounts();
  res.json(list.map((c) => publicContact(c, counts[c.id] || 0)));
}));

app.get('/api/contacts.csv', ah(async (_req, res) => {
  const cols = ['key', 'name', 'phone', 'email', 'company', 'stage', 'priority', 'assignee', 'value', 'tags', 'createdAt', 'lastMessageAt'];
  const esc = (v) => `"${String(Array.isArray(v) ? v.join('|') : v ?? '').replace(/"/g, '""')}"`;
  const all = await store.contacts.list();
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="contacts.csv"' });
  res.send([cols.join(','), ...all.map((c) => cols.map((k) => esc(c[k])).join(','))].join('\n'));
}));

app.post('/api/contacts', ah(async (req, res) => {
  const waId = String(req.body.phone || '').replace(/\D/g, '');
  if (waId.length < 8) return res.status(400).json({ error: 'Enter a phone number with country code, e.g. 919876543210' });
  if (await store.contacts.byWaId(waId)) return res.status(409).json({ error: 'A contact with this number already exists' });
  const { name, email, company, stage, priority, assignee, value, tags } = req.body;
  const c = await store.contacts.create({ waId, name, email: email || '', company: company || '', stage: stage || 'new', priority: priority || 'medium', assignee: assignee || 'Unassigned', value: Number(value) || 0, tags: tags || [] });
  emit('contact', { contactId: c.id });
  res.json(publicContact(c));
}));

app.get('/api/contacts/:id', ah(async (req, res) => {
  const c = await store.contacts.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const [messages, tasks, notes, activity] = await Promise.all([
    store.messages.forContact(c.id), store.tasks.list({ contactId: c.id }), store.notes.list({ contactId: c.id }, { at: -1 }), store.listActivity(30, c.id),
  ]);
  res.json({ ...publicContact(c, tasks.filter((t) => t.status !== 'done').length), messages, tasks, notes, activity });
}));

const EDITABLE = ['name', 'email', 'company', 'stage', 'priority', 'assignee', 'value', 'tags', 'botPaused'];
app.patch('/api/contacts/:id', ah(async (req, res) => {
  const c = await store.contacts.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  for (const k of EDITABLE) if (k in req.body) {
    if (k === 'stage' && c.stage !== req.body.stage) {
      const from = store.STAGES.find((s) => s.id === c.stage)?.name; const to = store.STAGES.find((s) => s.id === req.body.stage)?.name;
      await store.logActivity('stage', `${c.key} ${c.name || c.phone}: ${from} → ${to}`, c.id);
    }
    c[k] = k === 'value' ? Number(req.body[k]) || 0 : req.body[k];
  }
  if (c.lead && 'stage' in req.body) c.lead.status = c.stage;
  if (c.lead && req.body.leadFields && typeof req.body.leadFields === 'object') { // sales corrections to the bot's record
    for (const [k, v] of Object.entries(req.body.leadFields)) if (spec.FIELDS[k]) c.lead.fields[k] = String(v);
    engine.computeDerived(c.lead);
    c.tags = [...new Set([...(c.tags || []), ...c.lead.tags])];
  }
  await store.contacts.save(c);
  emit('contact', { contactId: c.id });
  res.json(publicContact(c));
}));

app.delete('/api/contacts/:id', ah(async (req, res) => {
  const c = await store.contacts.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  await store.contacts.remove(c.id);
  emit('contact', { contactId: c.id, deleted: true });
  res.json({ ok: true });
}));

app.post('/api/contacts/:id/read', ah(async (req, res) => {
  await store.contacts.set(req.params.id, { unread: 0 });
  emit('contact', { contactId: req.params.id });
  res.json({ ok: true });
}));

app.post('/api/contacts/:id/messages', ah(async (req, res) => {
  const c = await store.contacts.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const { text, template, language, components, buttons } = req.body;
  if (!text && !template) return res.status(400).json({ error: 'Message text or template is required' });
  const msg = await sendToContact(c, { text, template, language, components, buttons });
  res.status(msg.status === 'failed' ? 502 : 200).json(msg);
}));

app.post('/api/contacts/:id/notes', ah(async (req, res) => {
  const c = await store.contacts.get(req.params.id);
  if (!c || !req.body.text) return res.status(400).json({ error: 'Bad request' });
  res.json(await store.notes.insert({ id: store.id(), contactId: c.id, text: req.body.text, at: store.now(), by: 'Me' }));
}));

app.get('/api/media/:id', ah(async (req, res) => {
  try {
    const { buffer, mime } = await wa.downloadMedia(req.params.id);
    res.set('Content-Type', mime || 'application/octet-stream').set('Cache-Control', 'private, max-age=86400').send(buffer);
  } catch (e) { res.status(502).json({ error: e.message }); }
}));

// ---------------------------------------------------------------- API: tasks
app.get('/api/tasks', ah(async (_req, res) => {
  const [tasks, all] = await Promise.all([store.tasks.list(), store.contacts.list()]);
  const byId = Object.fromEntries(all.map((c) => [c.id, c]));
  res.json(tasks.map((t) => ({ ...t, contact: t.contactId && byId[t.contactId] ? (({ id, key, name, phone }) => ({ id, key, name, phone }))(byId[t.contactId]) : null })));
}));
app.post('/api/tasks', ah(async (req, res) => {
  if (!req.body.title) return res.status(400).json({ error: 'Title is required' });
  const t = await store.createTask({ title: req.body.title, description: req.body.description || '', status: req.body.status || 'todo', priority: req.body.priority || 'medium', assignee: req.body.assignee || 'Unassigned', dueDate: req.body.dueDate || '', contactId: req.body.contactId || null });
  emit('task');
  res.json(t);
}));
app.patch('/api/tasks/:id', ah(async (req, res) => {
  const t = await store.tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const patch = {};
  for (const k of ['title', 'description', 'status', 'priority', 'assignee', 'dueDate', 'contactId']) if (k in req.body) patch[k] = req.body[k];
  await store.tasks.set(t.id, patch);
  if (req.body.status === 'done') await store.logActivity('task', `Completed ${t.key}: ${t.title}`, t.contactId);
  emit('task');
  res.json({ ...t, ...patch });
}));
app.delete('/api/tasks/:id', ah(async (req, res) => { await store.tasks.remove(req.params.id); emit('task'); res.json({ ok: true }); }));

// ---------------------------------------------------------------- API: fallback rules & settings
app.get('/api/rules', ah(async (_req, res) => res.json(await store.rules.list())));
app.post('/api/rules', ah(async (req, res) => {
  const r = { id: store.id(), name: req.body.name || 'New rule', match: req.body.match || 'contains', keywords: req.body.keywords || [], reply: req.body.reply || '', buttons: req.body.buttons || [], setStage: req.body.setStage || '', addTag: req.body.addTag || '', enabled: req.body.enabled !== false, hits: 0 };
  res.json(await store.rules.insert(r));
}));
app.patch('/api/rules/:id', ah(async (req, res) => {
  const r = await store.rules.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const patch = {};
  for (const k of ['name', 'match', 'keywords', 'reply', 'buttons', 'setStage', 'addTag', 'enabled']) if (k in req.body) patch[k] = req.body[k];
  await store.rules.set(r.id, patch);
  res.json({ ...r, ...patch });
}));
app.delete('/api/rules/:id', ah(async (req, res) => { await store.rules.remove(req.params.id); res.json({ ok: true }); }));
app.post('/api/rules/test', ah(async (req, res) => { const r = matchRule(await store.rules.list(), req.body.text); res.json(r ? { matched: true, rule: r } : { matched: false }); }));

app.get('/api/settings', ah(async (_req, res) => res.json(await store.getSettings())));
app.put('/api/settings', ah(async (req, res) => res.json(await store.saveSettings(req.body))));

// ---------------------------------------------------------------- API: templates & broadcasts
app.get('/api/templates', ah(async (_req, res) => {
  try { const r = await wa.listTemplates(); res.json(r.data || []); } catch (e) { res.status(502).json({ error: e.message }); }
}));

app.get('/api/broadcasts', ah(async (_req, res) => res.json(await store.broadcasts.list({}, { createdAt: -1 }))));
app.post('/api/broadcasts', ah(async (req, res) => {
  const { name, template, language, params = [], audience = {} } = req.body;
  if (!template) return res.status(400).json({ error: 'Choose a template' });
  let targets = await store.contacts.list();
  if (audience.contactIds && audience.contactIds.length) targets = targets.filter((c) => audience.contactIds.includes(c.id));
  else {
    if (audience.stage) targets = targets.filter((c) => c.stage === audience.stage);
    if (audience.tag) targets = targets.filter((c) => (c.tags || []).includes(audience.tag));
  }
  if (!targets.length) return res.status(400).json({ error: 'No contacts match this audience' });
  const b = await store.broadcasts.insert({ id: store.id(), name: name || `${template} broadcast`, template, language, total: targets.length, sent: 0, failed: 0, status: 'sending', createdAt: store.now(), errors: [] });
  res.json(b);
  keepAlive((async () => {
    await store.logActivity('broadcast', `Broadcast “${b.name}” started to ${b.total} contacts`);
    for (const c of targets) {
      const named = params.some((p) => isNaN(Number(p.key)));
      const parameters = params.map((p) => ({ type: 'text', text: String(p.value || '-').replace(/\{\{name\}\}/g, c.name || c.profileName || 'there'), ...(named ? { parameter_name: p.key } : {}) }));
      const m = await sendToContact(c, { template, language, components: parameters.length ? [{ type: 'body', parameters }] : undefined, by: 'broadcast' });
      if (m.status === 'failed') { b.failed++; b.errors.push(`${c.phone}: ${m.error}`); } else b.sent++;
      await store.broadcasts.set(b.id, { sent: b.sent, failed: b.failed, errors: b.errors });
      emit('broadcast', { broadcast: b });
      await new Promise((r) => setTimeout(r, 250));
    }
    await store.broadcasts.set(b.id, { status: 'done' });
    emit('broadcast', { broadcast: { ...b, status: 'done' } });
  })());
}));

// ---------------------------------------------------------------- errors & SPA (local)
app.use('/api', (err, _req, res, _next) => { console.error('[api]', err); res.status(500).json({ error: err.message || 'Server error' }); });
if (!ON_VERCEL) {
  app.get('*', (req, res, next) => (req.path.startsWith('/api') ? next() : res.sendFile(path.join(WEB_DIR, 'index.html'), (e) => e && res.status(500).send('Front end not built yet. Run: npm run build'))));
}

module.exports = app;

// ---------------------------------------------------------------- local boot (not used on Vercel)
if (require.main === module) {
  ngrok = require('./lib/ngrok');
  const server = app.listen(PORT, async () => {
    console.log(`\n  WhatsApp CRM running →  http://localhost:${PORT}`);
    if (!process.env.WA_TOKEN) console.warn('  ⚠ WA_TOKEN missing in .env');
    try { await store.database(); console.log('  MongoDB connected'); } catch (e) { console.error('  ✖ MongoDB:', e.message); }
    if (process.env.NGROK_AUTOSTART !== 'false') {
      const url = await ngrok.start(PORT);
      if (url) {
        console.log(`  Webhook URL      →  ${url}/webhook`);
        if (process.env.AUTO_REGISTER_WEBHOOK === 'true') doRegister().catch((e) => { system.webhookError = e.message; });
      } else console.warn(`  ⚠ ngrok failed: ${ngrok.state.error}\n`);
      emit('system');
    } else {
      const readTunnel = () => {
        try {
          const t = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'data', 'tunnel.json'), 'utf8'));
          if (t.url !== ngrok.state.publicUrl) { Object.assign(ngrok.state, { publicUrl: t.url, status: 'online', error: null }); emit('system'); }
        } catch (_) { if (ngrok.state.publicUrl) emit('system'); Object.assign(ngrok.state, { publicUrl: null, status: 'error', error: 'Tunnel not running — start it with: npm run tunnel' }); }
      };
      readTunnel();
      setInterval(readTunnel, 10_000);
      console.log(ngrok.state.publicUrl ? `  Webhook URL      →  ${ngrok.state.publicUrl}/webhook  (separate tunnel)` : '  ⚠ No tunnel — run: npm run tunnel');
    }
  });
  const shutdown = async () => { await ngrok.stop(); server.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
