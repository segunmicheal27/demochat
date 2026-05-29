const { createClient } = require('redis');

(async () => {
  const client = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'redis-14728.c8.us-east-1-3.ec2.cloud.redislabs.com',
      port: Number(process.env.REDIS_PORT) || 14728
    },
    username: process.env.REDIS_USERNAME || 'default',
    password: process.env.REDIS_PASSWORD || 'BKMEHygiZSDifMgRT1gCLpNfXwiCa27z'
  });

  client.on('error', err => console.log('Redis Client Error', err));

  try {
    await client.connect();
    console.log('Connected to Redis');

    await client.set('swisschat_test_key', 'ok');
    const result = await client.get('swisschat_test_key');
    console.log('GET swisschat_test_key ->', result);

    await client.del('swisschat_test_key');
    await client.quit();
    console.log('Test finished successfully');
  } catch (err) {
    console.error('Test failed:', err);
    try { await client.quit(); } catch (e) {}
    process.exit(1);
  }
})();
