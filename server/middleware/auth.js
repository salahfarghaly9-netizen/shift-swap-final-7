const jwt = require('jsonwebtoken');
const User = require('../models/User');
const protect = async (req, res, next) => {
  try {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return res.status(401).json({success:false,message:'Not authorised'});
    const decoded = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) return res.status(401).json({success:false,message:'User not found'});
    if(user.role!=='manager'&&user.membership!=='approved')return res.status(403).json({success:false,message:'Your account is awaiting manager approval.'});
    req.user = user; next();
  } catch { res.status(401).json({success:false,message:'Invalid or expired token'}); }
};
const managerOnly = (req, res, next) => {
  if (req.user?.role !== 'manager') return res.status(403).json({success:false,message:'Manager access only'});
  next();
};
module.exports = { protect, managerOnly };
