const mongoose=require('mongoose');
const schema=new mongoose.Schema({owner:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},shift:{type:mongoose.Schema.Types.ObjectId,ref:'Shift',required:true},department:String,start:Number,end:Number,wantStart:Number,wantEnd:Number,autoConsent:{type:Boolean,default:false},snapshot:mongoose.Schema.Types.Mixed,status:{type:String,enum:['Open','Matched','Approved','Withdrawn','Rejected'],default:'Open'},partner:{type:mongoose.Schema.Types.ObjectId,ref:'MarketOffer'},reviewedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User'},reviewedAt:Date},{timestamps:true});
schema.index({status:1,department:1});
module.exports=mongoose.model('MarketOffer',schema);
