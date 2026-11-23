const mongoose = require('mongoose');

const swapTradeSchema = new mongoose.Schema({
  giver:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  shiftsGiver: [{ shift: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' }, hours: Number, date: Date, type: String }],
  shiftsReceiver: [{ shift: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' }, hours: Number, date: Date, type: String }],
  totalHoursGiver:    { type: Number, default: 0 },
  totalHoursReceiver: { type: Number, default: 0 },
  netBalance: { type: Number, default: 0 },
  tradeType:  { type: String, enum: ['equal','partial','premium'], default: 'equal' },
  status:     { type: String, enum: ['open','pending','accepted','approved','completed','cancelled','rejected'], default: 'open' },
  giverApproved:    { type: Boolean, default: false },
  receiverApproved: { type: Boolean, default: false },
  managerApproved:  { type: Boolean, default: false },
  managerId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  managerNote:      { type: String, default: '' },
  reason:        { type: String, maxlength: 500 },
  scheduledDate: { type: Date },
}, { timestamps: true });

swapTradeSchema.index({ giver: 1, status: 1 });
swapTradeSchema.index({ status: 1, createdAt: -1 });

swapTradeSchema.pre('save', function(next) {
  this.netBalance = (this.totalHoursGiver||0) - (this.totalHoursReceiver||0);
  if      (this.netBalance === 0)  this.tradeType = 'equal';
  else if (Math.abs(this.netBalance) < (this.totalHoursGiver||1)) this.tradeType = 'partial';
  else    this.tradeType = 'premium';
  next();
});

module.exports = mongoose.model('SwapTrade', swapTradeSchema);
