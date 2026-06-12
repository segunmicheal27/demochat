const { getCollection, getCluster, cbBucket } = require('../config/database');
const { admin } = require('../config/firebase');
const cloudinary = require('../config/cloudinary');

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

  async getAllChannels() {
    const cluster = getCluster();
    const query = `
      SELECT meta().id, *
      FROM \`${cbBucket}\`
      WHERE type = 'channel'
      ORDER BY createdAt DESC
      LIMIT 100
    `;
    try {
      const results = await cluster.query(query);
      return results.rows.map(row => ({ id: row.id, ...row[cbBucket] }));
    } catch (e) {
      console.error("GetAllChannels Error:", e);
      return [];
    }
  }

  async getMyFollowedChannels(userId) {
    const cluster = getCluster();
    const query = `
      SELECT c.*
      FROM \`${cbBucket}\` AS f
      JOIN \`${cbBucket}\` AS c ON KEYS "channel_" || f.channelId
      WHERE f.type = 'channel_follower'
      AND f.userId = $1
    `;
    try {
      const results = await cluster.query(query, { parameters: [userId] });
      return results.rows;
    } catch (e) {
      console.error("GetMyFollowedChannels Error:", e);
      return [];
    }
  }

  async saveChannelMessage(data) {
    const collection = getCollection();

    // 1. Verify ownership logic on server side
    const channelResult = await collection.get(`channel_${data.channelId}`);
    const channel = channelResult.content;
    if (channel.ownerId !== data.senderId) {
      throw new Error("Only the channel owner can post messages.");
    }

    const messageDoc = {
      ...data,
      type: 'channel_message',
      createdAt: new Date().toISOString(),
      views: 0
    };
    await collection.upsert(data.id, messageDoc);
    return messageDoc;
  }

  async incrementChannelViews(messageId) {
    const collection = getCollection();
    try {
      const result = await collection.get(messageId);
      const doc = result.content;
      doc.views = (doc.views || 0) + 1;
      await collection.replace(messageId, doc);
      return doc.views;
    } catch (e) {
      return 0;
    }
  }

  async saveReaction(messageId, userId, reaction) {
    const collection = getCollection();
    try {
      const result = await collection.get(messageId);
      const doc = result.content;
      if (!doc.reactions) doc.reactions = {};
      doc.reactions[userId] = reaction;
      await collection.replace(messageId, doc);
      return doc.reactions;
    } catch (e) {
      console.error("Save Reaction Error:", e);
      return null;
    }
  }

  // --- Marketplace (Ad) Methods ---
  async createAd(data) {
    const collection = getCollection();
    const adDoc = {
      ...data,
      type: 'ad',
      status: 'active',
      views: 0,
      createdAt: new Date().toISOString()
    };
    await collection.upsert(`ad_${data.id}`, adDoc);
    return adDoc;
  }

  async getAllAds() {
    const cluster = getCluster();
    const query = `
      SELECT meta().id, *
      FROM \`${cbBucket}\`
      WHERE type = 'ad'
      AND status = 'active'
      ORDER BY createdAt DESC
      LIMIT 100
    `;
    try {
      const results = await cluster.query(query);
      return results.rows.map(row => ({ id: row.id, ...row[cbBucket] }));
    } catch (e) {
      return [];
    }
  }

  async getMyAds(userId) {
    const cluster = getCluster();
    const query = `
      SELECT meta().id, *
      FROM \`${cbBucket}\`
      WHERE type = 'ad'
      AND userId = $1
      ORDER BY createdAt DESC
    `;
    try {
      const results = await cluster.query(query, { parameters: [userId] });
      return results.rows.map(row => ({ id: row.id, ...row[cbBucket] }));
    } catch (e) {
      return [];
    }
  }

  async updateAdStatus(adId, status) {
    const collection = getCollection();
    try {
      const result = await collection.get(`ad_${adId}`);
      const doc = result.content;
      doc.status = status;
      await collection.replace(`ad_${adId}`, doc);
    } catch (e) {}
  }

  async incrementAdViews(adId) {
    const collection = getCollection();
    try {
      const result = await collection.get(`ad_${adId}`);
      const doc = result.content;
      doc.views = (doc.views || 0) + 1;
      await collection.replace(`ad_${adId}`, doc);
      return doc.views;
    } catch (e) {
      return 0;
    }
  }

  // --- Upload Methods ---
  async uploadImage(base64Data) {
    try {
      const result = await cloudinary.uploader.upload(base64Data, {
        folder: 'swisspay/marketplace'
      });
      return result.secure_url;
    } catch (e) {
      console.error("Cloudinary Upload Error:", e);
      throw e;
    }
  }
}

module.exports = new ChatService();
