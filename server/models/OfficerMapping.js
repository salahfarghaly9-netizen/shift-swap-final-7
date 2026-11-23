const mongoose=require('mongoose');
const schema=new mongoose.Schema({officer:{type:String,required:true,unique:true},email:{type:String,required:true},reviewedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User'}},{timestamps:true});
module.exports=mongoose.model('OfficerMapping',schema);
