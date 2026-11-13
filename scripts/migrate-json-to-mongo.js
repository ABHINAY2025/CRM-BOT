// One-time copy of the old local data/db.json into MongoDB (crm_* collections). Safe to re-run: upserts by id.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const store = require('../lib/store');

(async () => {
  const file = path.join(__dirname, '..', 'data', 'db.json');
  if (!fs.existsSync(file)) return console.log('No data/db.json — nothing to migrate.');
  const old = JSON.parse(fs.readFileSync(file, 'utf8'));
  const OLD_STAGE = { contacted: 'started', proposal: 'handed' };
  const ids = new Set(store.STAGES.map((s) => s.id));
  const db = await store.database();
  const up = async (name, docs, map = (d) => d) => {
    if (!docs || !docs.length) return 0;
    const ops = docs.map((d, i) => { const x = map(d, i); return { replaceOne: { filter: { _id: x.id }, replacement: { ...x, _id: x.id }, upsert: true } }; });
    await db.collection(store.PREFIX + name).bulkWrite(ops);
    return docs.length;
  };
  const counts = {
    contacts: await up('contacts', old.contacts, (c) => ({ ...c, stage: ids.has(c.stage) ? c.stage : OLD_STAGE[c.stage] || 'new' })),
    messages: await up('messages', old.messages, (m, i) => ({ ...m, at: new Date(m.timestamp).getTime() || i })),
    tasks: await up('tasks', old.tasks),
    notes: await up('notes', old.notes),
    rules: await up('rules', old.rules),
    broadcasts: await up('broadcasts', old.broadcasts),
    activity: await up('activity', (old.activity || []).map((a) => ({ ...a, id: a.id || store.id() }))),
  };
  if (old.settings) await store.saveSettings({ ...old.settings, rulesSeeded: true });
  for (const [k, v] of Object.entries(old.counters || {})) {
    await db.collection(store.PREFIX + 'counters').updateOne({ _id: k }, { $max: { seq: v } }, { upsert: true });
  }
  console.log('Migrated into MongoDB:', counts);
  process.exit(0);
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
