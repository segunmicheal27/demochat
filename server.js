const WebSocket = require('ws');
const http = require('http');

const port = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('SwissPay Chat Server is running');
});

const wss = new WebSocket.Server({ server, path: '/ws' });

const users = new Map();

wss.on('connection', (ws) => {
    console.log('New client connected');

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            return;
        }

        if (data.type === 'identify') {
            users.set(data.userId, {
                socket: ws,
                name: data.user.firstName + ' ' + data.user.lastName,
                profileUrl: data.user.profileUrl
            });
            ws.userId = data.userId;
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

server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});

