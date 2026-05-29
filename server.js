const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const redis = require('redis');

const port = process.env.PORT || 8080;
const app = express();
const server = http.createServer(app);

// Socket.IO with CORS enabled for Flutter clients
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

app.use(cors());

// Redis client setup
const redisClient = redis.createClient({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    username: process.env.REDIS_USERNAME || 'default',
    password: process.env.REDIS_PASSWORD,
    retryStrategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
            return new Error('Redis connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('Redis retry time exhausted');
        }
        if (options.attempt > 10) {
            return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
    }
});

redisClient.on('error', (err) => {
    console.error('Redis error:', err);
});

redisClient.on('connect', () => {
    console.log('Connected to Redis');
});

// Health check endpoint
app.get('/', (req, res) => {
    res.send('SwissPay Chat Server is running');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const USERS_KEY = 'chat:users';
const MESSAGES_KEY = 'chat:messages';
const ONLINE_USERS_KEY = 'chat:online_users';

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('identify', async (data) => {
        try {
            // Store user in Redis
            const userKey = `${USERS_KEY}:${data.userId}`;
            await redisClient.setex(
                userKey,
                86400, // 24 hour expiry
                JSON.stringify({
                    socketId: socket.id,
                    user: data.user,
                    connectedAt: new Date().toISOString()
                })
            );

            // Add to online users set
            await redisClient.sadd(ONLINE_USERS_KEY, data.userId);

            socket.userId = data.userId;
            console.log(`User identified: ${data.userId}`);
            broadcastOnlineUsers();
        } catch (err) {
            console.error('Error identifying user:', err);
        }
    });

    socket.on('message', async (data) => {
        try {
            // Store message in Redis
            const messageKey = `${MESSAGES_KEY}:${data.receiverId}`;
            const message = {
                senderId: data.senderId,
                senderUser: data.senderUser,
                receiverId: data.receiverId,
                text: data.text,
                timestamp: data.timestamp,
                messageType: data.messageType || 'text',
                amount: data.amount,
                note: data.note
            };

            await redisClient.lpush(messageKey, JSON.stringify(message));
            await redisClient.ltrim(messageKey, 0, 999); // Keep last 1000 messages

            // Try to send to receiver if online
            const receiverKey = `${USERS_KEY}:${data.receiverId}`;
            const receiverData = await redisClient.get(receiverKey);

            if (receiverData) {
                const receiver = JSON.parse(receiverData);
                const receiverSocket = io.sockets.sockets.get(receiver.socketId);
                if (receiverSocket) {
                    receiverSocket.emit('message', message);
                }
            }
        } catch (err) {
            console.error('Error sending message:', err);
        }
    });

    socket.on('disconnect', async () => {
        if (socket.userId) {
            try {
                // Remove from online users
                await redisClient.srem(ONLINE_USERS_KEY, socket.userId);
                console.log(`User disconnected: ${socket.userId}`);
                broadcastOnlineUsers();
            } catch (err) {
                console.error('Error on disconnect:', err);
            }
        }
    });
});

async function broadcastOnlineUsers() {
    try {
        const onlineIds = await redisClient.smembers(ONLINE_USERS_KEY);
        io.emit('online_users', { users: onlineIds });
    } catch (err) {
        console.error('Error broadcasting online users:', err);
    }
}

server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});

