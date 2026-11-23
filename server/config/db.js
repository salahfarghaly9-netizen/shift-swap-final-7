const mongoose = require('mongoose');
const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI not set — add it in Render → Environment');
    process.exit(1);
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const indexes=await mongoose.connection.db.collection('rosterimports').indexes().catch(()=>[]);
    if(indexes.some(i=>i.name==='createdAt_1'&&i.expireAfterSeconds!==undefined))await mongoose.connection.db.collection('rosterimports').dropIndex('createdAt_1');
    console.log('✅ MongoDB Atlas connected');
  } catch (err) {
    console.error('❌ MongoDB failed:', err.message);
    console.error('   Check: URI correct + Atlas IP whitelist = 0.0.0.0/0');
    process.exit(1);
  }
};
module.exports = connectDB;
