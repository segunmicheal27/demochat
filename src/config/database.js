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
  console.log(`Connecting to Couchbase: ${cbConnStr}`);
  cluster = await couchbase.connect(cbConnStr, {
    username: cbUser,
    password: cbPass,
    configProfile: "wanDevelopment",
  });
  bucket = cluster.bucket(cbBucket);
  collection = bucket.defaultCollection();
  console.log(`SUCCESS: Connected to Couchbase bucket: ${cbBucket}`);
  return { cluster, bucket, collection };
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
