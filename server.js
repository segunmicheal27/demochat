const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const port = process.env.PORT || 8080;
const app = express();
app.use(cors());

// Health check endpoints
app.get('/', (req, res) => {
    res.send('SwissPay Socket.IO Server is running v2');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', connections: io.engine.clientsCount });
});

const httpServer = createServer(app);

// Initialize Socket.IO with modern constructor
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['polling', 'websocket'], // Prioritize polling for handshake stability
    allowEIO3: true
});

const users = new Map();

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id, 'Transport:', socket.conn.transport.name);

    socket.on('identify', (data) => {
        if (!data || !data.userId) return;

        users.set(data.userId, {
            socketId: socket.id,
            user: data.user
        });
        socket.userId = data.userId;
        console.log(`User identified: ${socket.userId} (${data.user.firstName})`);
        broadcastOnlineUsers();
    });

    socket.on('message', (data) => {
        if (!data || !data.receiverId) return;

        const receiver = users.get(data.receiverId);
        if (receiver) {
            io.to(receiver.socketId).emit('message', data);
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('Client disconnected:', socket.id, 'Reason:', reason);
        if (socket.userId) {
            users.delete(socket.userId);
            broadcastOnlineUsers();
        }
    });
});

function broadcastOnlineUsers() {
    const onlineIds = Array.from(users.keys());
    io.emit('online_users', { users: onlineIds });
}

httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});
