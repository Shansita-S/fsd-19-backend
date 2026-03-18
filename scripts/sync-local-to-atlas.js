require('dotenv').config();
const mongoose = require('mongoose');

const LOCAL_URI = 'mongodb://127.0.0.1:27017/meeting-scheduler';

async function syncLocalToAtlas() {
  const atlasUri = process.env.MONGODB_URI;

  if (!atlasUri || !atlasUri.startsWith('mongodb')) {
    throw new Error('MONGODB_URI is missing or invalid in Backend/.env');
  }

  const localConn = await mongoose.createConnection(LOCAL_URI).asPromise();
  const atlasConn = await mongoose.createConnection(atlasUri).asPromise();

  try {
    const localCollections = (await localConn.db.listCollections().toArray())
      .map((c) => c.name)
      .filter((name) => !name.startsWith('system.'));

    if (localCollections.length === 0) {
      console.log('No local collections found to sync.');
      return;
    }

    console.log('Starting sync from local -> Atlas');

    for (const name of localCollections.sort()) {
      const localCollection = localConn.db.collection(name);
      const atlasCollection = atlasConn.db.collection(name);

      const docs = await localCollection.find({}).toArray();

      await atlasCollection.deleteMany({});
      if (docs.length > 0) {
        await atlasCollection.insertMany(docs, { ordered: false });
      }

      const atlasCount = await atlasCollection.countDocuments();
      console.log(`${name}: copied ${docs.length}, atlas now ${atlasCount}`);
    }

    console.log('Sync completed successfully.');
  } finally {
    await localConn.close();
    await atlasConn.close();
  }
}

syncLocalToAtlas().catch((err) => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
