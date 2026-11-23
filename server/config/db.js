const mongoose = require('mongoose');
const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI not set — add it in Render → Environment');
    process.exit(1);
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Atlas connected');
  } catch (err) {
    console.error('❌ MongoDB failed:', err.message);
    console.error('   Check: URI correct + Atlas IP whitelist = 0.0.0.0/0');
    process.exit(1);
  }
};
module.exports = connectDB;
