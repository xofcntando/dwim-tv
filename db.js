/* MongoDB storage layer for DWIM TV.
   - Set MONGODB_URI (e.g. a free MongoDB Atlas cluster) to store the catalog + live state in MongoDB.
   - Without MONGODB_URI the app falls back to data/videos.json exactly as before.
   Layout: database "dwimtv" (override with MONGODB_DB)
     collection "catalog" -> one document { _id: 'main', channels, videos, church, updatedAt }
     collection "state"   -> { _id: 'live', ...live stream } */
const { MongoClient } = require('mongodb');

let client = null;
let db = null;

async function connect(uri, dbName) {
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  db = client.db(dbName || process.env.MONGODB_DB || 'dwimtv');
  await db.command({ ping: 1 });
  return db;
}

const isConnected = () => !!db;

async function loadCatalog() {
  const doc = await db.collection('catalog').findOne({ _id: 'main' });
  if (!doc) return null;
  const { _id, updatedAt, ...cat } = doc;
  return cat;
}

async function saveCatalog(cat) {
  await db.collection('catalog').replaceOne(
    { _id: 'main' },
    { ...cat, updatedAt: new Date() },
    { upsert: true }
  );
}

async function loadLive() {
  const doc = await db.collection('state').findOne({ _id: 'live' });
  if (!doc) return null;
  const { _id, ...live } = doc;
  return live;
}

async function saveLive(live) {
  if (!live) return db.collection('state').deleteOne({ _id: 'live' });
  return db.collection('state').replaceOne({ _id: 'live' }, { ...live }, { upsert: true });
}

/* ---- Prayer requests: collection "prayers" ---- */
async function addPrayer(doc) { await db.collection('prayers').insertOne(doc); return doc; }
async function listPrayers(limit = 500) {
  return db.collection('prayers').find({}).sort({ createdAt: -1 }).limit(limit).toArray();
}
async function setPrayerPrayed(id, prayed) {
  const r = await db.collection('prayers').findOneAndUpdate(
    { _id: id }, { $set: { prayed: !!prayed, prayedAt: prayed ? new Date() : null } }, { returnDocument: 'after' });
  return r;
}
async function deletePrayer(id) {
  const r = await db.collection('prayers').deleteOne({ _id: id });
  return r.deletedCount > 0;
}

async function close() { if (client) await client.close(); }

module.exports = { connect, isConnected, loadCatalog, saveCatalog, loadLive, saveLive, addPrayer, listPrayers, setPrayerPrayed, deletePrayer, close };
