const { getRedis, cbBucket } = require('../config/database');
const ChatService = require('../services/ChatService');

class ChatController {
  constructor(io) {
    this.io = io;
  }

  async handleConnection(socket) {
    const transport = socket.conn.transport.name;
    console.log(`\x1b[32m[${new Date().toLocaleTimeString()}] [+] NEW CONNECTION: ${socket.id} (Via: ${transport})\x1b[0m`);

    socket.on('identify', (data) => this.identify(socket, data));
    socket.on('typing', (data) => this.typing(socket, data));
    socket.on('recording', (data) => this.recording(socket, data));
    socket.on('create_channel', (data) => this.createChannel(socket, data));
    socket.on('follow_channel', (data) => this.followChannel(socket, data));
    socket.on('channel_message', (data) => this.channelMessage(socket, data));
    socket.on('block_user', (data) => this.blockUser(socket, data));
    socket.on('read', (data) => this.read(socket, data));
    socket.on('message', (data) => this.message(socket, data));
    socket.on('edit_message', (data) => this.editMessage(socket, data));
    socket.on('delete_message', (data) => this.deleteMessage(socket, data));
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

    // Save FCM Token permanently
    if (data.fcmToken) {
      await ChatService.saveFcmToken(data.userId, data.fcmToken);
    }

    this.deliverPendingMessages(socket);
    this.broadcastOnlineUsers();
  }

  async typing(socket, data) {
    if (!data || !data.receiverId) return;
    const redis = getRedis();
    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      this.io.to(receiver.socketId).emit('typing', {
        senderId: socket.userId,
        isTyping: data.isTyping
      });
    }
  }

  async recording(socket, data) {
    if (!data || !data.receiverId) return;
    const redis = getRedis();
    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      this.io.to(receiver.socketId).emit('recording', {
        senderId: socket.userId,
        isRecording: data.isRecording
      });
    }
  }

  async followChannel(socket, data) {
    if (!data || !data.channelId) return;

    // Persist follow in Couchbase
    await ChatService.followChannel(data.channelId, socket.userId);

    // Notify owner if online
    if (data.ownerId) {
      const redis = getRedis();
      const ownerData = await redis.hGet('online_users', data.ownerId);
      if (ownerData) {
        const owner = JSON.parse(ownerData);
        this.io.to(owner.socketId).emit('channel_notification', {
          type: 'follower',
          channelId: data.channelId,
          follower: data.follower,
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  async createChannel(socket, data) {
    if (!data || !data.id) return;
    try {
      const channel = await ChatService.createChannel(data);
      socket.emit('channel_created', channel);
      console.log(`[Channel] Created: ${data.name} by ${socket.userId}`);
    } catch (e) {
      socket.emit('error', { message: "Failed to create channel" });
    }
  }

  async channelMessage(socket, data) {
    if (!data || !data.channelId) return;

    // 1. Save to Couchbase
    await ChatService.saveChannelMessage(data);

    // Ack to sender
    socket.emit('status', {
      messageId: data.id,
      channelId: data.channelId,
      status: 'sent'
    });

    // 2. Get all followers
    const followers = await ChatService.getChannelFollowers(data.channelId);
    console.log(`[Channel] Sending msg to ${followers.length} followers of ${data.channelId}`);

    // 3. Emit to all online followers
    const redis = getRedis();
    for (const followerId of followers) {
      if (followerId === socket.userId) continue; // Skip sender

      const followerData = await redis.hGet('online_users', followerId);
      if (followerData) {
        const follower = JSON.parse(followerData);
        this.io.to(follower.socketId).emit('message', {
          ...data,
          isChannelMessage: true
        });
      } else {
        // Optional: Send Push notification to offline followers
        const token = await ChatService.getFcmToken(followerId);
        if (token) {
          await ChatService.sendPushNotification(token, {
            ...data,
            senderUser: { firstName: "Channel", lastName: data.channelName || "SwissPay" }
          });
        }
      }
    }
  }

  async blockUser(socket, data) {
    if (!data || !data.receiverId) return;
    const redis = getRedis();
    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      this.io.to(receiver.socketId).emit('user_blocked', {
        blockerId: socket.userId,
        isBlocked: data.isBlocked
      });
    }
  }

  async read(socket, data) {
    if (!data || !data.senderId) return;
    const redis = getRedis();
    const senderData = await redis.hGet('online_users', data.senderId);
    if (senderData) {
      const sender = JSON.parse(senderData);
      this.io.to(sender.socketId).emit('read', {
        receiverId: socket.userId,
        conversationId: data.conversationId
      });
    }
  }

  async message(socket, data) {
    if (!data || !data.receiverId) return;
    console.log(`\x1b[90m[msg] ${data.senderId} -> ${data.receiverId}\x1b[0m`);

    const messageDoc = await ChatService.saveMessage(data);

    const redis = getRedis();
    const receiverData = await redis.hGet('online_users', data.receiverId);
    if (receiverData) {
      const receiver = JSON.parse(receiverData);
      this.io.to(receiver.socketId).emit('message', data);

      await ChatService.updateMessageStatus(data.id, 'delivered');

      socket.emit('status', {
        messageId: data.id,
        conversationId: data.conversationId,
        status: 'delivered'
      });
    } else {
      // User is offline - Send Push Notification
      const token = await ChatService.getFcmToken(data.receiverId);
      if (token) {
        await ChatService.sendPushNotification(token, data);
      }
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
      this.io.to(receiver.socketId).emit('delete_message', {
        ...data,
        senderId: socket.userId
      });
    }
  }

  async disconnect(socket, reason) {
    console.log(`\x1b[31m[-] DISCONNECTED: ${socket.id} (Reason: ${reason})\x1b[0m`);
    if (socket.userId) {
      const redis = getRedis();
      await redis.hDel('online_users', socket.userId);
      this.broadcastOnlineUsers();
    }
  }

  async broadcastOnlineUsers() {
    const redis = getRedis();
    const allUsers = await redis.hGetAll('online_users');
    const onlineData = Object.values(allUsers).map(userStr => {
      const userData = JSON.parse(userStr);
      return userData.user;
    });
    this.io.emit('online_users', { users: onlineData });
  }

  async deliverPendingMessages(socket) {
    const userId = socket.userId;
    if (!userId) return;

    const rows = await ChatService.getPendingMessages(userId);
    if (rows.length > 0) {
      console.log(`\x1b[33m[!] Delivering ${rows.length} pending messages to ${userId}\x1b[0m`);
      for (const row of rows) {
        const msg = row[cbBucket];
        const docId = row.id;
        socket.emit('message', msg);
        await ChatService.markAsDelivered(docId, msg);
      }
    }
  }
}

module.exports = ChatController;
