// Tiny JSON-file database. Good for a single-instance CRM; swap for Postgres/SQLite later if needed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

// Pipeline stages = GreenBuddy lead statuses (see lib/venonto/spec.js)
const STAGES = require('./venonto/spec').STATUSES.map(({ id, name }) => ({ id, name }));
const OLD_STAGE_MAP = { contacted: 'started', proposal: 'handed' };

const DEFAULTS = {
  contacts: [],
  messages: [],
  tasks: [],
  notes: [],
  rules: [
    { id: 'r1', name: 'Pricing question', match: 'contains', keywords: ['price', 'pricing', 'cost'], reply: 'Thanks for asking! Our team will share pricing details with you shortly. 💼', enabled: true, hits: 0, setStage: 'qualified', addTag: 'pricing' },
    { id: 'r2', name: 'Greeting', match: 'exact', keywords: ['hi', 'hello', 'hey'], reply: 'Hi there 👋 How can we help you today?', enabled: true, hits: 0, setStage: '', addTag: '' },
  ],
  broadcasts: [],
  activity: [],
  settings: {
    botEnabled: true,
    aiEnabled: true,
    aiPersona: '', // extra instructions appended to the GreenBuddy prompt
    aiHandoffMessage: "I'll connect you with someone from our team now — they'll reply here shortly 🙏",
    aiFallbackMessage: 'Thanks for your message! 🙏 We will get back to you shortly.', // sent if AI fails and no keyword rule matches
    welcomeEnabled: true,
    welcomeMessage: 'Welcome! 👋 Thanks for contacting us. An agent will get back to you soon.',
    awayEnabled: false,
    awayMessage: 'We are currently offline. We will reply during business hours (Mon–Fri, 9:00–18:00).',
    businessHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    autoMarkRead: true,
    agents: ['Unassigned', 'Me'],
    quickReplies: [
      'Thanks for reaching out! How can I help you today?',
      'Could you please share your order number?',
      'Our team will get back to you within 1 business day.',
    ],
  },
  counters: { contact: 0, task: 0 },
};

let db;
function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (e) {
      console.error('[db] Could not parse db.json, backing it up and starting fresh:', e.message);
      fs.copyFileSync(FILE, FILE + '.corrupt-' + Date.now());
      db = {};
    }
  } else db = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (db[k] === undefined) db[k] = JSON.parse(JSON.stringify(v));
  }
  db.settings = { ...DEFAULTS.settings, ...db.settings };
  // migrate contacts from the old generic pipeline
  const ids = new Set(STAGES.map((s) => s.id));
  for (const c of db.contacts) if (!ids.has(c.stage)) c.stage = OLD_STAGE_MAP[c.stage] || 'new';
  for (const r of db.rules) if (r.setStage && !ids.has(r.setStage)) r.setStage = OLD_STAGE_MAP[r.setStage] || '';
  return db;
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 150);
}
function flush() {
  clearTimeout(timer);
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function logActivity(type, text, contactId = null) {
  db.activity.unshift({ id: id(), type, text, contactId, at: now() });
  if (db.activity.length > 500) db.activity.length = 500;
}

function findContactByWaId(waId) {
  return db.contacts.find((c) => c.waId === waId);
}

function createContact({ waId, name = '', profileName = '', ...rest }) {
  db.counters.contact += 1;
  const c = {
    id: id(),
    key: `CRM-${db.counters.contact}`,
    waId,
    phone: '+' + String(waId).replace(/^\+/, ''),
    name: name || profileName || '',
    profileName,
    email: '',
    company: '',
    stage: 'new',
    priority: 'medium',
    assignee: 'Unassigned',
    tags: [],
    value: 0,
    createdAt: now(),
    updatedAt: now(),
    lastMessageAt: null,
    lastMessage: '',
    lastInboundAt: null,
    unread: 0,
    botPaused: false,
    ...rest,
  };
  db.contacts.push(c);
  logActivity('contact', `New contact ${c.name || c.phone} (${c.key})`, c.id);
  save();
  return c;
}

module.exports = { load, save, flush, get: () => db, id, now, logActivity, findContactByWaId, createContact, STAGES };
