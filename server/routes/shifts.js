const express = require('express');
const { body, validationResult } = require('express-validator');
const Shift = require('../models/Shift');
const { protect, managerOnly } = require('../middleware/auth');
const router = express.Router();
router.use(protect);

router.get('/my', async (req, res) => {
  try {
    const requested=req.query.week;
    if(requested && (!/^\d{4}-\d{2}-\d{2}$/.test(requested)||isNaN(new Date(requested))))return res.status(400).json({success:false,message:'Invalid week date'});
    const now = requested?new Date(requested+'T00:00:00Z'):new Date();
    const mon = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
    mon.setUTCDate(mon.getUTCDate()-mon.getUTCDay());
    const sun = new Date(mon);sun.setUTCDate(mon.getUTCDate()+7);sun.setUTCMilliseconds(-1);
    const shifts = await Shift.find({user:req.user._id,date:{$gte:mon,$lte:sun}}).sort({date:1,startTime:1});
    res.json({success:true, shifts, weekStart:mon, weekEnd:sun});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.user.role==='employee'&&!req.query.userId) filter.user=req.user._id;
    else if (req.query.userId) filter.user=req.query.userId;
    if (req.query.status) filter.status=req.query.status;
    if (req.query.department) filter.department=req.query.department;
    if (req.query.from||req.query.to) {
      filter.date={};
      if(req.query.from) filter.date.$gte=new Date(req.query.from);
      if(req.query.to) filter.date.$lte=new Date(req.query.to);
    }
    const shifts = await Shift.find(filter).populate('user','name department').sort({date:1,startTime:1});
    res.json({success:true, count:shifts.length, shifts});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});

router.post('/', managerOnly, [
  body('userId').notEmpty(), body('date').isISO8601(),
  body('startTime').matches(/^\d{2}:\d{2}$/), body('endTime').matches(/^\d{2}:\d{2}$/),
  body('department').notEmpty(), body('type').isIn(['Morning','Afternoon','Night','Half']),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({success:false,errors:errs.array()});
  try {
    const shift = await Shift.create({
      user:req.body.userId, date:new Date(req.body.date),
      startTime:req.body.startTime, endTime:req.body.endTime,
      department:req.body.department, type:req.body.type,
      status:req.body.status||'Confirmed', notes:req.body.notes
    });
    res.status(201).json({success:true, shift});
  } catch(err) {
    if (err.code===11000) return res.status(409).json({success:false,message:'Shift already exists at this time'});
    res.status(500).json({success:false,message:err.message});
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) return res.status(404).json({success:false,message:'Shift not found'});
    const isOwner = shift.user.toString()===req.user._id.toString();
    if (!isOwner&&req.user.role!=='manager') return res.status(403).json({success:false,message:'Not authorised'});
    const allowed = req.user.role==='manager' ? ['status','startTime','endTime','date','department','type','notes'] : ['notes'];
    allowed.forEach(k => { if(req.body[k]!==undefined) shift[k]=req.body[k]; });
    await shift.save();
    res.json({success:true, shift});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});

router.delete('/:id', managerOnly, async (req, res) => {
  try {
    const shift = await Shift.findByIdAndDelete(req.params.id);
    if (!shift) return res.status(404).json({success:false,message:'Shift not found'});
    res.json({success:true,message:'Shift deleted'});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});

module.exports = router;
