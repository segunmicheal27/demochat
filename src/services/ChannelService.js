const { getCollection, getCluster, cbBucket } = require('../config/database');

class ChannelService {
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

    // Verify ownership
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
}

module.exports = new ChannelService();
