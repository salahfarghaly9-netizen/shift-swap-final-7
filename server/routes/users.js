const express = require('express');
const User = require('../models/User');
const { protect, managerOnly } = require('../middleware/auth');
const router = express.Router();
router.use(protect);
router.get('/', async (req, res) => {
  try {
    const filter = {isActive:true};
    if (req.query.department) filter.department = req.query.department;
    if (req.query.role) filter.role = req.query.role;
    const users = await User.find(filter).sort({name:1}).limit(200);
    res.json({success:true, count:users.length, users});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({success:false,message:'User not found'});
    res.json({success:true, user});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});
router.patch('/:id', managerOnly, async (req, res) => {
  try {
    const allowed = ['name','department','role','isActive'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k]!==undefined) updates[k]=req.body[k]; });
    const user = await User.findByIdAndUpdate(req.params.id, updates, {new:true,runValidators:true});
    if (!user) return res.status(404).json({success:false,message:'User not found'});
    res.json({success:true, user});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});
module.exports = router;
