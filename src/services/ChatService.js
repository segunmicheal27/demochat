const { getCollection, getCluster, cbBucket } = require('../config/database');
const { admin } = require('../config/firebase');

class ChatService {
  async saveMessage(data) {
    const collection = getCollection();
    const messageDoc = {
      ...data,
      status: 'sent',
      type: 'chat_message',
      createdAt: new Date().toISOString()
    };
    try {
      await collection.upsert(data.id, messageDoc);
      return messageDoc;
    } catch (e) {
      console.error("Couchbase Save Error:", e);
      throw e;
    }
  }

  async updateMessageStatus(messageId, status) {
    const collection = getCollection();
    try {
      const result = await collection.get(messageId);
      const doc = result.content;
      doc.status = status;
      await collection.replace(messageId, doc);
    } catch (e) {
      console.error("Update Status Error:", e);
    }
  }

  async editMessage(messageId, text) {
    const collection = getCollection();
    try {
      const result = await collection.get(messageId);
      const doc = result.content;
      doc.text = text;
      doc.updatedAt = new Date().toISOString();
      await collection.replace(messageId, doc);
    } catch (e) {}
  }

  async deleteMessage(messageId, forEveryone) {
    const collection = getCollection();
    try {
      if (forEveryone) {
        const result = await collection.get(messageId);
        const doc = result.content;
        doc.isDeleted = true;
        doc.text = "This message was deleted";
        await collection.replace(messageId, doc);
      }
    } catch (e) {}
  }

  async getPendingMessages(userId) {
    const cluster = getCluster();
    const query = `
      SELECT meta().id, *
      FROM \`${cbBucket}\`
      WHERE receiverId = $1
      AND status = 'sent'
      AND type = 'chat_message'
    `;
    try {
      const results = await cluster.query(query, { parameters: [userId] });
      return results.rows;
    } catch (e) {
      console.error("Couchbase Query Error:", e);
      return [];
    }
  }

  async markAsDelivered(docId, msg) {
    const collection = getCollection();
    msg.status = 'delivered';
    await collection.upsert(docId, msg);
  }

  async saveFcmToken(userId, token) {
    if (!token) return;
    const collection = getCollection();
    try {
      await collection.upsert(`fcm_${userId}`, { userId, token, updatedAt: new Date().toISOString() });
    } catch (e) {
      console.error("Save FCM Error:", e);
    }
  }

  async getFcmToken(userId) {
    const collection = getCollection();
    try {
      const result = await collection.get(`fcm_${userId}`);
      return result.content.token;
    } catch (e) {
      return null;
    }
  }

  async sendPushNotification(fcmToken, messageData) {
    if (!admin || !fcmToken) return;

    const payload = {
      token: fcmToken,
      notification: {
        title: messageData.senderUser ? `${messageData.senderUser.firstName} ${messageData.senderUser.lastName}` : "New Message",
        body: messageData.messageType === 'text' ? messageData.text : `Sent a ${messageData.messageType}`,
      },
      data: {
        type: 'chat',
        senderId: messageData.senderId,
        conversationId: messageData.conversationId,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'swisspay_channel',
          icon: 'stock_ticker_update',
          color: '#6A1B9A'
        }
      }
    };

    try {
      await admin.messaging().send(payload);
      console.log(`[Push] Notification sent to token ending in ...${fcmToken.slice(-5)}`);
    } catch (e) {
      console.error("FCM Send Error:", e);
    }
  }

  // --- Channel Methods ---
  async createChannel(data) {
    const collection = getCollection();
    const channelDoc = {
      ...data,
      type: 'channel',
      createdAt: new Date().toISOString(),
      followerCount: 0
    };
    await collection.upsert(`channel_${data.id}`, channelDoc);
    return channelDoc;
  }

  async followChannel(channelId, userId) {
    const collection = getCollection();
    try {
      // 1. Create follower link
      await collection.upsert(`follower_${channelId}_${userId}`, {
        type: 'channel_follower',
        channelId,
        userId,
        followedAt: new Date().toISOString()
      });

      // 2. Increment follower count on channel
      const result = await collection.get(`channel_${channelId}`);
      const channel = result.content;
      channel.followerCount = (channel.followerCount || 0) + 1;
      await collection.replace(`channel_${channelId}`, channel);
    } catch (e) {
      console.error("Follow Channel Error:", e);
    }
  }

  async getChannelFollowers(channelId) {
    const cluster = getCluster();
    const query = `
      SELECT userId
      FROM \`${cbBucket}\`
      WHERE channelId = $1
      AND type = 'channel_follower'
    `;
    try {
      const results = await cluster.query(query, { parameters: [channelId] });
      return results.rows.map(row => row.userId);
    } catch (e) {
      return [];
    }
  }

  async saveChannelMessage(data) {
    const collection = getCollection();
    const messageDoc = {
      ...data,
      type: 'channel_message',
      createdAt: new Date().toISOString()
    };
    await collection.upsert(data.id, messageDoc);
    return messageDoc;
  }
}

module.exports = new ChatService();
