const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const port = process.env.PORT || 8080;
const app = express();

app.use(cors());

// Root path for health check
app.get('/', (req, res) => {
    res.status(200).send('SwissPay Chat Server is UP and Running');
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        activeUsers: users.size,
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
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    connectTimeout: 45000,
    pingTimeout: 30000, // Reduced for faster disconnect detection
    pingInterval: 10000 // Send pings more frequently
});

const users = new Map();

io.on('connection', (socket) => {
    const transport = socket.conn.transport.name;
    console.log(`\x1b[32m[${new Date().toLocaleTimeString()}] [+] NEW CONNECTION: ${socket.id} (Via: ${transport})\x1b[0m`);

    socket.on('identify', (data) => {
        if (!data || !data.userId) return;

        const user = data.user || {};
        users.set(data.userId, {
            socketId: socket.id,
            user: user
        });
        socket.userId = data.userId;

        console.log(`\x1b[36m[i] USER IDENTIFIED: ${user.firstName || 'Unknown'} (ID: ${data.userId})\x1b[0m`);

        const onlineIds = Array.from(users.keys());
        io.emit('online_users', { users: onlineIds });
    });

    socket.on('typing', (data) => {
        if (!data || !data.receiverId) return;
        const receiver = users.get(data.receiverId);
        if (receiver) {
            io.to(receiver.socketId).emit('typing', {
                senderId: socket.userId,
                isTyping: data.isTyping
            });
        }
    });

    socket.on('message', (data) => {
        if (!data || !data.receiverId) return;

        console.log(`\x1b[90m[msg] ${data.senderId} -> ${data.receiverId}\x1b[0m`);

        const receiver = users.get(data.receiverId);
        if (receiver) {
            io.to(receiver.socketId).emit('message', data);
        }
    });

    socket.on('disconnect', (reason) => {
        console.log(`\x1b[31m[-] DISCONNECTED: ${socket.id} (Reason: ${reason})\x1b[0m`);
        if (socket.userId) {
            users.delete(socket.userId);
            const onlineIds = Array.from(users.keys());
            io.emit('online_users', { users: onlineIds });
        }
    });

    socket.conn.on('upgrade', () => {
        console.log(`\x1b[35m[^] UPGRADED: ${socket.id} to ${socket.conn.transport.name}\x1b[0m`);
    });
});

server.listen(port, '0.0.0.0', () => {
    console.log('------------------------------------------------');
    console.log(`  SwissPay Chat Server is UP on port ${port}`);
    console.log('------------------------------------------------');
});
