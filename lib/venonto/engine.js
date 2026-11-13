// GreenBuddy engine: Claude handles the conversation and extraction; deterministic
// rules (from the spec) handle status, tags, fit, priority, tasks and handover.
const AnthropicModule = require('@anthropic-ai/sdk');
const Anthropic = AnthropicModule.default || AnthropicModule;
const S = require('./spec');
const { buildSystemPrompt } = require('./prompt');

const HISTORY = 30;
let client = null;
const getClient = () => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
};
const isConfigured = () => !!process.env.ANTHROPIC_API_KEY;

// ------------------------------------------------------------------ lead helpers
function newLead(channel = 'whatsapp') {
  const now = new Date().toISOString();
  return { service: null, journey: 'menu', channel, fields: {}, tags: [], status: 'new', nextStep: null, confirmed: {}, temperature: null, fit: null, mapPin: null, firstMessageAt: now, lastReplyAt: null, handoverAt: null, hotNotifiedAt: null, afterHoursNoticeDate: null };
}

const low = (v) => String(v || '').toLowerCase();
const has = (v, ...words) => words.some((w) => low(v).includes(w));
const filled = (v) => v !== undefined && v !== null && String(v).trim() !== '';

function journeyOf(lead) {
  const f = lead.fields;
  switch (lead.service) {
    case 'terrace': return 'terrace';
    case 'ras': return 'ras';
    case 'support': return 'support';
    case 'microgreens': case 'polyhouse': case 'other': return 'generic';
    case 'hydroponics': {
      const p = f.hydroPlan;
      if (!filled(p)) return 'hydro_unknown';
      if (has(p, 'commercial', 'farm to sell')) return 'hydro_commercial';
      if (has(p, 'training')) return 'hydro_training';
      if (has(p, 'visit')) return 'hydro_visit';
      if (has(p, 'explor')) return 'hydro_exploring';
      return 'hydro_home';
    }
    default: return 'menu';
  }
}

function missingFields(lead) {
  const j = S.JOURNEYS[journeyOf(lead)] || S.JOURNEYS.menu;
  let req = [...j.required];
  if (lead.service === 'ras' && has(lead.fields.fish, 'prawn', 'shrimp')) req.splice(req.indexOf('experience'), 0, 'salinity');
  if (journeyOf(lead) === 'hydro_commercial' && has(lead.fields.decisionMaker, 'someone else') && lead.fields.otherContact === undefined) req.push('otherContact');
  return req.filter((k) => !filled(lead.fields[k]));
}

/** Apply spec rules: derived fields, signal tags, fit/priority, status. Returns change flags. */
function computeDerived(lead) {
  const f = lead.fields;
  const tags = new Set(lead.tags);
  const before = { status: lead.status, temperature: lead.temperature };
  lead.journey = journeyOf(lead);

  // Current setup (terrace/home growers)
  const grow = f.grow || f.hydroGrow;
  if (filled(grow)) f.currentSetup = has(grow, 'upgrade', 'existing') ? 'Existing' : (f.currentSetup === 'Existing' ? 'Existing' : 'New');

  // Hydroponics commercial
  if (lead.journey === 'hydro_commercial') {
    if (has(f.currentSite, 'open land')) tags.add('Polyhouse Interest');
    if (filled(f.investment) && filled(f.timeline) && filled(f.decisionMaker)) {
      const hot = has(f.investment, 'ready') && has(f.timeline, 'within 1 month', '1 to 3') && has(f.decisionMaker, 'my decision', 'together', 'yes');
      const nurture = has(f.investment, 'no budget') || has(f.timeline, 'research');
      lead.temperature = hot ? 'Hot' : nurture ? 'Nurture' : 'Warm';
    }
  }

  // RAS signals + fit
  if (lead.service === 'ras') {
    const fish = f.fish;
    if (has(f.landOwnership, 'not yet')) tags.add('No Land');
    if (filled(f.wasteWater) && /^no\b/.test(low(f.wasteWater))) tags.add('Discharge Risk');
    if (has(f.power, 'cut', 'no power') && !has(fish, 'murrel', 'snakehead')) tags.add('Power Risk');
    if (filled(f.market) && !has(f.market, 'yes')) tags.add('Market Unverified');
    if (has(fish, 'not decided')) tags.add('Species Open');
    if (has(fish, 'prawn', 'shrimp')) tags.add('Prawns');
    if (has(fish, 'murrel', 'snakehead')) tags.add('Murrel Simple Tank');
    if (has(fish, 'trout', 'barramundi', 'sea bass')) tags.add('Technical / Sales Review');
    if (has(f.funding, 'loan', 'subsidy')) tags.add('Loan / Subsidy Support');
    if (has(f.budget, 'below 10')) tags.add('Small Budget');
    if (has(f.target, '20 to 50', 'above 50') && has(f.experience, 'never', 'little')) tags.add('Phase Plan Suggested');
    if (missingFields(lead).length === 0) {
      const notReady = (has(f.landOwnership, 'not yet') && /^no\b/.test(low(f.wasteWater))) || has(f.start, 'explor');
      const strong = has(f.landOwnership, 'own', 'lease', 'family') && !has(f.landOwnership, 'not yet') && has(f.waterYearRound, 'yes') && has(f.wasteWater, 'yes')
        && filled(fish) && !has(fish, 'not decided') && has(f.market, 'yes') && filled(f.funding) && !has(f.funding, 'not decided');
      lead.fit = notReady ? 'Not ready yet' : strong ? 'Strong' : 'Needs guidance';
      lead.temperature = notReady ? 'Cold' : strong ? 'Hot' : 'Warm';
    }
  }
  if (tags.has('Warm') && !lead.temperature) lead.temperature = 'Warm';
  lead.tags = [...tags];

  // Status (only moves forward; won/lost are set by sales)
  if (!['won', 'lost'].includes(lead.status)) {
    const up = (s) => { if (S.STATUS_RANK[s] > S.STATUS_RANK[lead.status]) lead.status = s; };
    if (filled(f.name)) up('started');
    if (lead.journey !== 'menu' && missingFields(lead).length === 0) up('qualified');
    if (lead.confirmed.siteVisit || lead.confirmed.expertCall) up('visit_requested');
    if (['callback', 'project_videos', 'project_team', 'subsidy_help'].includes(lead.nextStepId) || (lead.service === 'support' && filled(f.need))) up('handed');
  }
  return {
    statusChanged: before.status !== lead.status,
    becameHot: lead.temperature === 'Hot' && before.temperature !== 'Hot',
  };
}

// ------------------------------------------------------------------ Claude call
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'options', 'fields', 'tags', 'tasks', 'next_step', 'confirmed'],
  properties: {
    reply: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    fields: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['key', 'value'], properties: { key: { type: 'string', enum: S.FIELD_KEYS }, value: { type: 'string' } } },
    },
    tags: { type: 'array', items: { type: 'string', enum: S.MODEL_TAGS } },
    tasks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'note'], properties: { type: { type: 'string', enum: S.MODEL_TASKS }, note: { type: 'string' } } } },
    next_step: { type: 'string', enum: ['none', ...Object.keys(S.NEXT_STEPS)] },
    confirmed: { type: 'boolean' },
  },
};

function buildHistory(messages) {
  const turns = [];
  for (const m of messages.slice(-HISTORY)) {
    if (m.direction === 'out' && m.status === 'failed') continue;
    if (!m.text) continue;
    const role = m.direction === 'in' ? 'user' : 'assistant';
    let text = m.text;
    if (role === 'assistant' && m.options && m.options.length) text += `\n[options shown: ${m.options.join(' | ')}]`;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += '\n' + text;
    else turns.push({ role, content: text });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

function stateMessage(lead, ctx) {
  const missing = missingFields(lead);
  const j = S.JOURNEYS[journeyOf(lead)];
  const known = Object.entries(lead.fields).filter(([, v]) => filled(v)).map(([k, v]) => `${k}: ${v}`).join('; ') || 'nothing yet';
  return `LEAD STATE (internal — never reveal):
channel: WhatsApp — phone ${ctx.phone || 'known'} (never ask for it); WhatsApp profile name: ${ctx.profileName || 'unknown'}
service: ${lead.service || 'not chosen'} | journey: ${j ? j.label : 'menu'}
known: ${known}
map pin: ${lead.mapPin ? `shared (${lead.mapPin.name || lead.mapPin.address || `${lead.mapPin.lat},${lead.mapPin.lng}`})` : 'not shared'}
missing, ask next in this order: ${missing.length ? missing.map((k) => `${k} (${S.FIELDS[k].label})`).join(', ') : lead.journey === 'menu' ? 'service' : 'none — give the summary / handle the next step'}
next step so far: ${lead.nextStep || 'none'}${lead.confirmed.siteVisit ? ' (site visit request already shared)' : ''}${lead.confirmed.expertCall ? ' (expert call request already shared)' : ''}
priority: ${lead.temperature || 'not set'}
outside working hours: ${ctx.afterHours ? 'YES — add the after-hours line once at the start of this reply' : 'no'}
now: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;
}

async function runTurn({ lead, messages, botSettings, extraInstructions, ctx }) {
  const c = getClient();
  if (!c) throw new Error('ANTHROPIC_API_KEY is not set');
  const history = buildHistory(messages);
  if (!history.length || history[history.length - 1].role !== 'user') throw new Error('No customer message to answer');
  const response = await c.beta.messages.create({
    model: process.env.AI_MODEL || 'claude-sonnet-5-5',
    max_tokens: 6000,
    output_config: { effort: process.env.AI_EFFORT || 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: buildSystemPrompt(botSettings, extraInstructions), cache_control: { type: 'ephemeral' } }],
    messages: [...history, { role: 'system', content: stateMessage(lead, ctx) }],
  });
  if (response.stop_reason === 'refusal') return { refused: true, usage: response.usage };
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let out;
  try { out = JSON.parse(text); } catch (e) { throw new Error('Model returned invalid JSON'); }
  return { out, usage: response.usage, model: response.model };
}

/**
 * Merge the model's output into the lead and decide side effects.
 * Returns { reply, options, effects: { tasks, handover, hot, statusChanged } }.
 */
function applyTurn(lead, out) {
  const effects = { tasks: [], handover: false, hot: false, statusChanged: false, nameCaptured: false };
  const f = lead.fields;
  for (const { key, value } of out.fields || []) {
    if (!S.FIELD_KEYS.includes(key) || !filled(value)) continue;
    if (key === 'service') {
      const svc = S.SERVICES.find((s) => s.id === low(value).trim() || low(s.label) === low(value).trim());
      if (svc) lead.service = svc.id;
      continue;
    }
    if (key === 'name' && !filled(f.name)) effects.nameCaptured = true;
    f[key] = String(value).trim().slice(0, 300);
  }
  const tags = new Set(lead.tags);
  (out.tags || []).forEach((t) => S.MODEL_TAGS.includes(t) && tags.add(t));
  (out.tasks || []).forEach((t) => effects.tasks.push({ type: t.type, note: t.note }));

  // Next step → tags / tasks / confirmations
  const ns = out.next_step && out.next_step !== 'none' ? out.next_step : null;
  if (ns) {
    lead.nextStepId = ns;
    lead.nextStep = S.NEXT_STEPS[ns];
    if (ns === 'callback') { tags.add('Callback Required'); effects.tasks.push({ type: 'Callback Required', note: 'Customer asked for a call back' }); }
    if (ns === 'project_videos') { tags.add('Project Videos Required'); effects.tasks.push({ type: 'Project Videos Required', note: 'Share photos/videos of similar projects from the Google Drive folder' }); }
    if (ns === 'exploring') tags.add('Exploratory Lead');
    if (ns === 'project_team') effects.tasks.push({ type: 'Consultation Call', note: 'Commercial hydroponics — talk to project team' });
    if (ns === 'subsidy_help') { tags.add('Loan / Subsidy Support'); effects.tasks.push({ type: 'Subsidy Support', note: 'Explain government support schemes' }); }
    if (ns === 'not_now') tags.add('Warm');
    if (out.confirmed && ns === 'site_visit' && !lead.confirmed.siteVisit) {
      lead.confirmed.siteVisit = true; tags.add('Site Visit Requested');
      effects.tasks.push({ type: 'Site Visit Request', note: `Fix a date for the site visit${f.feeConsent ? ` (fee consent: ${f.feeConsent})` : ''}` });
    }
    if (out.confirmed && ns === 'expert_call' && !lead.confirmed.expertCall) {
      lead.confirmed.expertCall = true; tags.add('Expert Call Requested');
      effects.tasks.push({ type: 'Expert Call', note: `Call ${f.callTime || 'in working hours'}, language: ${f.callLanguage || 'not given'}` });
    }
  }
  if (lead.service === 'support') tags.add('Support Request');
  lead.tags = [...tags];

  const prevStatus = lead.status;
  const d = computeDerived(lead);
  effects.statusChanged = d.statusChanged;
  if (d.becameHot && !lead.hotNotifiedAt) {
    effects.hot = true;
    lead.hotNotifiedAt = new Date().toISOString();
    effects.tasks.push({ type: 'Hot Lead', note: 'Hot lead — call first' });
  }
  if (!lead.handoverAt && S.STATUS_RANK[lead.status] >= S.STATUS_RANK.visit_requested && S.STATUS_RANK[prevStatus] < S.STATUS_RANK[lead.status]) {
    effects.handover = true;
    lead.handoverAt = new Date().toISOString();
  }

  let reply = String(out.reply || '').trim();
  if (effects.hot && lead.journey === 'hydro_commercial' && !/project team will call you shortly/i.test(reply)) {
    const line = 'Thanks! One of our project team will call you shortly.';
    const at = reply.search(/what would you like to do next\?/i);
    reply = at >= 0 ? `${reply.slice(0, at)}${line}\n\n${reply.slice(at)}` : `${reply}\n\n${line}`;
  }
  lead.lastReplyAt = new Date().toISOString();
  return { reply, options: (out.options || []).filter(Boolean).slice(0, 10), effects };
}

/** One message for the sales team with every saved field, fit and tags */
function handoverText(lead, contact) {
  const j = S.JOURNEYS[lead.journey] || {};
  const lines = [`🤝 Handover to sales — ${S.SERVICES.find((s) => s.id === lead.service)?.label || 'Enquiry'} (${j.label || ''})`];
  lines.push(`Name: ${lead.fields.name || contact?.name || 'Not shared'} · Phone: ${contact?.phone || '-'} · Channel: ${lead.channel}`);
  for (const [k, v] of Object.entries(lead.fields)) {
    if (k === 'name' || !filled(v)) continue;
    lines.push(`${S.FIELDS[k]?.label || k}: ${v}`);
  }
  if (lead.mapPin) lines.push(`Map pin: https://maps.google.com/?q=${lead.mapPin.lat},${lead.mapPin.lng}`);
  if (lead.fit) lines.push(`Fit: ${lead.fit}`);
  if (lead.temperature) lines.push(`Priority: ${lead.temperature}`);
  if (lead.nextStep) lines.push(`Next step: ${lead.nextStep}`);
  if (lead.tags.length) lines.push(`Tags: ${lead.tags.join(', ')}`);
  lines.push(`First message: ${lead.firstMessageAt} · Last reply: ${lead.lastReplyAt}`);
  return lines.join('\n');
}

function isAfterHours(b, date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date).map((p) => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const hm = `${parts.hour}:${parts.minute}`;
  return !(b.workDays || []).includes(day) || hm < b.workStart || hm >= b.workEnd;
}

function specForUi() {
  return { services: S.SERVICES, statuses: S.STATUSES, fields: S.FIELDS, journeys: S.JOURNEYS, nextSteps: S.NEXT_STEPS, tags: S.TAGS, taskTypes: S.TASK_TYPES };
}

module.exports = { newLead, runTurn, applyTurn, computeDerived, missingFields, journeyOf, handoverText, isAfterHours, isConfigured, specForUi, buildHistory };
