const mongoose = require('mongoose');

const savedQuoteSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  quoteId: { type: Number, required: true },
  // Denormalize quote data so we don't need quotes.json on read
  text:    { type: String, required: true },
  textAr:  { type: String },
  author:  { type: String },
  category:{ type: String },
}, { timestamps: true });

// One save per user per quote
savedQuoteSchema.index({ user: 1, quoteId: 1 }, { unique: true });

module.exports = mongoose.model('SavedQuote', savedQuoteSchema);
