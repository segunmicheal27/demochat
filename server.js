const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('redis');

const port = process.env.PORT || 8080;
const redisUrl = process.env.REDIS_URL || null;
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379;
const redisUsername = process.env.REDIS_USERNAME || undefined;
const redisPassword = process.env.REDIS_PASSWORD || undefined;

const app = express();

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

    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      io.to(receiver.socketId).emit('message', data);
      socket.emit('status', {
        messageId: data.id,
        conversationId: data.conversationId,
        status: 'delivered'
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

async function start() {
  try {
    await redis.connect();
    server.listen(port, '0.0.0.0', () => {
      console.log('------------------------------------------------');
      console.log(` SwissPay Chat Server is UP on port ${port}`);
      console.log(` Redis: ${redisUrl || `${redisHost}:${redisPort}`}`);
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
  } catch (e) {
    console.warn('Error quitting redis', e);
  }
  server.close(() => process.exit(0));
});

