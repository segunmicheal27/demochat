const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const port = process.env.PORT || 8080;
const app = express();
const server = http.createServer(app);

// Socket.IO with CORS enabled and prioritized polling for Railway stability
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true // Support older clients if necessary
});

app.use(cors());

// Health check endpoints
app.get('/', (req, res) => {
    res.send('SwissPay Socket.IO Server is running');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', connections: io.engine.clientsCount });
});

const users = new Map();

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id, 'Transport:', socket.conn.transport.name);

    socket.conn.on('upgrade', () => {
        console.log('Client upgraded transport:', socket.id, 'to', socket.conn.transport.name);
    });

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

server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});
