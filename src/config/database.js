const { createClient } = require('redis');
const couchbase = require('couchbase');
require('dotenv').config();

const redisUrl = process.env.REDIS_URL || null;
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379;
const redisUsername = process.env.REDIS_USERNAME || undefined;
const redisPassword = process.env.REDIS_PASSWORD || undefined;

const cbConnStr = process.env.COUCHBASE_URL || "";
const cbUser = process.env.COUCHBASE_USER || "";
const cbPass = process.env.COUCHBASE_PASS || "";
const cbBucket = process.env.COUCHBASE_BUCKET || "";

let redis;
let cluster;
let bucket;
let collection;

async function connectRedis() {
  if (redisUrl) {
    redis = createClient({ url: redisUrl });
  } else {
    const clientOptions = {
      socket: {
        host: redisHost,
        port: redisPort
      }
    };
    if (redisUsername) clientOptions.username = redisUsername;
    if (redisPassword) clientOptions.password = redisPassword;
    redis = createClient(clientOptions);
  }

  redis.on('error', (err) => console.log('Redis Client Error', err));
  await redis.connect();
  console.log('Connected to Redis');
  return redis;
}

async function connectCouchbase() {
  try {
    console.log(`[Couchbase] Connecting to cluster: ${cbConnStr}`);
    cluster = await couchbase.connect(cbConnStr, {
      username: cbUser,
      password: cbPass,
      configProfile: "wanDevelopment",
    });

    const bucketManager = cluster.buckets();

    // Check available buckets and attempt creation if missing
    try {
      const allBuckets = await bucketManager.getAllBuckets();
      console.log(`[Couchbase] Available buckets:`, allBuckets.map(b => b.name));

      const exists = allBuckets.find(b => b.name === cbBucket);
      if (!exists) {
        console.log(`[Couchbase] Bucket "${cbBucket}" not found. Attempting to create...`);
        await bucketManager.createBucket({
          name: cbBucket,
          ramQuotaMB: 128, // Minimum quota
          bucketType: 'couchbase',
          flushEnabled: true,
          numReplicas: 0 // Capella free/lite usually allows 0 replicas
        });
        console.log(`[Couchbase] Bucket creation request sent. Waiting for initialization...`);
        // Wait a bit for the bucket to initialize
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } catch (e) {
      console.warn(`[Couchbase] Bucket Management Warning:`, e.message);
      console.warn(`(This usually means the user "${cbUser}" does not have "Bucket Admin" or "Cluster Admin" permissions in Capella)`);
    }

    console.log(`[Couchbase] Opening bucket: "${cbBucket}"`);
    bucket = cluster.bucket(cbBucket);

    collection = bucket.defaultCollection();
    console.log(`[Couchbase] SUCCESS: Connected to bucket: ${cbBucket}`);

    // Create Primary Index if not exists
    try {
      await cluster.query(`CREATE PRIMARY INDEX ON \`${cbBucket}\``);
      console.log("[Couchbase] Primary Index verified/created.");
    } catch (e) {
      if (e.message && e.message.includes("already exists")) {
        console.log("[Couchbase] Primary Index already exists.");
      } else {
        console.warn("[Couchbase] Index Warning:", e.message);
      }
    }

    return { cluster, bucket, collection };
  } catch (e) {
    console.error("[Couchbase] CONNECTION FATAL ERROR:", e);
    throw e;
  }
}

module.exports = {
  connectRedis,
  connectCouchbase,
  getRedis: () => redis,
  getCluster: () => cluster,
  getBucket: () => bucket,
  getCollection: () => collection,
  cbBucket
};
