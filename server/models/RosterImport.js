const mongoose=require('mongoose');
const schema=new mongoose.Schema({manager:{type:mongoose.Schema.Types.ObjectId,ref:'User'},sheet:String,rows:[mongoose.Schema.Types.Mixed],errors:[mongoose.Schema.Types.Mixed],duplicates:Number,off:Number,committedAt:Date,undoneAt:Date,undoneBy:{type:mongoose.Schema.Types.ObjectId,ref:'User'},snapshot:[mongoose.Schema.Types.Mixed],people:{type:mongoose.Schema.Types.Mixed,default:{}},createdAt:{type:Date,default:Date.now},expiresAt:{type:Date,default:()=>new Date(Date.now()+86400000)}});
schema.index({expiresAt:1},{expireAfterSeconds:0});
module.exports=mongoose.model('RosterImport',schema);
