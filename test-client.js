const io = require('socket.io-client');

const opts = { path: '/socket.io/' };

const clientA = io('http://localhost:8080', opts);
const clientB = io('http://localhost:8080', opts);

clientA.on('connect', () => {
  console.log('Client A connected:', clientA.id);
  clientA.emit('identify', { userId: 'userA', user: { firstName: 'Alice' } });
});

clientB.on('connect', () => {
  console.log('Client B connected:', clientB.id);
  clientB.emit('identify', { userId: 'userB', user: { firstName: 'Bob' } });
});

clientA.on('online_users', (data) => {
  console.log('A online_users', data);
});
clientB.on('online_users', (data) => {
  console.log('B online_users', data);
});

clientB.on('message', (data) => {
  console.log('B received message:', data);
  cleanup();
});

clientA.on('status', (s) => {
  console.log('A status:', s);
});

function sendMessage() {
  clientA.emit('message', {
    senderId: 'userA',
    receiverId: 'userB',
    id: 'msg1',
    conversationId: 'conv1',
    text: 'Hello from A'
  });
}

function cleanup() {
  clientA.close();
  clientB.close();
  process.exit(0);
}

// Wait briefly for both to identify
setTimeout(() => {
  sendMessage();
}, 2000);
