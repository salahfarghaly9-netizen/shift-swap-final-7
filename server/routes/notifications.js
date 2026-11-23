const express = require('express');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const router = express.Router();
router.use(protect);
router.get('/settings',async(req,res)=>res.json({success:true,reminderMinutes:req.user.reminderMinutes||0,pushEnabled:(await require('../models/User').findById(req.user._id).select('+pushSubscriptions')).pushSubscriptions.length>0,timezone:'Africa/Cairo'}));
router.put('/settings',async(req,res)=>{if(![0,15,30,60,120].includes(req.body.reminderMinutes))return res.status(400).json({success:false,message:'Choose a valid reminder time'});await require('../models/User').updateOne({_id:req.user._id},{reminderMinutes:req.body.reminderMinutes});res.json({success:true});});
router.get('/push-key',async(req,res,next)=>{try{res.json({success:true,publicKey:(await require('../services/notificationService').pushKeys()).publicKey});}catch(e){next(e);}});
router.post('/push',async(req,res)=>{try{const sub=req.body.subscription;const url=new URL(sub?.endpoint);if(url.protocol!=='https:'||!['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','wns.windows.com'].some(d=>url.hostname===d||url.hostname.endsWith('.'+d))||!sub.keys?.p256dh||!sub.keys?.auth)throw new Error('Unsupported push subscription');const U=require('../models/User');await U.updateOne({_id:req.user._id},{$pull:{pushSubscriptions:{endpoint:sub.endpoint}}});await U.updateOne({_id:req.user._id},{$push:{pushSubscriptions:{$each:[sub],$slice:-5}}});res.json({success:true});}catch(e){res.status(400).json({success:false,message:e.message});}});
router.delete('/push',async(req,res)=>{await require('../models/User').updateOne({_id:req.user._id},{$pull:{pushSubscriptions:{endpoint:req.body.endpoint}}});res.json({success:true});});

router.get('/', async (req, res) => {
  try {
    const filter = {user:req.user._id};
    if (req.query.unread==='true') filter.isRead=false;
    const [notifications,unreadCount] = await Promise.all([
      Notification.find(filter).sort({createdAt:-1}).limit(50),
      Notification.countDocuments({user:req.user._id,isRead:false})
    ]);
    res.json({success:true, notifications, unreadCount});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});
router.patch('/read-all', async (req, res) => {
  try {
    await Notification.updateMany({user:req.user._id,isRead:false},{isRead:true});
    res.json({success:true, message:'All marked as read'});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});
router.patch('/:id/read', async (req, res) => {
  try {
    await Notification.findOneAndUpdate({_id:req.params.id,user:req.user._id},{isRead:true});
    res.json({success:true});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});
module.exports = router;
