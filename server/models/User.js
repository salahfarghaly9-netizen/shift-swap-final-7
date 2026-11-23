const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const userSchema = new mongoose.Schema({
  name:       { type:String, required:true, trim:true },
  email:      { type:String, required:true, unique:true, lowercase:true },
  password:   { type:String, required:true, minlength:6, select:false },
  role:       { type:String, enum:['employee','manager'], default:'employee' },
  department: { type:String, required:true },
  membership:{type:String,enum:['pending','approved','rejected'],default:'pending'},
  approvedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User'},approvedAt:Date,
  isActive:   { type:Boolean, default:true },
  calendarTokenHash:{type:String,select:false,index:true},
  reminderMinutes:{type:Number,enum:[0,15,30,60,120],default:0},
  pushSubscriptions:{type:[mongoose.Schema.Types.Mixed],default:[],select:false},
  swapStats:  { sent:{type:Number,default:0}, received:{type:Number,default:0}, completed:{type:Number,default:0} }
}, { timestamps:true });
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12); next();
});
userSchema.methods.comparePassword = function(c) { return bcrypt.compare(c, this.password); };
userSchema.methods.toSafeObject = function() { const o=this.toObject(); delete o.password; delete o.calendarTokenHash; delete o.pushSubscriptions; return o; };
module.exports = mongoose.model('User', userSchema);
