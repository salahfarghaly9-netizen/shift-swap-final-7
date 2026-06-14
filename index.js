const mongoose = require('mongoose');

/**
 * Stores Google OAuth2 tokens per user.
 * Tokens are encrypted at rest in production — use KMS or vault for production.
 */
const googleTokenSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  accessToken:  { type: String, required: true },
  refreshToken: { type: String, required: true },
  expiryDate:   { type: Number }, // epoch ms
  scope:        { type: String },
  tokenType:    { type: String, default: 'Bearer' },
  // Calendar sync settings
  calendarEnabled: { type: Boolean, default: true },
  calendarId:      { type: String, default: 'primary' }, // 'primary' = user's main calendar
}, { timestamps: true });

module.exports = mongoose.model('GoogleToken', googleTokenSchema);
