const mongoose=require('mongoose');
const schema=new mongoose.Schema({actor:{type:mongoose.Schema.Types.ObjectId,ref:'User'},action:String,resource:String,before:mongoose.Schema.Types.Mixed,after:mongoose.Schema.Types.Mixed},{timestamps:true});
module.exports=mongoose.model('ScheduleAudit',schema);
