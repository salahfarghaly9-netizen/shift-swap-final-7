const mongoose=require('mongoose');
const schema=new mongoose.Schema({manager:{type:mongoose.Schema.Types.ObjectId,ref:'User'},sheet:String,rows:[mongoose.Schema.Types.Mixed],errors:[mongoose.Schema.Types.Mixed],duplicates:Number,off:Number,committedAt:Date,createdAt:{type:Date,default:Date.now,expires:86400}});
module.exports=mongoose.model('RosterImport',schema);
