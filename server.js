const WebSocket = require('ws');
const http = require('http');

const port = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    // For Railway: Handle health checks but IGNORE upgrade requests here
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        return;
    }

    if (req.url === '/' || req.url === '/health') {
        res.writeHead(200);
        res.end('SwissPay Chat Server is active.');
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    // Railway's edge can sometimes be tricky with pathnames
    // We'll handle the upgrade for all paths to be safe
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

const users = new Map();

wss.on('connection', (ws) => {
    console.log('New client connected');

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('Failed to parse:', message.toString());
            return;
        }

        if (data.type === 'identify') {
            users.set(data.userId, {
                socket: ws,
                user: data.user
            });
            ws.userId = data.userId;
            console.log(`User identified: ${ws.userId}`);
            broadcastOnlineUsers();
        }

        if (data.type === 'message') {
            const receiver = users.get(data.receiverId);
            if (receiver && receiver.socket.readyState === WebSocket.OPEN) {
                receiver.socket.send(JSON.stringify({
                    type: 'message',
                    senderId: data.senderId,
                    senderUser: data.senderUser,
                    receiverId: data.receiverId,
                    text: data.text,
                    timestamp: data.timestamp,
                    messageType: data.messageType || 'text',
                    amount: data.amount,
                    note: data.note
                }));
            }
        }
    });

    ws.on('close', () => {
        if (ws.userId) {
            users.delete(ws.userId);
            console.log(`User disconnected: ${ws.userId}`);
            broadcastOnlineUsers();
        }
    });
});

function broadcastOnlineUsers() {
    const onlineIds = Array.from(users.keys());
    const msg = JSON.stringify({ type: 'online_users', users: onlineIds });
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

// Bind to 0.0.0.0 as required by Railway
server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});
