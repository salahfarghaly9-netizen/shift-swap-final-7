const express = require('express');
const User = require('../models/User');
const { protect, managerOnly } = require('../middleware/auth');
const router = express.Router();
router.use(protect);
router.get('/', async (req, res) => {
  try {
    if(req.user.role!=='manager')return res.status(403).json({success:false,message:'Staff directory is restricted to managers.'});
    const filter = {};
    if (req.query.department) filter.department = req.query.department;
    if (req.query.role) filter.role = req.query.role;
    const users = await User.find(filter).sort({name:1}).limit(200);
    res.json({success:true, count:users.length, users});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});
router.get('/:id', async (req, res) => {
  try {
    if(req.user.role!=='manager'&&req.params.id!==String(req.user._id))return res.status(403).json({success:false,message:'You can only read your own profile.'});
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({success:false,message:'User not found'});
    res.json({success:true, user});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});
router.patch('/:id', managerOnly, async (req, res) => {
  try {
    if(req.params.id===String(req.user._id)&&(req.body.role==='employee'||req.body.isActive===false||req.body.membership&&req.body.membership!=='approved'))return res.status(400).json({success:false,message:'You cannot remove your own manager access.'});
    if(req.body.role==='manager'){const candidate=await User.findById(req.params.id);if(candidate?.membership!=='approved')return res.status(400).json({success:false,message:'Approve membership before granting manager access.'});}
    const allowed = ['name','department','role','isActive','membership'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k]!==undefined) updates[k]=req.body[k]; });
    if(updates.membership==='approved'){updates.approvedBy=req.user._id;updates.approvedAt=new Date();}if(updates.membership&&updates.membership!=='approved')updates.calendarTokenHash=null;
    const user = await User.findByIdAndUpdate(req.params.id, updates, {new:true,runValidators:true});
    if (!user) return res.status(404).json({success:false,message:'User not found'});
    res.json({success:true, user});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});
// Manager can set a new password for a team member (they share it in person).
router.post('/:id/reset-password', managerOnly, async (req, res) => {
  try {
    const pw = String(req.body.password||'');
    if (pw.length < 6) return res.status(400).json({success:false,message:'Password must be at least 6 characters'});
    const user = await User.findById(req.params.id).select('+password');
    if (!user) return res.status(404).json({success:false,message:'User not found'});
    user.password = pw;
    await user.save();
    res.json({success:true, message:'Password updated'});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});
module.exports = router;
