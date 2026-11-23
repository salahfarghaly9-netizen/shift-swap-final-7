const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  type:        { type: String, enum: ['credit','debit'], required: true },
  hours:       { type: Number, required: true },
  description: { type: String },
  tradeId:     { type: mongoose.Schema.Types.ObjectId, ref: 'SwapTrade', default: null },
  createdAt:   { type: Date, default: Date.now }
});

const hourBalanceSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance:     { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  totalSpent:  { type: Number, default: 0 },
  transactions: [transactionSchema]
}, { timestamps: true });

hourBalanceSchema.methods.addTransaction = async function(type, hours, description, tradeId) {
  this.transactions.push({ type, hours, description, tradeId });
  if (type === 'credit') { this.balance += hours; this.totalEarned += hours; }
  else                   { this.balance -= hours; this.totalSpent  += hours; }
  return this.save();
};

module.exports = mongoose.model('HourBalance', hourBalanceSchema);
