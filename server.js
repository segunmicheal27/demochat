const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const port = process.env.PORT || 8080;
const app = express();
const server = http.createServer(app);

// Socket.IO with CORS enabled and transports fallback for Railway
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

app.use(cors());

// Health check endpoints
app.get('/', (req, res) => {
    res.send('SwissPay Socket.IO Server is running');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const users = new Map();

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('identify', (data) => {
        if (!data || !data.userId) return;

        users.set(data.userId, {
            socketId: socket.id,
            user: data.user
        });
        socket.userId = data.userId;
        console.log(`User identified: ${socket.userId}`);
        broadcastOnlineUsers();
    });

    socket.on('message', (data) => {
        if (!data || !data.receiverId) return;

        const receiver = users.get(data.receiverId);
        if (receiver) {
            io.to(receiver.socketId).emit('message', {
                type: 'message',
                senderId: data.senderId,
                senderUser: data.senderUser,
                receiverId: data.receiverId,
                text: data.text,
                timestamp: data.timestamp,
                messageType: data.messageType || 'text',
                amount: data.amount,
                note: data.note
            });
        }
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            users.delete(socket.userId);
            console.log(`User disconnected: ${socket.userId}`);
            broadcastOnlineUsers();
        }
    });
});

function broadcastOnlineUsers() {
    const onlineIds = Array.from(users.keys());
    io.emit('online_users', { users: onlineIds });
}

server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});
