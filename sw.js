const express     = require('express');
const { body, validationResult } = require('express-validator');
const SwapTrade   = require('../models/SwapTrade');
const HourBalance = require('../models/HourBalance');
const Notification= require('../models/Notification');
const { protect, managerOnly } = require('../middleware/auth');
const router = express.Router();
router.use(protect);

async function notify(userId, title, message, tradeId) {
  try { await Notification.create({ user:userId, type:'swap_new', title, message, relatedSwap:tradeId }); } catch(_){}
}
async function getBalance(userId) {
  return HourBalance.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: { user:userId, balance:0, totalEarned:0, totalSpent:0 } },
    { upsert:true, new:true }
  );
}

// GET /api/trades
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.tradeType) filter.tradeType = req.query.tradeType;
    if (req.query.mine === 'true') filter.$or = [{ giver:req.user._id },{ receiver:req.user._id }];
    else filter.status = filter.status || 'open';
    const trades = await SwapTrade.find(filter)
      .populate('giver','name department swapStats')
      .populate('receiver','name department')
      .sort({ createdAt:-1 }).limit(50);
    res.json({ success:true, count:trades.length, trades });
  } catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

// GET /api/trades/stats/summary
router.get('/stats/summary', managerOnly, async (req, res) => {
  try {
    const [open, pending, completed, totalTrades] = await Promise.all([
      SwapTrade.countDocuments({ status:'open' }),
      SwapTrade.countDocuments({ status:{ $in:['pending','accepted'] } }),
      SwapTrade.countDocuments({ status:'completed' }),
      SwapTrade.countDocuments(),
    ]);
    const topTraders = await HourBalance.find().populate('user','name department').sort({ totalEarned:-1 }).limit(5);
    res.json({ success:true, stats:{ open, pending, completed, totalTrades }, topTraders });
  } catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

// GET /api/trades/balance/me
router.get('/balance/me', async (req, res) => {
  try { const bal = await getBalance(req.user._id); res.json({ success:true, balance:bal }); }
  catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

// GET /api/trades/balance/leaderboard
router.get('/balance/leaderboard', async (req, res) => {
  try {
    const top = await HourBalance.find({ totalEarned:{ $gt:0 } }).populate('user','name department').sort({ totalEarned:-1 }).limit(10);
    res.json({ success:true, leaderboard:top });
  } catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

// GET /api/trades/:id
router.get('/:id', async (req, res) => {
  try {
    const trade = await SwapTrade.findById(req.params.id)
      .populate('giver','name department').populate('receiver','name department').populate('managerId','name');
    if (!trade) return res.status(404).json({ success:false, message:'Trade not found' });
    res.json({ success:true, trade });
  } catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

// POST /api/trades
router.post('/', [body('shiftsGiver').isArray({ min:1 }), body('shiftsGiver.*.hours').isNumeric()], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ success:false, errors:errs.array() });
  try {
    const { shiftsGiver, shiftsReceiver, reason, scheduledDate } = req.body;
    const totalGiver    = shiftsGiver.reduce((s,x) => s + Number(x.hours), 0);
    const totalReceiver = (shiftsReceiver||[]).reduce((s,x) => s + Number(x.hours), 0);
    const trade = await SwapTrade.create({
      giver: req.user._id,
      shiftsGiver: shiftsGiver.map(s => ({ ...s, date:new Date(s.date) })),
      shiftsReceiver: (shiftsReceiver||[]).map(s => ({ ...s, date:new Date(s.date) })),
      totalHoursGiver: totalGiver, totalHoursReceiver: totalReceiver,
      reason, scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined, status:'open'
    });
    res.status(201).json({ success:true, trade });
  } catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

// POST /api/trades/:id/accept
router.post('/:id/accept', async (req, res) => {
  try {
    const trade = await SwapTrade.findById(req.params.id).populate('giver','name');
    if (!trade) return res.status(404).json({ success:false, message:'Trade not found' });
    if (trade.status !== 'open') return res.status(400).json({ success:false, message:'Trade is no longer open' });
    if (trade.giver._id.toString() === req.user._id.toString()) return res.status(400).json({ success:false, message:"Can't accept your own trade" });
    trade.receiver = req.user._id; trade.receiverApproved = true; trade.status = 'pending';
    await trade.save();
    await notify(trade.giver._id, 'Trade Accepted ✓', `${req.user.name} accepted your trade offer`, trade._id);
    res.json({ success:true, trade });
  } catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

// POST /api/trades/:id/confirm
router.post('/:id/confirm', async (req, res) => {
  try {
    const trade = await SwapTrade.findById(req.params.id).populate('receiver','name');
    if (!trade) return res.status(404).json({ success:false, message:'Trade not found' });
    if (trade.giver.toString() !== req.user._id.toString()) return res.status(403).json({ success:false, message:'Only the trade creator can confirm' });
    if (trade.status !== 'pending') return res.status(400).json({ success:false, message:'Trade must be pending to confirm' });
    trade.giverApproved = true; trade.status = 'accepted';
    await trade.save();
    await notify(trade.receiver._id, 'Trade Confirmed ✓', `${req.user.name} confirmed — awaiting manager approval`, trade._id);
    res.json({ success:true, trade });
  } catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

// POST /api/trades/:id/approve
router.post('/:id/approve', managerOnly, async (req, res) => {
  try {
    const trade = await SwapTrade.findById(req.params.id).populate('giver','name').populate('receiver','name');
    if (!trade) return res.status(404).json({ success:false, message:'Trade not found' });
    if (trade.status !== 'accepted') return res.status(400).json({ success:false, message:'Trade must be accepted before approval' });
    trade.managerApproved = true; trade.managerId = req.user._id;
    trade.managerNote = req.body.note || ''; trade.status = 'completed';
    await trade.save();
    const giverBal = await getBalance(trade.giver._id);
    const recvBal  = await getBalance(trade.receiver._id);
    await giverBal.addTransaction('credit', trade.totalHoursGiver, `Trade with ${trade.receiver.name}`, trade._id);
    await recvBal.addTransaction('debit',   trade.totalHoursGiver, `Trade with ${trade.giver.name}`,    trade._id);
    if (trade.totalHoursReceiver > 0) {
      await recvBal.addTransaction('credit',  trade.totalHoursReceiver, `Trade with ${trade.giver.name}`,    trade._id);
      await giverBal.addTransaction('debit',  trade.totalHoursReceiver, `Trade with ${trade.receiver.name}`, trade._id);
    }
    const msg = `Manager ${req.user.name} approved the trade ✓`;
    await notify(trade.giver._id,    'Trade Approved ✅', msg, trade._id);
    await notify(trade.receiver._id, 'Trade Approved ✅', msg, trade._id);
    res.json({ success:true, trade });
  } catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

// POST /api/trades/:id/reject
router.post('/:id/reject', managerOnly, async (req, res) => {
  try {
    const trade = await SwapTrade.findById(req.params.id).populate('giver','name').populate('receiver','name');
    if (!trade) return res.status(404).json({ success:false, message:'Trade not found' });
    trade.status = 'rejected'; trade.managerId = req.user._id; trade.managerNote = req.body.note||'';
    await trade.save();
    const reason = req.body.note ? ` Reason: ${req.body.note}` : '';
    await notify(trade.giver._id, 'Trade Rejected ❌', `Your trade was rejected.${reason}`, trade._id);
    if (trade.receiver) await notify(trade.receiver._id, 'Trade Rejected ❌', `Trade rejected.${reason}`, trade._id);
    res.json({ success:true, message:'Rejected' });
  } catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

// DELETE /api/trades/:id
router.delete('/:id', async (req, res) => {
  try {
    const trade = await SwapTrade.findById(req.params.id);
    if (!trade) return res.status(404).json({ success:false, message:'Trade not found' });
    if (trade.giver.toString() !== req.user._id.toString()) return res.status(403).json({ success:false, message:'Not authorised' });
    if (!['open','pending'].includes(trade.status)) return res.status(400).json({ success:false, message:"Can't cancel in current status" });
    trade.status = 'cancelled'; await trade.save();
    res.json({ success:true, message:'Trade cancelled' });
  } catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

module.exports = router;
