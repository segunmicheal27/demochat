const BaseController = require('./BaseController');
const { getRedis } = require('../config/database');
const ChatService = require('../services/ChatService');

class ChatController extends BaseController {
  constructor(io) {
    super(io);
  }

  handleEvents(socket) {
    socket.on('identify', (data) => this.identify(socket, data));
    socket.on('typing', (data) => this.typing(socket, data));
    socket.on('recording', (data) => this.recording(socket, data));
    socket.on('block_user', (data) => this.blockUser(socket, data));
    socket.on('read', (data) => this.read(socket, data));
    socket.on('message', (data) => this.message(socket, data));
    socket.on('edit_message', (data) => this.editMessage(socket, data));
    socket.on('delete_message', (data) => this.deleteMessage(socket, data));
    socket.on('message_reaction', (data) => this.messageReaction(socket, data));
    socket.on('disconnect', (reason) => this.disconnect(socket, reason));
  }

  async identify(socket, data) {
    if (!data || !data.userId) return;
    const redis = getRedis();
    const user = data.user || {};
    socket.userId = data.userId;

    await redis.hSet('online_users', data.userId, JSON.stringify({
      socketId: socket.id,
      userId: data.userId,
      user: user,
      fcmToken: data.fcmToken
    }));
    await redis.expire('online_users', 86400);

    console.log(`\x1b[36m[i] USER IDENTIFIED: ${user.firstName || 'Unknown'} ${user.lastName || ''} (ID: ${data.userId})\x1b[0m`);

    if (data.fcmToken) await ChatService.saveFcmToken(data.userId, data.fcmToken);

    this.deliverPendingMessages(socket);
    this.broadcastOnlineUsers();
  }

  async typing(socket, data) {
    if (!data || !data.receiverId) return;
    const redis = getRedis();
    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      this.io.to(receiver.socketId).emit('typing', { senderId: socket.userId, isTyping: data.isTyping });
    }
  }

  async recording(socket, data) {
    if (!data || !data.receiverId) return;
    const redis = getRedis();
    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      this.io.to(receiver.socketId).emit('recording', { senderId: socket.userId, isRecording: data.isRecording });
    }
  }

  async blockUser(socket, data) {
    if (!data || !data.receiverId) return;
    const redis = getRedis();
    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      this.io.to(receiver.socketId).emit('user_blocked', { blockerId: socket.userId, isBlocked: data.isBlocked });
    }
  }

  async read(socket, data) {
    if (!data || !data.senderId) return;
    const redis = getRedis();
    const senderData = await redis.hGet('online_users', data.senderId);
    if (senderData) {
      const sender = JSON.parse(senderData);
      this.io.to(sender.socketId).emit('read', { receiverId: socket.userId, conversationId: data.conversationId });
    }
  }

  async message(socket, data) {
    if (!data || !data.receiverId) return;
    const messageDoc = await ChatService.saveMessage(data);
    const redis = getRedis();
    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      this.io.to(receiver.socketId).emit('message', data);
      await ChatService.updateMessageStatus(data.id, 'delivered');
      socket.emit('status', { messageId: data.id, conversationId: data.conversationId, status: 'delivered' });
    } else {
      const token = await ChatService.getFcmToken(data.receiverId);
      if (token) await ChatService.sendPushNotification(token, data);
    }
  }

  async editMessage(socket, data) {
    if (!data || !data.receiverId || !data.messageId) return;
    await ChatService.editMessage(data.messageId, data.text);
    const redis = getRedis();
    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      this.io.to(receiver.socketId).emit('edit_message', data);
    }
  }

  async deleteMessage(socket, data) {
    if (!data || !data.receiverId || !data.messageId) return;
    await ChatService.deleteMessage(data.messageId, data.forEveryone);
    const redis = getRedis();
    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      this.io.to(receiver.socketId).emit('delete_message', { ...data, senderId: socket.userId });
    }
  }

  async messageReaction(socket, data) {
    if (!data || !data.messageId || !data.reaction) return;
    const reactions = await ChatService.saveReaction(data.messageId, socket.userId, data.reaction);
    if (!reactions) return;
    const payload = { messageId: data.messageId, userId: socket.userId, reaction: data.reaction, reactions: reactions, conversationId: data.conversationId };

    if (data.receiverId) {
      const redis = getRedis();
      const rData = await redis.hGet('online_users', data.receiverId);
      if (rData) this.io.to(JSON.parse(rData).socketId).emit('message_reaction', payload);
      socket.emit('message_reaction', payload);
    }
  }

  async disconnect(socket, reason) {
    if (socket.userId) {
      const redis = getRedis();
      await redis.hDel('online_users', socket.userId);
      this.broadcastOnlineUsers();
    }
  }

  async broadcastOnlineUsers() {
    const redis = getRedis();
    const allUsers = await redis.hGetAll('online_users');
    const onlineData = Object.values(allUsers).map(u => JSON.parse(u).user);
    this.io.emit('online_users', { users: onlineData });
  }

  async deliverPendingMessages(socket) {
    const rows = await ChatService.getPendingMessages(socket.userId);
    for (const row of rows) {
      const msg = row.id.startsWith('chat_message') ? row : row[Object.keys(row).find(k => k !== 'id')];
      socket.emit('message', msg);
      await ChatService.markAsDelivered(row.id, msg);
    }
  }
}

module.exports = ChatController;
