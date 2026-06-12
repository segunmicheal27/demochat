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

  async getCategories() {
    // Return high-quality categories for Jiji-style marketplace
    return [
      { id: "vehicles", name: "Vehicles", icon: "directions_car", color: "blue" },
      { id: "property", name: "Property", icon: "home_work", color: "orange" },
      { id: "phones", name: "Phones", icon: "smartphone", color: "green" },
      { id: "electronics", name: "Electronics", icon: "laptop_mac", color: "purple" },
      { id: "fashion", name: "Fashion", icon: "checkroom", color: "pink" },
      { id: "home", name: "Home & Garden", icon: "chair", color: "brown" },
      { id: "services", name: "Services", icon: "build", color: "red" },
      { id: "jobs", name: "Jobs", icon: "work", color: "cyan" },
      { id: "babies", name: "Babies & Kids", icon: "child_care", color: "yellow" },
      { id: "animals", name: "Animals & Pets", icon: "pets", color: "teal" }
    ];
  }
}

module.exports = new CommerceService();
