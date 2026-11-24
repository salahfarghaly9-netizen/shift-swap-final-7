const express = require('express');
const { body, validationResult } = require('express-validator');
const SwapRequest  = require('../models/SwapRequest');
const Shift        = require('../models/Shift');
const User         = require('../models/User');
const Notification = require('../models/Notification');
const { protect, managerOnly } = require('../middleware/auth');
const Setting = require('../models/AppSetting');
const router = express.Router();
router.use(protect);

// One policy governs manager approval for every swap flow (same setting as the hours market).
async function swapPolicy(){return (await Setting.findOne({key:'marketPolicy'}))?.value||{managerApproval:true,minRestHours:null};}

function visibleSwap(doc,user){if(user.role==='manager')return doc;const s=doc.toObject?doc.toObject():doc;const person=p=>p?{_id:p._id,name:p.name,department:p.department}:null;const shift=p=>p?{_id:p._id,date:p.date,startTime:p.startTime,endTime:p.endTime,type:p.type,department:p.department,workMode:p.workMode,status:p.status}:null;return {_id:s._id,requester:person(s.requester),acceptor:person(s.acceptor),requesterShift:shift(s.requesterShift),acceptorShift:shift(s.acceptorShift),status:s.status,mode:s.mode,reason:s.reason,availableTimes:s.availableTimes,urgency:s.urgency,createdAt:s.createdAt,updatedAt:s.updatedAt};}

const {notify,cairoStart}=require('../services/notificationService');

router.get('/stats/summary', managerOnly, async (req, res) => {
  try {
    const [open,accepted,approved,rejected,total,urgent] = await Promise.all([
      SwapRequest.countDocuments({status:'Open'}),
      SwapRequest.countDocuments({status:'Accepted'}),
      SwapRequest.countDocuments({status:'Approved'}),
      SwapRequest.countDocuments({status:'Rejected'}),
      SwapRequest.countDocuments(),
      SwapRequest.countDocuments({status:'Open',urgency:'Urgent'}),
    ]);
    res.json({success:true, stats:{open,accepted,approved,rejected,total,urgent}});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status=req.query.status;
    if (req.query.urgency) filter.urgency=req.query.urgency;
    if (req.query.mine==='true') filter.requester=req.user._id;
    if (!req.query.status&&req.query.mine!=='true') filter.status='Open';
    if(req.user.role!=='manager'){filter.$or=[{requester:req.user._id},{acceptor:req.user._id},{status:'Open',requesterShift:{$in:(await Shift.find({department:req.user.department}).select('_id')).map(s=>s._id)}}];}
    const page=Math.max(1,parseInt(req.query.page)||1);
    const limit=Math.min(50,parseInt(req.query.limit)||20);
    const [swaps,total] = await Promise.all([
      SwapRequest.find(filter)
        .populate('requester','name department')
        .populate('acceptor','name department').populate('acceptorShift')
        .populate({path:'requesterShift',populate:{path:'user',select:'name'}})
        .sort({createdAt:-1}).skip((page-1)*limit).limit(limit),
      SwapRequest.countDocuments(filter)
    ]);
    res.json({success:true, total, page, pages:Math.ceil(total/limit), swaps:swaps.map(sw=>visibleSwap(sw,req.user))});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});

router.get('/:id', async (req, res) => {
  try {
    const swap = await SwapRequest.findById(req.params.id)
      .populate('requester','name email department swapStats')
      .populate('acceptor','name email department')
      .populate('reviewedBy','name').populate('requesterShift').populate('acceptorShift');
    if (!swap) return res.status(404).json({success:false,message:'Swap not found'});
    if(req.user.role!=='manager'&&String(swap.requester?._id)!==String(req.user._id)&&String(swap.acceptor?._id)!==String(req.user._id)&&!(swap.status==='Open'&&swap.requesterShift?.department===req.user.department))return res.status(403).json({success:false,message:'Swap is not available to you.'});
    res.json({success:true, swap:visibleSwap(swap,req.user)});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});

router.post('/', [body('shiftId').notEmpty(), body('urgency').optional().isIn(['Normal','Medium','Urgent'])], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({success:false,errors:errs.array()});
  try {
    const shift = await Shift.findById(req.body.shiftId);
    if (!shift) return res.status(404).json({success:false,message:'Shift not found'});
    if (shift.user.toString()!==req.user._id.toString()) return res.status(403).json({success:false,message:"This shift doesn't belong to you"});
    if(cairoStart(shift)<=new Date())return res.status(400).json({success:false,message:'Shift has already started.'});
    if(['AnnualLeave','SickLeave','Training'].includes(shift.type))return res.status(400).json({success:false,message:'Annual leave cannot be offered for coverage'});
    if (shift.status==='Swapped') return res.status(400).json({success:false,message:'Shift already swapped'});
    if(await require('../models/MarketOffer').exists({shift:shift._id,status:{$in:['Open','Matched']}}))return res.status(409).json({success:false,message:'This shift has an active market offer.'});
    const existing = await SwapRequest.findOne({$or:[{requesterShift:shift._id},{acceptorShift:shift._id}],status:{$in:['Open','Proposed','Accepted']}});
    if (existing) return res.status(409).json({success:false,message:'An open request already exists for this shift'});
    const swap = await SwapRequest.create({
      requester:req.user._id, requesterShift:shift._id,
      reason:req.body.reason, availableTimes:req.body.availableTimes,
      urgency:req.body.urgency||'Normal',mode:req.body.mode==='Exchange'?'Exchange':'Coverage'
    });
    shift.status='NeedsCoverage'; await shift.save();
    await User.findByIdAndUpdate(req.user._id,{$inc:{'swapStats.sent':1}});
    const populated = await swap.populate([{path:'requester',select:'name department'},{path:'requesterShift'}]);
    for(const u of await User.find({isActive:true,department:req.user.department,$or:[{role:'manager'},{membership:'approved'}]}))await notify(u._id,'swap_offer','New exchange offer',req.user.name+' offered a shift for exchange. Review available offers.',swap._id);
    res.status(201).json({success:true, swap:populated});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});

router.post('/:id/consent',async(req,res)=>{try{
 const sw=await SwapRequest.findOne({_id:req.params.id,requester:req.user._id,status:'Proposed',mode:'Exchange'});
 if(!sw)return res.status(409).json({success:false,message:'No proposal awaiting your consent.'});
 const a=await Shift.findById(sw.requesterShift),b=await Shift.findById(sw.acceptorShift);
 if(a&&b&&(cairoStart(a)<=new Date()||cairoStart(b)<=new Date()))return res.status(409).json({success:false,message:'A shift has already started.'});
 if(!a||!b||String(a.user)!==String(sw.requester)||String(b.user)!==String(sw.acceptor)||b.status!=='Confirmed')return res.status(409).json({success:false,message:'Shifts changed. Withdraw and start again.'});
 sw.consentSnapshot={a:{date:a.date,startTime:a.startTime,endTime:a.endTime,workMode:a.workMode,department:a.department,type:a.type},b:{date:b.date,startTime:b.startTime,endTime:b.endTime,workMode:b.workMode,department:b.department,type:b.type}};sw.status='Accepted';sw.consentAt=new Date();await sw.save();
 const cfg=await swapPolicy();
 if(!cfg.managerApproval){try{await executeSwap(sw._id,null,'');await notify(sw.requester,'swap_approved','Swap completed ✓','Both sides agreed — the exchange completed automatically and both schedules are updated.',sw._id);await notify(sw.acceptor,'swap_approved','Swap completed ✓','Both sides agreed — the exchange completed automatically and both schedules are updated.',sw._id);return res.json({success:true,auto:true});}catch(_){/* falls back to manager review */}}
 await notify(sw.acceptor,'swap_accepted','Offer approved','The other employee accepted. Waiting for manager approval.',sw._id);
 res.json({success:true});}catch(e){res.status(400).json({success:false,message:e.message});}});

router.post('/:id/accept', async (req, res) => {
  try {
    const swap = await SwapRequest.findById(req.params.id).populate('requester','name');
    if (!swap) return res.status(404).json({success:false,message:'Swap not found'});
    const posted=await Shift.findById(swap.requesterShift);if(req.user.role!=='manager'&&posted?.department!==req.user.department)return res.status(403).json({success:false,message:'This offer belongs to another department.'});
    if (swap.status!=='Open') return res.status(400).json({success:false,message:'Swap not open'});
    if (swap.requester._id.toString()===req.user._id.toString()) return res.status(400).json({success:false,message:"Can't accept your own swap"});
    const source=await Shift.findById(swap.requesterShift);if(!source||cairoStart(source)<=new Date())return res.status(409).json({success:false,message:'Shift has already started or was removed.'});
    if(swap.mode==='Exchange'){
      const offered=await Shift.findOne({_id:req.body.shiftId,user:req.user._id,status:'Confirmed',type:{$nin:['AnnualLeave','SickLeave','Training']}});
      if(offered&&cairoStart(offered)<=new Date())return res.status(400).json({success:false,message:'Choose a future shift.'});
      if(offered&&await require('../models/MarketOffer').exists({shift:offered._id,status:{$in:['Open','Matched']}}))return res.status(409).json({success:false,message:'This shift has an active market offer.'});
      if(!offered) return res.status(400).json({success:false,message:'Choose your own confirmed working shift.'});
      if(await SwapRequest.exists({$or:[{requesterShift:offered._id},{acceptorShift:offered._id}],status:{$in:['Open','Proposed','Accepted']}}))return res.status(409).json({success:false,message:'That shift already has a pending request.'});
      const update=await SwapRequest.updateOne({_id:swap._id,status:'Open'},{$set:{acceptor:req.user._id,acceptorShift:offered._id,status:'Proposed'}});
      if(!update.modifiedCount)return res.status(409).json({success:false,message:'Request changed; refresh.'});
      await notify(swap.requester._id,'swap_proposed','New exchange offer',`${req.user.name} Choose a shift to offer in return. The requester must accept before manager review.`,swap._id);
      return res.json({success:true,message:'Proposal sent. Waiting for requester consent.'});
    }
    const update=await SwapRequest.updateOne({_id:swap._id,status:'Open'},{$set:{acceptor:req.user._id,status:'Accepted'}});
    if(!update.modifiedCount)return res.status(409).json({success:false,message:'Request changed; refresh.'});
    await User.findByIdAndUpdate(req.user._id,{$inc:{'swapStats.received':1}});
    const cfg=await swapPolicy();
    if(!cfg.managerApproval){try{await executeSwap(swap._id,null,'');await notify(swap.requester._id,'swap_approved','Swap completed ✓',`${req.user.name} accepted your swap — completed automatically and both schedules are updated.`,swap._id);await notify(req.user._id,'swap_approved','Swap completed ✓','You accepted the swap — completed automatically and both schedules are updated.',swap._id);return res.json({success:true, swap, auto:true, message:'Completed automatically — schedules updated'});}catch(_){/* falls back to manager review */}}
    await notify(swap.requester._id,'swap_accepted','Swap Request Accepted',
      `${req.user.name} accepted your swap — awaiting manager approval`,swap._id);
    res.json({success:true, swap, message:'Accepted — awaiting manager approval'});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});

router.post('/:id/withdraw', async (req, res) => {
  try {
    const swap = await SwapRequest.findById(req.params.id).populate('requesterShift');
    if (!swap) return res.status(404).json({success:false,message:'Swap not found'});
    if (swap.requester.toString()!==req.user._id.toString()) return res.status(403).json({success:false,message:'Not your swap'});
    if (!['Open','Proposed','Accepted'].includes(swap.status)) return res.status(400).json({success:false,message:"Can't withdraw in current status"});
    swap.status='Withdrawn'; await swap.save();
    if (swap.requesterShift){swap.requesterShift.status='Confirmed';await swap.requesterShift.save();}
    if (swap.acceptor) await notify(swap.acceptor,'swap_withdrawn','Swap Withdrawn',`${req.user.name} withdrew the swap request`,swap._id);
    res.json({success:true, message:'Swap withdrawn'});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});

// Executes an Accepted swap: reassigns the shift(s) inside a transaction. `actor` is the
// approving manager's user doc, or null when the system auto-completes under policy.
async function executeSwap(swapId, actor, note){
    const swap = await SwapRequest.findById(swapId)
      .populate('requesterShift').populate('acceptorShift').populate('requester','name').populate('acceptor','name');
    if (!swap){const e=new Error('Swap not found');e.status=404;throw e;}
    if (swap.status!=='Accepted'){const e=new Error('Swap must be accepted first');e.status=400;throw e;}
    const mongoose = require('mongoose');
    const session = await mongoose.startSession();
    try { await session.withTransaction(async()=>{
      const current = await SwapRequest.findOne({_id:swap._id,status:'Accepted'}).session(session);
      if(!current)throw new Error('Request already reviewed.');
      const target = await User.findOne({_id:swap.acceptor._id,isActive:true,$or:[{role:'manager'},{membership:'approved'}]}).session(session);
      const shift = await Shift.findById(swap.requesterShift._id).session(session);
      if(!target||!shift||String(shift.user)!==String(swap.requester._id))throw new Error('Shift ownership or employee status changed.');
      if(cairoStart(shift)<=new Date())throw new Error('Shift has already started.');
      const beforeShift=shift.toObject();
      const other=current.mode==='Exchange'?await Shift.findById(current.acceptorShift).session(session):null;
      const beforeOther=other?.toObject();
      if(current.mode==='Exchange'&&(!current.consentAt||!other||String(other.user)!==String(target._id)||other.status!=='Confirmed'||['AnnualLeave','SickLeave','Training'].includes(other.type)))throw new Error('Both employees must consent to unchanged shifts.');
      if(other&&cairoStart(other)<=new Date())throw new Error('Counter shift has already started.');
      if(other){const snapshot=current.consentSnapshot;const same=(x,y)=>y&&new Date(x.date).getTime()===new Date(y.date).getTime()&&['startTime','endTime','workMode','department','type'].every(k=>x[k]===y[k]);if(!snapshot||!same(shift,snapshot.a)||!same(other,snapshot.b))throw new Error('Shift details changed since consent. Start a new request so both employees can review.');}
      const excluded=[shift._id,...(other?[other._id]:[])];
      const {overlap}=require('./rosterImport');
      const candidates=await Shift.find({user:target._id,_id:{$nin:excluded}}).session(session);
      if(candidates.some(x=>overlap(x,shift)))throw new Error('Acceptor already has an overlapping shift.');
      if(other){const mine=await Shift.find({user:current.requester,_id:{$nin:excluded}}).session(session);if(mine.some(x=>overlap(x,other)))throw new Error('Requester already has an overlapping shift.');other.user=current.requester;other.status='Confirmed';await other.save({session});}
      shift.user=target._id;shift.status='Confirmed';await shift.save({session});
      await require('../models/ScheduleAudit').create([{actor:actor?actor._id:null,action:other?'two_way_swap_approved':'coverage_approved',resource:String(current._id),before:[beforeShift,...(beforeOther?[beforeOther]:[])],after:[shift.toObject(),...(other?[other.toObject()]:[])]}],{session});
      current.status='Approved';current.reviewedBy=actor?actor._id:null;current.reviewedAt=new Date();current.reviewNote=note||'';
      await current.save({session});
      await User.updateMany({_id:{$in:[swap.requester._id,target._id]}},{$inc:{'swapStats.completed':1}},{session});
    }); } finally { await session.endSession(); }
    swap.status='Approved';
    return swap;
}

router.post('/:id/approve', managerOnly, async (req, res) => {
  try {
    const swap = await executeSwap(req.params.id, req.user, req.body.note);
    const msg=`Manager ${req.user.name} approved the swap ✓`;
    await notify(swap.requester._id,'swap_approved','Swap Approved',msg,swap._id);
    await notify(swap.acceptor._id,'swap_approved','Swap Approved',msg,swap._id);
    res.json({success:true, swap, message:'Approved — both parties notified'});
  } catch(err) { res.status(err.status||500).json({success:false,message:err.message}); }
});

router.post('/:id/reject', managerOnly, async (req, res) => {
  try {
    const swap = await SwapRequest.findById(req.params.id)
      .populate('requesterShift').populate('acceptorShift').populate('requester','name').populate('acceptor','name');
    if (!swap) return res.status(404).json({success:false,message:'Swap not found'});
    if (!['Accepted','Open'].includes(swap.status)) return res.status(400).json({success:false,message:"Can't reject in current status"});
    swap.status='Rejected'; swap.reviewedBy=req.user._id; swap.reviewedAt=new Date(); swap.reviewNote=req.body.note||'';
    await swap.save();
    if (swap.requesterShift){swap.requesterShift.status='Confirmed';await swap.requesterShift.save();}
    const reason=req.body.note?` Reason: ${req.body.note}`:'';
    await notify(swap.requester._id,'swap_rejected','Swap Rejected',`Your swap was rejected.${reason}`,swap._id);
    if (swap.acceptor) await notify(swap.acceptor._id,'swap_rejected','Swap Rejected',`The swap was rejected.${reason}`,swap._id);
    res.json({success:true, message:'Rejected — parties notified'});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});

module.exports = router;
