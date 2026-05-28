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
    res.status(200).json({ status: 'healthy', time: new Date().toISOString() });
});

const server = http.createServer(app);

const io = new Server(server, {
    path: '/socket.io/',
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000
});

const users = new Map();

io.on('connection', (socket) => {
    const transport = socket.conn.transport.name;
    console.log(`[${new Date().toISOString()}] New Connection: ${socket.id} (Transport: ${transport})`);

    socket.on('identify', (data) => {
        if (!data || !data.userId) {
            console.log('Identify failed: No userId provided');
            return;
        }

        users.set(data.userId, {
            socketId: socket.id,
            user: data.user
        });
        socket.userId = data.userId;
        console.log(`User Identified: ${socket.userId} (${data.user?.firstName || 'Unknown'})`);

        // Broadcast to all that someone joined
        const onlineIds = Array.from(users.keys());
        io.emit('online_users', { users: onlineIds });
    });

    socket.on('message', (data) => {
        if (!data || !data.receiverId) return;

        const receiver = users.get(data.receiverId);
        if (receiver) {
            io.to(receiver.socketId).emit('message', data);
        }
    });

    socket.on('disconnect', (reason) => {
        console.log(`[${new Date().toISOString()}] Disconnected: ${socket.id} (Reason: ${reason})`);
        if (socket.userId) {
            users.delete(socket.userId);
            const onlineIds = Array.from(users.keys());
            io.emit('online_users', { users: onlineIds });
        }
    });

    // Log upgrade
    socket.conn.on('upgrade', () => {
        console.log(`[${new Date().toISOString()}] Transport Upgraded: ${socket.id} to ${socket.conn.transport.name}`);
    });
});

server.listen(port, () => {
    console.log(`>>>> SwissPay Chat Server listening on port ${port} <<<<`);
});
