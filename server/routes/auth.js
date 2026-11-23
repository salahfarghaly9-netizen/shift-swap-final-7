const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const router = express.Router();
const sign = id => jwt.sign({id}, process.env.JWT_SECRET, {expiresIn:'7d'});

router.post('/register', [
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({min:6}),
  body('department').notEmpty(),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({success:false, errors:errs.array()});
  try {
    const {name,email,password,department,role,managerCode} = req.body;
    if (await User.findOne({email})) return res.status(409).json({success:false,message:'Email already registered'});
    // All public registrations require an existing manager's approval.
    if(role==='manager'||managerCode)return res.status(403).json({success:false,message:'Manager accounts can only be granted by an existing manager.'});
    await User.create({name,email,password,department,role:'employee',membership:'pending'});
    res.status(201).json({success:true,pending:true,message:'Registration received. Your manager must approve your account before you can sign in.'});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({success:false, errors:errs.array()});
  try {
    const {email,password} = req.body;
    const user = await User.findOne({email}).select('+password');
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({success:false,message:'Invalid email or password'});
    if(user.role!=='manager'&&user.membership!=='approved')return res.status(403).json({success:false,message:'Your account is awaiting manager approval.'});
    if (!user.isActive) return res.status(403).json({success:false,message:'Account inactive'});
    res.json({success:true, token:sign(user._id), user:user.toSafeObject()});
  } catch(err) { res.status(500).json({success:false,message:err.message}); }
});

router.get('/me', protect, (req, res) => res.json({success:true, user:req.user}));
module.exports = router;
