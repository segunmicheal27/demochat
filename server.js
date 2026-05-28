const WebSocket = require('ws');

// Use the PORT provided by the environment (Render/Railway) or 8080 locally
const port = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: port }, () => {
    console.log(`SwissPay Chat Server started on port ${port}`);
});

const users = new Map(); // userId -> { socket, name, profileUrl }

wss.on('connection', (ws) => {
    console.log('New client connected');

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('Failed to parse message:', message);
            return;
        }

        console.log('Received:', data.type);

        if (data.type === 'identify') {
            users.set(data.userId, {
                socket: ws,
                name: data.name,
                profileUrl: data.profileUrl
            });
            ws.userId = data.userId;
            console.log(`User identified: ${data.name} (${data.userId})`);
            broadcastOnlineUsers();
        }

        if (data.type === 'message') {
            const receiver = users.get(data.receiverId);
            if (receiver && receiver.socket.readyState === WebSocket.OPEN) {
                receiver.socket.send(JSON.stringify({
                    type: 'message',
                    senderId: data.senderId,
                    receiverId: data.receiverId,
                    text: data.text,
                    timestamp: data.timestamp,
                    messageType: data.messageType || 'text'
                }));
                console.log(`Message relayed from ${data.senderId} to ${data.receiverId}`);
            } else {
                console.log(`User ${data.receiverId} is offline. Message saved to buffer (logic for push notifications could go here).`);
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

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

function broadcastOnlineUsers() {
    const onlineIds = Array.from(users.keys());
    const msg = JSON.stringify({
        type: 'online_users',
        users: onlineIds
    });

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}
