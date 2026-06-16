const { getCollection, getCluster, cbBucket } = require('../config/database');

class CommerceService {
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
      LIMIT 200
    `;
    try {
      const results = await cluster.query(query);
      return results.rows.map(row => ({ id: row.id, ...row[cbBucket] }));
    } catch (e) {
      return [];
    }
  }

  async getFeaturedAds() {
    const cluster = getCluster();
    const query = `
      SELECT meta().id, *
      FROM \`${cbBucket}\`
      WHERE type = 'ad'
      AND status = 'active'
      AND isFeatured = true
      ORDER BY createdAt DESC
      LIMIT 10
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

  async deleteAd(adId) {
    const collection = getCollection();
    try {
      await collection.remove(`ad_${adId}`);
      return true;
    } catch (e) {
      return false;
    }
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

  async getCategories() {
    return [
      { id: "vehicles", name: "Vehicles", icon: "directions_car", color: "blue", image: "https://jiji.ng/assets/static/main/index/categories/vehicles.png" },
      { id: "property", name: "Property", icon: "home_work", color: "orange", image: "https://jiji.ng/assets/static/main/index/categories/real-estate.png" },
      { id: "phones", name: "Phones & Tablets", icon: "smartphone", color: "green", image: "https://jiji.ng/assets/static/main/index/categories/mobile.png" },
      { id: "electronics", name: "Electronics", icon: "laptop_mac", color: "purple", image: "https://jiji.ng/assets/static/main/index/categories/electronics.png" },
      { id: "home", name: "Home, Furniture & Appliances", icon: "chair", color: "brown", image: "https://jiji.ng/assets/static/main/index/categories/home-garden.png" },
      { id: "fashion", name: "Health & Beauty", icon: "face", color: "pink", image: "https://jiji.ng/assets/static/main/index/categories/beauty.png" },
      { id: "fashion_wear", name: "Fashion", icon: "checkroom", color: "red", image: "https://jiji.ng/assets/static/main/index/categories/fashion.png" },
      { id: "hobbies", name: "Hobbies, Art & Sport", icon: "sports_basketball", color: "teal", image: "https://jiji.ng/assets/static/main/index/categories/hobbies.png" },
      { id: "services", name: "Services", icon: "build", color: "grey", image: "https://jiji.ng/assets/static/main/index/categories/services.png" }
    ];
  }
}

module.exports = new CommerceService();
