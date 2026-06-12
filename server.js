const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const { connectRedis, connectCouchbase, getRedis, getCluster } = require('./src/config/database');
const { initializeFirebase } = require('./src/config/firebase');

const ChatController = require('./src/controllers/ChatController');
const ChannelController = require('./src/controllers/ChannelController');
const CommerceController = require('./src/controllers/CommerceController');

const port = process.env.PORT || 8080;
const app = express();
app.use(cors());

// Health checks
app.get('/', (req, res) => res.status(200).send('SwissPay Chat Server is UP and Running'));
app.get('/health', async (req, res) => {
  const redis = getRedis();
  const activeUsers = redis ? await redis.hLen('online_users') : 0;
  res.status(200).json({ status: 'healthy', activeUsers, time: new Date().toISOString() });
});

const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io/',
  cors: { origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["*"], credentials: true },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  connectTimeout: 45000,
  pingTimeout: 30000,
  pingInterval: 10000
});

const chatController = new ChatController(io);
const channelController = new ChannelController(io);
const commerceController = new CommerceController(io);

io.on('connection', (socket) => {
  chatController.handleEvents(socket);
  channelController.handleEvents(socket);
  commerceController.handleEvents(socket);
});

async function start() {
  try {
    await connectRedis();
    await connectCouchbase();
    initializeFirebase();

    server.listen(port, '0.0.0.0', () => {
      console.log('------------------------------------------------');
      console.log(` SwissPay Chat Server is UP on port ${port}`);
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
  const redis = getRedis();
  const cluster = getCluster();
  if (redis) await redis.quit();
  if (cluster) await cluster.close();
  server.close(() => process.exit(0));
});
