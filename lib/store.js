// MongoDB data layer. Works the same locally and on Vercel (connection is cached across invocations).
// All CRM collections are prefixed (default "crm_") so they never clash with other apps in the same database.
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const spec = require('./venonto/spec');

const PREFIX = process.env.MONGO_PREFIX || 'crm_';
const STAGES = spec.STATUSES.map(({ id, name }) => ({ id, name }));

const DEFAULT_SETTINGS = {
  botEnabled: true,
  aiEnabled: true,
  aiPersona: '', // extra instructions appended to the GreenBuddy prompt
  aiFallbackMessage: 'Thanks for your message! 🙏 We will get back to you shortly.',
  welcomeEnabled: true,
  welcomeMessage: 'Welcome! 👋 Thanks for contacting us. An agent will get back to you soon.',
  awayEnabled: false,
  awayMessage: 'We are currently offline. We will reply during business hours.',
  businessHours: { start: '10:00', end: '18:00', days: [1, 2, 3, 4, 5, 6] },
  autoMarkRead: true,
  agents: ['Unassigned', 'Me'],
  quickReplies: [
    'Thanks for reaching out! How can I help you today?',
    'Our team will get back to you within 1 business day.',
  ],
};
const DEFAULT_RULES = [
  { id: 'r1', name: 'Pricing question', match: 'contains', keywords: ['price', 'pricing', 'cost'], reply: 'Thanks for asking! Our team will share pricing details with you shortly. 💼', enabled: true, hits: 0, setStage: 'qualified', addTag: 'pricing' },
  { id: 'r2', name: 'Greeting', match: 'exact', keywords: ['hi', 'hello', 'hey'], reply: 'Hi there 👋 How can we help you today?', enabled: true, hits: 0, setStage: '', addTag: '' },
];

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const NO_ID = { projection: { _id: 0 } };

// ------------------------------------------------------------------ connection
let ready = global.__crmDb;
function database() {
  if (!ready) {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set');
    ready = global.__crmDb = (async () => {
      const client = await new MongoClient(process.env.MONGO_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 }).connect();
      const db = client.db(process.env.MONGO_DB || undefined); // default: database named in the URI
      await Promise.all([
        db.collection(PREFIX + 'contacts').createIndex({ waId: 1 }, { unique: true }),
        db.collection(PREFIX + 'messages').createIndex({ contactId: 1, at: 1 }),
        db.collection(PREFIX + 'messages').createIndex({ touchedAt: -1 }),
        db.collection(PREFIX + 'contacts').createIndex({ updatedAt: -1 }),
        db.collection(PREFIX + 'messages').createIndex({ wamid: 1 }, { unique: true, partialFilterExpression: { wamid: { $type: 'string' } } }),
        db.collection(PREFIX + 'tasks').createIndex({ contactId: 1 }),
        db.collection(PREFIX + 'notes').createIndex({ contactId: 1 }),
        db.collection(PREFIX + 'activity').createIndex({ at: -1 }),
        db.collection(PREFIX + 'sims').createIndex({ updatedAt: 1 }, { expireAfterSeconds: 86400 }),
      ]).catch((e) => console.warn('[store] index setup:', e.message));
      return db;
    })().catch((e) => { ready = global.__crmDb = null; throw e; });
  }
  return ready;
}
const col = async (name) => (await database()).collection(PREFIX + name);
const withId = (doc) => ({ ...doc, _id: doc.id });

// ------------------------------------------------------------------ counters & settings
async function nextSeq(name) {
  const r = await (await col('counters')).findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return (r.value || r).seq;
}

async function getSettings() {
  const doc = await (await col('settings')).findOne({ _id: 'main' }, NO_ID);
  return { ...DEFAULT_SETTINGS, ...(doc || {}) };
}
async function saveSettings(patch) {
  const clean = { ...patch }; delete clean._id;
  await (await col('settings')).updateOne({ _id: 'main' }, { $set: clean }, { upsert: true });
  return getSettings();
}

// ------------------------------------------------------------------ activity
async function logActivity(type, text, contactId = null) {
  await (await col('activity')).insertOne({ _id: id(), type, text, contactId, at: now() });
}
const listActivity = async (limit = 100, contactId) => (await col('activity')).find(contactId ? { contactId } : {}, { projection: { _id: 0 } }).sort({ at: -1 }).limit(limit).toArray()
  .then((rows) => rows.map((r, i) => ({ id: r.id || `${r.at}-${i}`, ...r })));

// ------------------------------------------------------------------ contacts
const contacts = {
  list: async (filter = {}) => (await col('contacts')).find(filter, NO_ID).toArray(),
  get: async (cid) => (await col('contacts')).findOne({ _id: cid }, NO_ID),
  byWaId: async (waId) => (await col('contacts')).findOne({ waId }, NO_ID),
  async create({ waId, name = '', profileName = '', ...rest }) {
    const n = await nextSeq('contact');
    const c = {
      id: id(), key: `CRM-${n}`, waId, phone: '+' + String(waId).replace(/^\+/, ''), name: name || profileName || '', profileName,
      email: '', company: '', stage: 'new', priority: 'medium', assignee: 'Unassigned', tags: [], value: 0,
      createdAt: now(), updatedAt: now(), lastMessageAt: null, lastMessage: '', lastInboundAt: null, unread: 0, botPaused: false, ...rest,
    };
    try { await (await col('contacts')).insertOne(withId(c)); }
    catch (e) { if (e.code === 11000) return contacts.byWaId(waId); throw e; } // created concurrently by another request
    await logActivity('contact', `New contact ${c.name || c.phone} (${c.key})`, c.id);
    return c;
  },
  save: async (c) => { c.updatedAt = now(); await (await col('contacts')).replaceOne({ _id: c.id }, withId(c), { upsert: true }); return c; },
  set: async (cid, patch) => (await col('contacts')).updateOne({ _id: cid }, { $set: { ...patch, updatedAt: now() } }),
  async remove(cid) {
    await (await col('contacts')).deleteOne({ _id: cid });
    await (await col('messages')).deleteMany({ contactId: cid });
    await (await col('notes')).deleteMany({ contactId: cid });
    await (await col('tasks')).updateMany({ contactId: cid }, { $set: { contactId: null } });
  },
};

// ------------------------------------------------------------------ messages
const messages = {
  async insert(m) {
    const t = Date.now();
    const msg = { id: id(), status: m.direction === 'out' ? 'pending' : 'received', timestamp: now(), at: t, touchedAt: t, ...m };
    await (await col('messages')).insertOne(withId(msg));
    return msg;
  },
  byWamid: async (wamid) => (await col('messages')).findOne({ wamid }, NO_ID),
  forContact: async (contactId, limit = 500) => (await col('messages')).find({ contactId }, NO_ID).sort({ at: -1 }).limit(limit).toArray().then((r) => r.reverse()),
  last: async (contactId) => (await col('messages')).findOne({ contactId }, { projection: { _id: 0 }, sort: { at: -1 } }),
  set: async (mid, patch) => (await col('messages')).updateOne({ _id: mid }, { $set: { ...patch, touchedAt: Date.now() } }),
  count: async (filter) => (await col('messages')).countDocuments(filter),
  since: async (iso) => (await col('messages')).find({ timestamp: { $gte: iso } }, { projection: { _id: 0, timestamp: 1, direction: 1 } }).toArray(),
};

// ------------------------------------------------------------------ tasks, notes, rules, broadcasts, sims
const simpleCollection = (name) => ({
  list: async (filter = {}, sort = { createdAt: 1 }) => (await col(name)).find(filter, NO_ID).sort(sort).toArray(),
  get: async (did) => (await col(name)).findOne({ _id: did }, NO_ID),
  findOne: async (filter) => (await col(name)).findOne(filter, NO_ID),
  insert: async (doc) => { await (await col(name)).insertOne(withId(doc)); return doc; },
  set: async (did, patch) => (await col(name)).updateOne({ _id: did }, { $set: patch }),
  remove: async (did) => (await col(name)).deleteOne({ _id: did }),
  count: async (filter = {}) => (await col(name)).countDocuments(filter),
});
const tasks = simpleCollection('tasks');
const notes = simpleCollection('notes');
const broadcasts = simpleCollection('broadcasts');
const rulesCol = simpleCollection('rules');
const rules = {
  ...rulesCol,
  async list() {
    const r = await rulesCol.list({}, { name: 1 });
    if (r.length || (await getSettings()).rulesSeeded) return r;
    for (const d of DEFAULT_RULES) await rulesCol.insert({ ...d });
    await saveSettings({ rulesSeeded: true });
    return rulesCol.list({}, { name: 1 });
  },
};
const sims = {
  get: async (sid) => (await col('sims')).findOne({ _id: sid }),
  save: async (sid, sim) => (await col('sims')).replaceOne({ _id: sid }, { ...sim, _id: sid, updatedAt: new Date() }, { upsert: true }),
  remove: async (sid) => (await col('sims')).deleteOne({ _id: sid }),
};

// One cheap query set telling the UI whether anything changed since its last look
async function changeVersion() {
  const [m, c, a] = await Promise.all([
    (await col('messages')).findOne({}, { projection: { _id: 0, touchedAt: 1, at: 1 }, sort: { touchedAt: -1 } }),
    (await col('contacts')).findOne({}, { projection: { _id: 0, updatedAt: 1 }, sort: { updatedAt: -1 } }),
    (await col('activity')).findOne({}, { projection: { _id: 0, at: 1 }, sort: { at: -1 } }),
  ]);
  return [m ? m.touchedAt || m.at : 0, c ? c.updatedAt : '', a ? a.at : ''].join('|');
}

async function createTask({ title, description = '', status = 'todo', priority = 'medium', assignee = 'Unassigned', dueDate = '', contactId = null, type = null }) {
  const n = await nextSeq('task');
  const t = { id: id(), key: `TASK-${n}`, title, description, status, priority, assignee, dueDate, contactId, type, createdAt: now() };
  await tasks.insert(t);
  await logActivity('task', `Created ${t.key}: ${t.title}`, contactId);
  return t;
}

module.exports = { changeVersion, database, col, id, now, STAGES, DEFAULT_SETTINGS, getSettings, saveSettings, logActivity, listActivity, contacts, messages, tasks, notes, rules, broadcasts, sims, createTask, nextSeq, PREFIX };
