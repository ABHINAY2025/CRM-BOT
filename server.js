require('dotenv').config();
const path = require('path');
const express = require('express');
const store = require('./lib/db');
const wa = require('./lib/whatsapp');
const ngrok = require('./lib/ngrok');
const engine = require('./lib/venonto/engine');
const spec = require('./lib/venonto/spec');

const db = store.load();
const PORT = Number(process.env.PORT) || 3000;
const app = express();

app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
const WEB_DIR = path.join(__dirname, 'web', 'dist');
app.use(express.static(WEB_DIR));

// ---------------------------------------------------------------- live events (SSE)
const clients = new Set();
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});
function emit(type, data = {}) {
  const payload = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const c of clients) c.write(payload);
}

// ---------------------------------------------------------------- helpers
const HOUR = 3600 * 1000;
const windowOpen = (c) => !!c.lastInboundAt && Date.now() - new Date(c.lastInboundAt).getTime() < 24 * HOUR;
const getContact = (id) => db.contacts.find((c) => c.id === id);

function publicContact(c) {
  return { ...c, windowOpen: windowOpen(c), openTasks: db.tasks.filter((t) => t.contactId === c.id && t.status !== 'done').length };
}

function storeMessage(m) {
  const msg = { id: store.id(), status: m.direction === 'out' ? 'pending' : 'received', timestamp: store.now(), ...m };
  db.messages.push(msg);
  store.save();
  return msg;
}

// Send something to a contact and keep it in the timeline
async function sendToContact(contact, { text, template, language, components, buttons, options, by = 'agent' }) {
  const opts = (options && options.length ? options : buttons) || [];
  const msg = storeMessage({
    contactId: contact.id,
    direction: 'out',
    type: template ? 'template' : opts.length ? 'interactive' : 'text',
    text: template ? `📄 Template: ${template}` : text,
    template: template || undefined,
    options: !template && opts.length ? opts : undefined,
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
  contact.lastMessageAt = msg.timestamp;
  contact.lastMessage = (by === 'bot' ? '🤖 ' : by === 'ai' ? '✨ ' : 'You: ') + msg.text;
  contact.updatedAt = store.now();
  store.save();
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
    case 'interactive': {
      const r = m.interactive.button_reply || m.interactive.list_reply || {};
      return r.title || '[interactive reply]';
    }
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

function matchRule(text) {
  const t = (text || '').toLowerCase().trim();
  if (!t) return null;
  return db.rules.find((r) => r.enabled && r.keywords.some((k) => {
    const kw = k.toLowerCase().trim();
    if (!kw) return false;
    if (r.match === 'exact') return t === kw;
    if (r.match === 'starts') return t.startsWith(kw);
    return t.includes(kw);
  }));
}

// ---------------------------------------------------------------- webhook
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
    console.warn('[webhook] ✖ invalid signature — check WA_APP_SECRET in .env');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // ack fast, process after
  handleWebhook(req.body).catch((e) => console.error('[webhook] processing error', e));
});

async function handleWebhook(body) {
  if (body.object !== 'whatsapp_business_account') return;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      for (const s of v.statuses || []) handleStatus(s);
      for (const m of v.messages || []) {
        const profile = (v.contacts || []).find((c) => c.wa_id === m.from) || {};
        await handleInbound(m, profile);
      }
    }
  }
}

function handleStatus(s) {
  const msg = db.messages.find((m) => m.wamid === s.id);
  if (!msg) return;
  const order = ['pending', 'sent', 'delivered', 'read'];
  if (s.status === 'failed') {
    msg.status = 'failed';
    msg.error = (s.errors && s.errors[0] && (s.errors[0].error_data?.details || s.errors[0].title)) || 'Failed';
  } else if (order.indexOf(s.status) > order.indexOf(msg.status)) {
    msg.status = s.status;
  }
  store.save();
  emit('status', { contactId: msg.contactId, messageId: msg.id, status: msg.status, error: msg.error });
}

async function handleInbound(m, profile) {
  if (db.messages.some((x) => x.wamid === m.id)) return; // dedupe retries
  let contact = store.findContactByWaId(m.from);
  const isNew = !contact;
  const profileName = profile.profile && profile.profile.name;
  if (!contact) contact = store.createContact({ waId: m.from, profileName });
  else if (profileName && contact.profileName !== profileName) {
    contact.profileName = profileName;
    if (!contact.name) contact.name = profileName;
  }

  let text = describeInbound(m);
  // A tapped button / list row → the full option label the bot offered
  if (m.type === 'interactive') {
    const r = m.interactive.button_reply || m.interactive.list_reply || {};
    const hit = /^opt_(\d+)$/.exec(r.id || '');
    if (hit && contact.lastOptions && contact.lastOptions[Number(hit[1])]) text = contact.lastOptions[Number(hit[1])];
  }
  // A WhatsApp location pin goes straight onto the lead record
  if (m.type === 'location') {
    const L = m.location;
    contact.lead = contact.lead || engine.newLead();
    contact.lead.mapPin = { lat: L.latitude, lng: L.longitude, name: L.name || '', address: L.address || '' };
    text = `📍 Shared a map pin: ${[L.name, L.address].filter(Boolean).join(', ') || 'location'} (${L.latitude},${L.longitude})`;
  }
  const media = ['image', 'video', 'audio', 'document', 'sticker'].includes(m.type) ? { id: m[m.type].id, mime: m[m.type].mime_type, filename: m[m.type].filename } : undefined;
  const msg = storeMessage({
    contactId: contact.id, direction: 'in', type: m.type, text, media, wamid: m.id,
    timestamp: new Date(Number(m.timestamp) * 1000 || Date.now()).toISOString(),
  });
  contact.lastInboundAt = msg.timestamp;
  contact.lastMessageAt = msg.timestamp;
  contact.lastMessage = text;
  contact.unread = (contact.unread || 0) + 1;
  contact.updatedAt = store.now();
  store.save();
  console.log(`[in] ${contact.phone}: ${text}`);
  emit('message', { contactId: contact.id, message: msg, isNew, contactName: contact.name || contact.profileName || contact.phone });

  if (db.settings.autoMarkRead) wa.markRead(m.id).catch(() => {});

  // ---- bot
  const s = db.settings;
  if (!s.botEnabled || contact.botPaused || m.type === 'reaction') return;
  if (s.aiEnabled && engine.isConfigured()) {
    enqueueAi(contact.id, () => botReply(contact, msg));
    return; // Claude handles the conversation; keyword rules are the fallback when AI is off or fails
  }
  await ruleBot(contact, text, isNew);
}

// Classic keyword bot. Returns true if it sent anything.
async function ruleBot(contact, text, isNew) {
  const s = db.settings;
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
  const rule = matchRule(text);
  if (rule) {
    rule.hits = (rule.hits || 0) + 1;
    if (rule.setStage) contact.stage = rule.setStage;
    if (rule.addTag && !contact.tags.includes(rule.addTag)) contact.tags.push(rule.addTag);
    store.logActivity('bot', `Rule “${rule.name}” replied to ${contact.name || contact.phone}`, contact.id);
    if (rule.reply) { await sendToContact(contact, { text: rule.reply, buttons: rule.buttons, by: 'bot' }); replied = true; }
    emit('contact', { contactId: contact.id });
  }
  return replied;
}

// ---------------------------------------------------------------- AI replies (Claude)
const aiQueues = new Map(); // one reply at a time per customer, in arrival order
function enqueueAi(contactId, job) {
  const next = (aiQueues.get(contactId) || Promise.resolve()).then(job).catch((e) => console.error('[ai]', e));
  aiQueues.set(contactId, next);
  next.finally(() => { if (aiQueues.get(contactId) === next) aiQueues.delete(contactId); });
}

const botSettings = () => ({ ...spec.DEFAULT_BOT_SETTINGS, ...(db.settings.bot || {}) });
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const TEMP_TO_PRIORITY = { Hot: 'urgent', Warm: 'high', Nurture: 'low', Cold: 'low' };

function createTask({ title, description = '', status = 'todo', priority = 'medium', assignee = 'Unassigned', dueDate = '', contactId = null, type = null }) {
  db.counters.task += 1;
  const t = { id: store.id(), key: `TASK-${db.counters.task}`, title, description, status, priority, assignee, dueDate, contactId, type, createdAt: store.now() };
  db.tasks.push(t);
  store.logActivity('task', `Created ${t.key}: ${t.title}`, contactId);
  return t;
}

// Push the lead record's results onto the CRM contact: name, stage, tags, priority, tasks, notes.
function syncLeadToContact(contact, effects) {
  const lead = contact.lead;
  const name = lead.fields.name;
  if (name && name !== 'Not shared' && (!contact.name || contact.name === contact.profileName)) contact.name = name;
  if (!['won', 'lost'].includes(contact.stage) && contact.stage !== lead.status) {
    store.logActivity('stage', `${contact.key} ${contact.name || contact.phone}: ${spec.STATUSES.find((s) => s.id === contact.stage)?.name || contact.stage} → ${spec.STATUSES.find((s) => s.id === lead.status)?.name}`, contact.id);
    contact.stage = lead.status;
  }
  contact.tags = [...new Set([...(contact.tags || []), ...lead.tags])];
  if (lead.temperature && TEMP_TO_PRIORITY[lead.temperature]) contact.priority = TEMP_TO_PRIORITY[lead.temperature];
  const who = `${contact.name || contact.phone}${lead.fields.location || lead.fields.rasLocation ? ` (${lead.fields.location || lead.fields.rasLocation})` : ''}`;
  for (const t of effects.tasks) {
    const open = db.tasks.find((x) => x.contactId === contact.id && x.type === t.type && x.status !== 'done');
    if (open) continue;
    createTask({ title: `${t.type} — ${who}`, description: t.note || '', type: t.type, contactId: contact.id, priority: t.type === 'Hot Lead' ? 'urgent' : lead.temperature === 'Hot' ? 'high' : 'medium' });
  }
  if (effects.handover) {
    db.notes.push({ id: store.id(), contactId: contact.id, text: engine.handoverText(lead, contact), at: store.now(), by: 'GreenBuddy' });
    store.logActivity('handover', `Handed to sales: ${who} — ${lead.nextStep || ''}`, contact.id);
    emit('notify', { kind: 'handover', contactId: contact.id, title: `New lead for sales: ${who}`, text: lead.nextStep || '' });
  }
  if (effects.hot) {
    store.logActivity('hot', `🔥 Hot lead: ${who}`, contact.id);
    emit('notify', { kind: 'hot', contactId: contact.id, title: `🔥 Hot lead: ${who}`, text: 'Call first' });
  }
  if (effects.tasks.length) emit('task');
}

async function botReply(contact, inbound) {
  const newerArrived = () => contact.lastInboundAt && contact.lastInboundAt > inbound.timestamp;
  if (newerArrived() || contact.botPaused) return; // the newer message's job answers with full context
  if (inbound.wamid) wa.typing(inbound.wamid).catch(() => {});
  // Several quick messages are answered once: skip if the latest message already has a reply
  const thread = db.messages.filter((x) => x.contactId === contact.id);
  const lastMsg = thread[thread.length - 1];
  if (!lastMsg || lastMsg.direction !== 'in') return;
  contact.lead = contact.lead || engine.newLead();
  const lead = contact.lead;
  if (spec.STATUS_RANK[contact.stage] !== undefined) lead.status = contact.stage; // sales may have moved it
  const b = botSettings();
  const afterHours = engine.isAfterHours(b) && lead.afterHoursNoticeDate !== todayIST();
  try {
    const r = await engine.runTurn({
      lead, botSettings: b, extraInstructions: db.settings.aiPersona,
      messages: db.messages.filter((x) => x.contactId === contact.id),
      ctx: { phone: contact.phone, profileName: contact.profileName, afterHours },
    });
    if (newerArrived()) return;
    if (r.refused) throw new Error('The model declined this message');
    if (afterHours) lead.afterHoursNoticeDate = todayIST();
    const { reply, options, effects } = engine.applyTurn(lead, r.out);
    syncLeadToContact(contact, effects);
    console.log(`[ai] ${contact.phone} [${lead.journey}/${lead.status}${lead.temperature ? '/' + lead.temperature : ''}]: ${reply.slice(0, 70).replace(/\n/g, ' ')} (${r.usage?.output_tokens ?? '?'} out tokens)`);
    await sendToContact(contact, { text: reply, options, by: 'ai' });
    store.save();
    emit('contact', { contactId: contact.id });
  } catch (e) {
    console.error('[ai] reply failed, using keyword bot instead:', e.message);
    store.logActivity('ai', `AI reply failed for ${contact.name || contact.phone} (keyword bot answered): ${String(e.message).slice(0, 120)}`, contact.id);
    // Never leave the customer without an answer: keyword rules, then a polite holding message
    const replied = await ruleBot(contact, inbound.text, false);
    if (!replied && db.settings.aiFallbackMessage) await sendToContact(contact, { text: db.settings.aiFallbackMessage, by: 'bot' });
    emit('contact', { contactId: contact.id });
  }
}

app.get('/api/ai', (_req, res) => res.json({
  configured: engine.isConfigured(), model: process.env.AI_MODEL || 'claude-sonnet-5-5', effort: process.env.AI_EFFORT || 'medium',
}));

// ---- GreenBuddy bot: spec, settings, simulator
app.get('/api/bot/spec', (_req, res) => res.json({ ...engine.specForUi(), defaults: spec.DEFAULT_BOT_SETTINGS }));
app.get('/api/bot/settings', (_req, res) => res.json(botSettings()));
app.put('/api/bot/settings', (req, res) => {
  const allowed = ['botName', 'company', 'replyLanguage', 'siteVisitCity', 'siteVisitFee', 'workStart', 'workEnd', 'workDays', 'faq'];
  db.settings.bot = { ...(db.settings.bot || {}), ...Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k))) };
  store.save();
  res.json(botSettings());
});

const simSessions = new Map(); // sandbox conversations: no WhatsApp, no CRM records
app.post('/api/bot/simulate', async (req, res) => {
  const id = String(req.body.session || 'default');
  if (!simSessions.has(id)) simSessions.set(id, { lead: engine.newLead('simulator'), messages: [] });
  const sim = simSessions.get(id);
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Type a message' });
  sim.messages.push({ direction: 'in', text, status: 'received' });
  try {
    const b = botSettings();
    const r = await engine.runTurn({ lead: sim.lead, messages: sim.messages, botSettings: b, extraInstructions: db.settings.aiPersona, ctx: { phone: '+91 98765 43210 (simulator)', profileName: 'Test customer', afterHours: !!req.body.afterHours } });
    if (r.refused) return res.status(502).json({ error: 'The model declined this message' });
    const { reply, options, effects } = engine.applyTurn(sim.lead, r.out);
    sim.messages.push({ direction: 'out', text: reply, options, status: 'sent' });
    res.json({ reply, options, lead: sim.lead, effects, missing: engine.missingFields(sim.lead), raw: r.out, usage: r.usage, handover: effects.handover ? engine.handoverText(sim.lead, { phone: 'simulator' }) : null });
  } catch (e) {
    sim.messages.pop();
    res.status(e.status === 401 ? 401 : 502).json({ error: e.status === 401 ? 'Anthropic rejected the API key (401).' : e.message });
  }
});
app.post('/api/bot/simulate/reset', (req, res) => { simSessions.delete(String(req.body.session || 'default')); res.json({ ok: true }); });

// ---------------------------------------------------------------- API: system
const webhookUrl = () => (ngrok.state.publicUrl ? ngrok.state.publicUrl + '/webhook' : null);

app.get('/api/bootstrap', (_req, res) => {
  res.json({ stages: store.STAGES, settings: db.settings, config: configSummary() });
});

function configSummary() {
  const c = wa.cfg();
  return {
    phoneId: c.phoneId, wabaId: c.wabaId, verifyToken: c.verifyToken, graphVersion: c.version,
    hasToken: !!c.token, hasSecret: !!c.secret,
    publicUrl: ngrok.state.publicUrl, webhookUrl: webhookUrl(),
    ngrokStatus: ngrok.state.status, ngrokError: ngrok.state.error,
    webhookRegistered: system.webhookRegistered, webhookError: system.webhookError, localUrl: `http://localhost:${PORT}`,
  };
}

const system = { webhookRegistered: null, webhookError: null };

app.get('/api/system', async (_req, res) => {
  let phone = null; let phoneError = null;
  try { phone = await wa.phoneInfo(); } catch (e) { phoneError = e.message; }
  res.json({ ...configSummary(), phone, phoneError });
});

async function doRegister() {
  if (!webhookUrl()) throw new Error('No public URL yet — ngrok is not online');
  const r = await wa.registerWebhook(webhookUrl());
  system.webhookRegistered = { url: webhookUrl(), at: store.now(), ...r };
  system.webhookError = null;
  store.logActivity('system', `Webhook registered with Meta → ${webhookUrl()}`);
  return system.webhookRegistered;
}
app.post('/api/system/register-webhook', async (_req, res) => {
  try { res.json(await doRegister()); } catch (e) { system.webhookError = e.message; res.status(400).json({ error: e.message }); }
});
app.post('/api/system/ngrok/restart', async (_req, res) => {
  await ngrok.stop();
  const url = await ngrok.start(PORT);
  emit('system');
  res.json(configSummary());
  if (url && process.env.AUTO_REGISTER_WEBHOOK === 'true') doRegister().catch((e) => { system.webhookError = e.message; });
});

// ---------------------------------------------------------------- API: dashboard
app.get('/api/stats', (_req, res) => {
  const dayAgo = Date.now() - 24 * HOUR;
  const weekAgo = Date.now() - 7 * 24 * HOUR;
  const byStage = Object.fromEntries(store.STAGES.map((s) => [s.id, 0]));
  let pipelineValue = 0;
  for (const c of db.contacts) { byStage[c.stage] = (byStage[c.stage] || 0) + 1; if (!['won', 'lost'].includes(c.stage)) pipelineValue += Number(c.value) || 0; }
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const next = d.getTime() + 24 * HOUR;
    const inDay = db.messages.filter((m) => { const t = new Date(m.timestamp).getTime(); return t >= d.getTime() && t < next; });
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // local date, not UTC
    days.push({ date: ymd, in: inDay.filter((m) => m.direction === 'in').length, out: inDay.filter((m) => m.direction === 'out').length });
  }
  res.json({
    contacts: db.contacts.length,
    newThisWeek: db.contacts.filter((c) => new Date(c.createdAt).getTime() > weekAgo).length,
    unread: db.contacts.reduce((a, c) => a + (c.unread || 0), 0),
    openConversations: db.contacts.filter(windowOpen).length,
    messagesToday: db.messages.filter((m) => new Date(m.timestamp).getTime() > dayAgo).length,
    botReplies: db.messages.filter((m) => m.by === 'bot').length,
    failed: db.messages.filter((m) => m.status === 'failed').length,
    openTasks: db.tasks.filter((t) => t.status !== 'done').length,
    overdueTasks: db.tasks.filter((t) => t.status !== 'done' && t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString())).length,
    won: byStage.won || 0,
    pipelineValue,
    byStage,
    days,
    byService: Object.fromEntries(spec.SERVICES.map((s) => [s.id, db.contacts.filter((c) => c.lead?.service === s.id).length])),
    byTemperature: Object.fromEntries(['Hot', 'Warm', 'Nurture', 'Cold'].map((t) => [t, db.contacts.filter((c) => c.lead?.temperature === t).length])),
    hotLeads: db.contacts.filter((c) => c.lead?.temperature === 'Hot' && !['won', 'lost'].includes(c.stage)).map((c) => ({ id: c.id, key: c.key, name: c.name || c.phone, service: c.lead.service, location: c.lead.fields.location || c.lead.fields.rasLocation || '', nextStep: c.lead.nextStep || '', status: c.stage })),
    aiReplies: db.messages.filter((m) => m.by === 'ai').length,
  });
});
app.get('/api/activity', (_req, res) => res.json(db.activity.slice(0, 100)));

// ---------------------------------------------------------------- API: contacts
app.get('/api/contacts', (req, res) => {
  const { q, stage, tag, assignee } = req.query;
  let list = db.contacts;
  if (q) { const s = q.toLowerCase(); list = list.filter((c) => [c.name, c.phone, c.email, c.company, c.key, c.profileName, ...(c.tags || [])].some((x) => (x || '').toLowerCase().includes(s))); }
  if (stage) list = list.filter((c) => c.stage === stage);
  if (tag) list = list.filter((c) => (c.tags || []).includes(tag));
  if (assignee) list = list.filter((c) => c.assignee === assignee);
  list = [...list].sort((a, b) => (b.lastMessageAt || b.createdAt).localeCompare(a.lastMessageAt || a.createdAt));
  res.json(list.map(publicContact));
});

app.get('/api/contacts.csv', (_req, res) => {
  const cols = ['key', 'name', 'phone', 'email', 'company', 'stage', 'priority', 'assignee', 'value', 'tags', 'createdAt', 'lastMessageAt'];
  const esc = (v) => `"${String(Array.isArray(v) ? v.join('|') : v ?? '').replace(/"/g, '""')}"`;
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="contacts.csv"' });
  res.send([cols.join(','), ...db.contacts.map((c) => cols.map((k) => esc(c[k])).join(','))].join('\n'));
});

app.post('/api/contacts', (req, res) => {
  const waId = String(req.body.phone || '').replace(/\D/g, '');
  if (waId.length < 8) return res.status(400).json({ error: 'Enter a phone number with country code, e.g. 919876543210' });
  if (store.findContactByWaId(waId)) return res.status(409).json({ error: 'A contact with this number already exists' });
  const { name, email, company, stage, priority, assignee, value, tags } = req.body;
  const c = store.createContact({ waId, name, email: email || '', company: company || '', stage: stage || 'new', priority: priority || 'medium', assignee: assignee || 'Unassigned', value: Number(value) || 0, tags: tags || [] });
  emit('contact', { contactId: c.id });
  res.json(publicContact(c));
});

app.get('/api/contacts/:id', (req, res) => {
  const c = getContact(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json({
    ...publicContact(c),
    messages: db.messages.filter((m) => m.contactId === c.id),
    tasks: db.tasks.filter((t) => t.contactId === c.id),
    notes: db.notes.filter((n) => n.contactId === c.id).sort((a, b) => b.at.localeCompare(a.at)),
    activity: db.activity.filter((a) => a.contactId === c.id).slice(0, 30),
  });
});

const EDITABLE = ['name', 'email', 'company', 'stage', 'priority', 'assignee', 'value', 'tags', 'botPaused'];
app.patch('/api/contacts/:id', (req, res) => {
  const c = getContact(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  for (const k of EDITABLE) if (k in req.body) {
    if (k === 'stage' && c.stage !== req.body.stage) {
      const from = store.STAGES.find((s) => s.id === c.stage)?.name; const to = store.STAGES.find((s) => s.id === req.body.stage)?.name;
      store.logActivity('stage', `${c.key} ${c.name || c.phone}: ${from} → ${to}`, c.id);
    }
    c[k] = k === 'value' ? Number(req.body[k]) || 0 : req.body[k];
  }
  if (c.lead && 'stage' in req.body) c.lead.status = c.stage;
  if (c.lead && req.body.leadFields && typeof req.body.leadFields === 'object') { // sales corrections to the bot's record
    for (const [k, v] of Object.entries(req.body.leadFields)) if (spec.FIELDS[k]) c.lead.fields[k] = String(v);
    engine.computeDerived(c.lead);
    c.tags = [...new Set([...(c.tags || []), ...c.lead.tags])];
  }
  c.updatedAt = store.now();
  store.save();
  emit('contact', { contactId: c.id });
  res.json(publicContact(c));
});

app.delete('/api/contacts/:id', (req, res) => {
  const i = db.contacts.findIndex((c) => c.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  const [c] = db.contacts.splice(i, 1);
  db.messages = db.messages.filter((m) => m.contactId !== c.id);
  db.notes = db.notes.filter((n) => n.contactId !== c.id);
  db.tasks.forEach((t) => { if (t.contactId === c.id) t.contactId = null; });
  store.save();
  emit('contact', { contactId: c.id, deleted: true });
  res.json({ ok: true });
});

app.post('/api/contacts/:id/read', (req, res) => {
  const c = getContact(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.unread = 0; store.save(); emit('contact', { contactId: c.id });
  res.json({ ok: true });
});

app.post('/api/contacts/:id/messages', async (req, res) => {
  const c = getContact(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const { text, template, language, components, buttons } = req.body;
  if (!text && !template) return res.status(400).json({ error: 'Message text or template is required' });
  const msg = await sendToContact(c, { text, template, language, components, buttons });
  res.status(msg.status === 'failed' ? 502 : 200).json(msg);
});

app.post('/api/contacts/:id/notes', (req, res) => {
  const c = getContact(req.params.id);
  if (!c || !req.body.text) return res.status(400).json({ error: 'Bad request' });
  const n = { id: store.id(), contactId: c.id, text: req.body.text, at: store.now(), by: 'Me' };
  db.notes.push(n); store.save();
  res.json(n);
});

app.get('/api/media/:id', async (req, res) => {
  try {
    const { buffer, mime } = await wa.downloadMedia(req.params.id);
    res.set('Content-Type', mime || 'application/octet-stream').set('Cache-Control', 'private, max-age=86400').send(buffer);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---------------------------------------------------------------- API: tasks
app.get('/api/tasks', (_req, res) => {
  res.json(db.tasks.map((t) => ({ ...t, contact: t.contactId ? (({ id, key, name, phone }) => ({ id, key, name, phone }))(getContact(t.contactId) || {}) : null })));
});
app.post('/api/tasks', (req, res) => {
  if (!req.body.title) return res.status(400).json({ error: 'Title is required' });
  db.counters.task += 1;
  const t = { id: store.id(), key: `TASK-${db.counters.task}`, title: req.body.title, description: req.body.description || '', status: req.body.status || 'todo', priority: req.body.priority || 'medium', assignee: req.body.assignee || 'Unassigned', dueDate: req.body.dueDate || '', contactId: req.body.contactId || null, createdAt: store.now() };
  db.tasks.push(t);
  store.logActivity('task', `Created ${t.key}: ${t.title}`, t.contactId);
  store.save(); emit('task');
  res.json(t);
});
app.patch('/api/tasks/:id', (req, res) => {
  const t = db.tasks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  for (const k of ['title', 'description', 'status', 'priority', 'assignee', 'dueDate', 'contactId']) if (k in req.body) t[k] = req.body[k];
  if (req.body.status === 'done') store.logActivity('task', `Completed ${t.key}: ${t.title}`, t.contactId);
  store.save(); emit('task');
  res.json(t);
});
app.delete('/api/tasks/:id', (req, res) => {
  db.tasks = db.tasks.filter((t) => t.id !== req.params.id);
  store.save(); emit('task');
  res.json({ ok: true });
});

// ---------------------------------------------------------------- API: automations
app.get('/api/rules', (_req, res) => res.json(db.rules));
app.post('/api/rules', (req, res) => {
  const r = { id: store.id(), name: req.body.name || 'New rule', match: req.body.match || 'contains', keywords: req.body.keywords || [], reply: req.body.reply || '', buttons: req.body.buttons || [], setStage: req.body.setStage || '', addTag: req.body.addTag || '', enabled: req.body.enabled !== false, hits: 0 };
  db.rules.push(r); store.save();
  res.json(r);
});
app.patch('/api/rules/:id', (req, res) => {
  const r = db.rules.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  for (const k of ['name', 'match', 'keywords', 'reply', 'buttons', 'setStage', 'addTag', 'enabled']) if (k in req.body) r[k] = req.body[k];
  store.save();
  res.json(r);
});
app.delete('/api/rules/:id', (req, res) => { db.rules = db.rules.filter((r) => r.id !== req.params.id); store.save(); res.json({ ok: true }); });
app.post('/api/rules/test', (req, res) => { const r = matchRule(req.body.text); res.json(r ? { matched: true, rule: r } : { matched: false }); });

app.get('/api/settings', (_req, res) => res.json(db.settings));
app.put('/api/settings', (req, res) => { db.settings = { ...db.settings, ...req.body }; store.save(); res.json(db.settings); });

// ---------------------------------------------------------------- API: templates & broadcasts
app.get('/api/templates', async (_req, res) => {
  try { const r = await wa.listTemplates(); res.json(r.data || []); } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/broadcasts', (_req, res) => res.json(db.broadcasts));
app.post('/api/broadcasts', async (req, res) => {
  const { name, template, language, params = [], audience = {} } = req.body;
  if (!template) return res.status(400).json({ error: 'Choose a template' });
  let targets = db.contacts;
  if (audience.contactIds && audience.contactIds.length) targets = targets.filter((c) => audience.contactIds.includes(c.id));
  else {
    if (audience.stage) targets = targets.filter((c) => c.stage === audience.stage);
    if (audience.tag) targets = targets.filter((c) => (c.tags || []).includes(audience.tag));
  }
  if (!targets.length) return res.status(400).json({ error: 'No contacts match this audience' });
  const b = { id: store.id(), name: name || `${template} broadcast`, template, language, total: targets.length, sent: 0, failed: 0, status: 'sending', createdAt: store.now(), errors: [] };
  db.broadcasts.unshift(b); store.save();
  res.json(b);
  store.logActivity('broadcast', `Broadcast “${b.name}” started to ${b.total} contacts`);
  for (const c of targets) {
    const named = params.some((p) => isNaN(Number(p.key)));
    const parameters = params.map((p) => ({
      type: 'text',
      text: String(p.value || '-').replace(/\{\{name\}\}/g, c.name || c.profileName || 'there'),
      ...(named ? { parameter_name: p.key } : {}),
    }));
    const components = parameters.length ? [{ type: 'body', parameters }] : undefined;
    const m = await sendToContact(c, { template, language, components, by: 'broadcast' });
    if (m.status === 'failed') { b.failed++; b.errors.push(`${c.phone}: ${m.error}`); } else b.sent++;
    emit('broadcast', { broadcast: b });
    await new Promise((r) => setTimeout(r, 250));
  }
  b.status = 'done'; store.save(); emit('broadcast', { broadcast: b });
});

app.get('*', (req, res, next) => (req.path.startsWith('/api') ? next() : res.sendFile(path.join(WEB_DIR, 'index.html'), (e) => e && res.status(500).send('Front end not built yet. Run: npm run build'))));

// ---------------------------------------------------------------- boot
const server = app.listen(PORT, async () => {
  console.log(`\n  WhatsApp CRM running →  http://localhost:${PORT}`);
  if (!process.env.WA_TOKEN) console.warn('  ⚠ WA_TOKEN missing in .env');
  if (process.env.NGROK_AUTOSTART !== 'false') {
    console.log('  Starting ngrok tunnel…');
    const url = await ngrok.start(PORT);
    if (url) {
      console.log(`  Public URL       →  ${url}`);
      console.log(`  Webhook URL      →  ${url}/webhook`);
      console.log(`  Verify token     →  ${process.env.WA_VERIFY_TOKEN}`);
      if (process.env.AUTO_REGISTER_WEBHOOK === 'true') {
        try { const r = await doRegister(); console.log(`  ✔ Webhook registered with Meta app "${r.appName}" (${r.appId})\n`); }
        catch (e) { system.webhookError = e.message; console.warn(`  ⚠ Auto webhook registration failed: ${e.message}\n    Paste the URL above into Meta → WhatsApp → Configuration manually.\n`); }
      }
    } else console.warn(`  ⚠ ngrok failed: ${ngrok.state.error}\n`);
    emit('system');
  } else {
    // Tunnel runs separately (`npm run tunnel`) so its URL survives server restarts
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

async function shutdown() { store.flush(); await ngrok.stop(); server.close(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
