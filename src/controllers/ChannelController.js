const BaseController = require('./BaseController');
const { getRedis } = require('../config/database');
const ChannelService = require('../services/ChannelService');
const ChatService = require('../services/ChatService');

class ChannelController extends BaseController {
  constructor(io) {
    super(io);
  }

  handleEvents(socket) {
    socket.on('create_channel', (data) => this.createChannel(socket, data));
    socket.on('get_channels', (data) => this.getChannels(socket, data));
    socket.on('get_my_channels', (data) => this.getMyChannels(socket, data));
    socket.on('follow_channel', (data) => this.followChannel(socket, data));
    socket.on('channel_message', (data) => this.channelMessage(socket, data));
    socket.on('channel_view', (data) => this.channelView(socket, data));
    socket.on('channel_reaction', (data) => this.channelReaction(socket, data));
    socket.on('delete_channel', (data) => this.deleteChannel(socket, data));
    socket.on('update_channel', (data) => this.updateChannel(socket, data));
    socket.on('get_channel_messages', (data) => this.getChannelMessages(socket, data));
    socket.on('edit_channel_message', (data) => this.editChannelMessage(socket, data));
    socket.on('delete_channel_message', (data) => this.deleteChannelMessage(socket, data));
  }

  async createChannel(socket, data) {
    if (!data || !data.id) return;
    try {
      const channel = await ChannelService.createChannel(data);
      socket.emit('channel_created', channel);
    } catch (e) {
      socket.emit('error', { message: "Failed to create channel" });
    }
  }

  async getChannels(socket, data) {
    const channels = await ChannelService.getAllChannels();
    socket.emit('channels_list', channels);
  }

  async getMyChannels(socket, data) {
    if (!socket.userId) return;
    const channels = await ChannelService.getMyFollowedChannels(socket.userId);
    socket.emit('my_channels_list', channels);
  }

  async followChannel(socket, data) {
    if (!data || !data.channelId) return;
    await ChannelService.followChannel(data.channelId, socket.userId);

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

  async channelMessage(socket, data) {
    if (!data || !data.channelId) return;
    try {
      const messageDoc = await ChannelService.saveChannelMessage(data);
      socket.emit('status', { messageId: data.id, channelId: data.channelId, status: 'sent', text: messageDoc.text });

      const followers = await ChannelService.getChannelFollowers(data.channelId);
      const redis = getRedis();
      for (const followerId of followers) {
        if (followerId === socket.userId) continue;
        const followerData = await redis.hGet('online_users', followerId);
        if (followerData) {
          const f = JSON.parse(followerData);
          this.io.to(f.socketId).emit('message', { ...messageDoc, isChannelMessage: true });
        } else {
          const token = await ChatService.getFcmToken(followerId);
          if (token) await ChatService.sendPushNotification(token, { ...messageDoc, senderUser: { firstName: data.channelName || "Channel", lastName: "" } });
        }
      }
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  }

  async channelView(socket, data) {
    if (!data || !data.messageId || !data.channelId) return;
    const views = await ChannelService.incrementChannelViews(data.messageId);
    const followers = await ChannelService.getChannelFollowers(data.channelId);
    const redis = getRedis();
    for (const followerId of followers) {
      const fData = await redis.hGet('online_users', followerId);
      if (fData) this.io.to(JSON.parse(fData).socketId).emit('view_update', { messageId: data.messageId, views });
    }
  }

  async channelReaction(socket, data) {
    if (!data || !data.messageId || !data.reaction || !data.channelId) return;
    const reactions = await ChatService.saveReaction(data.messageId, socket.userId, data.reaction);
    if (!reactions) return;

    const followers = await ChannelService.getChannelFollowers(data.channelId);
    const redis = getRedis();
    for (const fId of followers) {
      const fData = await redis.hGet('online_users', fId);
      if (fData) {
        this.io.to(JSON.parse(fData).socketId).emit('message_reaction', {
          messageId: data.messageId,
          userId: socket.userId,
          reaction: data.reaction,
          reactions: reactions,
          conversationId: `channel_${data.channelId}`
        });
      }
    }
  }

  async deleteChannel(socket, data) {
    if (!data || !data.channelId || !socket.userId) return;
    try {
      const success = await ChannelService.deleteChannel(data.channelId, socket.userId);
      if (success) {
        this.io.emit('channel_deleted', { channelId: data.channelId });
      }
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  }

  async updateChannel(socket, data) {
    if (!data || !data.channelId || !socket.userId) return;
    try {
      const updatedChannel = await ChannelService.updateChannel(data.channelId, socket.userId, data);
      this.io.emit('channel_updated', updatedChannel);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  }

  async getChannelMessages(socket, data) {
    if (!data || !data.channelId) return;
    const messages = await ChannelService.getChannelMessages(data.channelId, data.page || 1);
    socket.emit('channel_messages_list', { channelId: data.channelId, messages });
  }

  async editChannelMessage(socket, data) {
    if (!data || !data.messageId || !data.text || !socket.userId) return;
    try {
      const updatedMsg = await ChannelService.editChannelMessage(data.messageId, socket.userId, data.text);
      this.io.emit('channel_message_edited', updatedMsg);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  }

  async deleteChannelMessage(socket, data) {
    if (!data || !data.messageId || !socket.userId) return;
    try {
      await ChannelService.deleteChannelMessage(data.messageId, socket.userId);
      this.io.emit('channel_message_deleted', { messageId: data.messageId, channelId: data.channelId });
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  }
}

module.exports = ChannelController;
