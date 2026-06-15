const BaseController = require('./BaseController');
const CommerceService = require('../services/CommerceService');

class CommerceController extends BaseController {
  constructor(io) {
    super(io);
  }

  handleEvents(socket) {
    socket.on('create_ad', (data) => this.createAd(socket, data));
    socket.on('get_ads', (data) => this.getAds(socket, data));
    socket.on('get_featured_ads', (data) => this.getFeaturedAds(socket, data));
    socket.on('get_my_ads', (data) => this.getMyAds(socket, data));
    socket.on('get_ad_categories', (data) => this.getAdCategories(socket, data));
    socket.on('update_ad_status', (data) => this.updateAdStatus(socket, data));
    socket.on('delete_ad', (data) => this.deleteAd(socket, data));
    socket.on('ad_view', (data) => this.adView(socket, data));
  }

  async createAd(socket, data) {
    if (!data || !data.id) return;
    try {
      const ad = await CommerceService.createAd({ ...data, userId: socket.userId });
      socket.emit('ad_created', ad);
      this.io.emit('new_ad', ad);
    } catch (e) {
      socket.emit('error', { message: "Failed to create ad" });
    }
  }

  async getAds(socket, data) {
    const ads = await CommerceService.getAllAds();
    socket.emit('ads_list', ads);
  }

  async getFeaturedAds(socket, data) {
    const ads = await CommerceService.getFeaturedAds();
    socket.emit('featured_ads_list', ads);
  }

  async getMyAds(socket, data) {
    if (!socket.userId) return;
    const ads = await CommerceService.getMyAds(socket.userId);
    socket.emit('my_ads_list', ads);
  }

  async getAdCategories(socket, data) {
    const cats = await CommerceService.getCategories();
    socket.emit('ad_categories_list', cats);
  }

  async updateAdStatus(socket, data) {
    if (!data || !data.adId || !data.status) return;
    await CommerceService.updateAdStatus(data.adId, data.status);
    this.io.emit('ad_status_updated', data);
  }

  async deleteAd(socket, data) {
    if (!data || !data.adId) return;
    const success = await CommerceService.deleteAd(data.adId);
    if (success) {
      this.io.emit('ad_deleted', { adId: data.adId });
    }
  }

  async adView(socket, data) {
    if (!data || !data.adId) return;
    const views = await CommerceService.incrementAdViews(data.adId);
    this.io.emit('ad_view_update', { adId: data.adId, views });
  }
}

module.exports = CommerceController;
