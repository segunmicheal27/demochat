const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('redis');
const couchbase = require('couchbase');
require('dotenv').config();

const port = process.env.PORT || 8080;
const redisUrl = process.env.REDIS_URL || null;
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379;
const redisUsername = process.env.REDIS_USERNAME || undefined;
const redisPassword = process.env.REDIS_PASSWORD || undefined;

const cbConnStr = process.env.COUCHBASE_URL || "couchbases://cb.yz6j1i2wajboagpx.cloud.couchbase.com";
const cbUser = process.env.COUCHBASE_USER || "swiss-lite-chat";
const cbPass = process.env.COUCHBASE_PASS || "HN@1~u2MzP9O";
const cbBucket = process.env.COUCHBASE_BUCKET || "swisschat";

const app = express();

// Global handles
let redis;
let cluster;
let bucket;
let collection;

// Redis client setup: prefer REDIS_URL; fallback to host/port + optional username/password
let redis;
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

app.use(cors());

// Root path for health check
app.get('/', (req, res) => {
  res.status(200).send('SwissPay Chat Server is UP and Running');
});

app.get('/health', async (req, res) => {
  const activeUsers = await redis.hLen('online_users');
  res.status(200).json({
    status: 'healthy',
    activeUsers: activeUsers,
    time: new Date().toISOString()
  });
});

const server = http.createServer(app);

const io = new Server(server, {
  path: '/socket.io/',
  cors: {
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["*"],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  connectTimeout: 45000,
  pingTimeout: 30000,
  pingInterval: 10000
});

// Redis will store users with key: 'online_users:{userId}' and hash field: userId
io.on('connection', (socket) => {
  const transport = socket.conn.transport.name;
  console.log(`\x1b[32m[${new Date().toLocaleTimeString()}] [+] NEW CONNECTION: ${socket.id} (Via: ${transport})\x1b[0m`);

  socket.on('identify', async (data) => {
    if (!data || !data.userId) return;
    const user = data.user || {};
    socket.userId = data.userId;

    // Store user in Redis with 24-hour expiration
    await redis.hSet('online_users', data.userId, JSON.stringify({
      socketId: socket.id,
      userId: data.userId,
      user: user
    }));
    await redis.expire('online_users', 86400); // 24 hours

    console.log(`\x1b[36m[i] USER IDENTIFIED: ${user.firstName || 'Unknown'} ${user.lastName || ''} (ID: ${data.userId})\x1b[0m`);

    // Deliver pending messages from Couchbase
    deliverPendingMessages(socket);

    broadcastOnlineUsers();
  });

  socket.on('typing', async (data) => {
    if (!data || !data.receiverId) return;
    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      io.to(receiver.socketId).emit('typing', {
        senderId: socket.userId,
        isTyping: data.isTyping
      });
    }
  });

  socket.on('recording', async (data) => {
    if (!data || !data.receiverId) return;
    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      io.to(receiver.socketId).emit('recording', {
        senderId: socket.userId,
        isRecording: data.isRecording
      });
    }
  });

  socket.on('follow_channel', async (data) => {
    if (!data || !data.ownerId || !data.channelId) return;
    const ownerData = await redis.hGet('online_users', data.ownerId);
    if (ownerData) {
      const owner = JSON.parse(ownerData);
      io.to(owner.socketId).emit('channel_notification', {
        type: 'follower',
        channelId: data.channelId,
        follower: data.follower, // Full user object of the follower
        timestamp: new Date().toISOString()
      });
    }
  });

  socket.on('block_user', async (data) => {
    if (!data || !data.receiverId) return;
    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      io.to(receiver.socketId).emit('user_blocked', {
        blockerId: socket.userId,
        isBlocked: data.isBlocked
      });
    }
  });

  socket.on('read', async (data) => {
    if (!data || !data.senderId) return;
    const senderData = await redis.hGet('online_users', data.senderId);
    if (senderData) {
      const sender = JSON.parse(senderData);
      io.to(sender.socketId).emit('read', {
        receiverId: socket.userId,
        conversationId: data.conversationId
      });
    }
  });

  socket.on('message', async (data) => {
    if (!data || !data.receiverId) return;
    console.log(`\x1b[90m[msg] ${data.senderId} -> ${data.receiverId}\x1b[0m`);

    // 1. Save to Couchbase immediately
    const messageDoc = {
      ...data,
      status: 'sent',
      type: 'chat_message',
      createdAt: new Date().toISOString()
    };

    try {
      await collection.upsert(data.id, messageDoc);
    } catch (e) {
      console.error("Couchbase Save Error:", e);
    }

    // 2. Check if recipient is online
    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      io.to(receiver.socketId).emit('message', data);

      // Update status to delivered in Couchbase
      try {
        messageDoc.status = 'delivered';
        await collection.upsert(data.id, messageDoc);
      } catch (e) {}

      socket.emit('status', {
        messageId: data.id,
        conversationId: data.conversationId,
        status: 'delivered'
      });
    }
  });

  socket.on('edit_message', async (data) => {
    if (!data || !data.receiverId || !data.messageId) return;

    // Update Couchbase
    try {
      const result = await collection.get(data.messageId);
      const doc = result.content;
      doc.text = data.text;
      doc.updatedAt = new Date().toISOString();
      await collection.replace(data.messageId, doc);
    } catch (e) {}

    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      io.to(receiver.socketId).emit('edit_message', data);
    }
  });

  socket.on('delete_message', async (data) => {
    if (!data || !data.receiverId || !data.messageId) return;

    // Update Couchbase
    try {
      if (data.forEveryone) {
        const result = await collection.get(data.messageId);
        const doc = result.content;
        doc.isDeleted = true;
        doc.text = "This message was deleted";
        await collection.replace(data.messageId, doc);
      } else {
        // Local delete usually doesn't need server-side DB change unless it's per-user
      }
    } catch (e) {}

    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      io.to(receiver.socketId).emit('delete_message', {
        ...data,
        senderId: socket.userId
      });
    }
  });

  socket.on('disconnect', async (reason) => {
    console.log(`\x1b[31m[-] DISCONNECTED: ${socket.id} (Reason: ${reason})\x1b[0m`);
    if (socket.userId) {
      await redis.hDel('online_users', socket.userId);
      broadcastOnlineUsers();
    }
  });

  socket.conn.on('upgrade', () => {
    console.log(`\x1b[35m[^] UPGRADED: ${socket.id} to ${socket.conn.transport.name}\x1b[0m`);
  });
});

async function broadcastOnlineUsers() {
  // Send the full user objects stored in Redis
  const allUsers = await redis.hGetAll('online_users');
  const onlineData = Object.values(allUsers).map(userStr => {
    const userData = JSON.parse(userStr);
    return userData.user;
  });
  io.emit('online_users', { users: onlineData });
}

async function deliverPendingMessages(socket) {
  const userId = socket.userId;
  if (!userId) return;

  try {
    // Query for messages sent to this user that are not yet delivered
    const query = `
      SELECT meta().id, *
      FROM \`${cbBucket}\`
      WHERE receiverId \u003d $1
      AND status \u003d 'sent'
      AND type \u003d 'chat_message'
    `;

    const results \u003d await cluster.query(query, { parameters: [userId] });

    if (results.rows.length \u003e 0) {
      console.log(`\x1b[33m[!] Delivering ${results.rows.length} pending messages to ${userId}\x1b[0m`);

      for (const row of results.rows) {
        const msg \u003d row[cbBucket];
        const docId \u003d row.id;

        // 1. Send to user
        socket.emit('message', msg);

        // 2. Mark as delivered in Couchbase
        msg.status \u003d 'delivered';
        await collection.upsert(docId, msg);
      }
    }
  } catch (e) {
    console.error("Couchbase Query Error:", e);
  }
}

async function start() {
  try {
    // Connect Redis
    await redis.connect();

    // Connect Couchbase
    console.log(`Connecting to Couchbase: ${cbConnStr}`);
    cluster = await couchbase.connect(cbConnStr, {
      username: cbUser,
      password: cbPass,
      configProfile: "wanDevelopment",
    });
    bucket = cluster.bucket(cbBucket);
    collection = bucket.defaultCollection();
    console.log(`SUCCESS: Connected to Couchbase bucket: ${cbBucket}`);

    server.listen(port, '0.0.0.0', () => {
      console.log('------------------------------------------------');
      console.log(` SwissPay Chat Server is UP on port ${port}`);
      console.log(` Redis: ${redisUrl || `${redisHost}:${redisPort}`}`);
      console.log(` Couchbase: ${cbConnStr}`);
      console.log('------------------------------------------------');
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing connections...');
  try {
    await redis.quit();
    if (cluster) await cluster.close();
  } catch (e) {
    console.warn('Error quitting connections', e);
  }
  server.close(() => process.exit(0));
});

