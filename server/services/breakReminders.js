const Session=require('../models/BreakSession');
async function breakReminders(now=new Date()){
 const {notify}=require('./notificationService');let sent=0;
 await Session.updateMany({active:true,endsAt:{$lte:now}},{$set:{active:false}});
 for(const [field,minutes,type,title,body] of [
 ['nextStand','standMinutes','break_stand','Time to stand and move',s=>`If suitable, take ${s.breakMinutes} minutes to stand or move gently. Choose a seated movement if standing is not suitable.`],
 ['nextEye',null,'break_eye','Eye rest 20-20-20',()=> 'Look away from the screen at something at least 20 feet (about 6 metres) away for 20 seconds.'],
 ['nextWater','waterMinutes','break_water','Water reminder',()=> 'If suitable, have some water. Follow any medical fluid restrictions.']]){
 const rows=await Session.find({active:true,endsAt:{$gt:now},[field]:{$lte:now,$ne:null}});
 for(const s of rows){const u=await require('../models/User').findById(s.user);if(!u?.isActive)continue;
 const due=s[field];const claimed=await Session.findOneAndUpdate({_id:s._id,active:true,endsAt:{$gt:now},[field]:due},{$set:{[field]:new Date(now.getTime()+(minutes?s[minutes]:20)*60000)}},{new:true});if(!claimed)continue;
 const n=await notify(s.user,type,title,body(s),null,null,`break:${s._id}:${field}:${due.getTime()}`,120);if(n)sent++;
 }}return sent;
}
module.exports={breakReminders};
