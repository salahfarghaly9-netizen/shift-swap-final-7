const Session=require('../models/BreakSession');
async function breakReminders(now=new Date()){
 const {notify}=require('./notificationService');let sent=0;
 await Session.updateMany({active:true,endsAt:{$lte:now}},{$set:{active:false}});
 for(const [field,minutes,type,title,body] of [
 ['nextStand','standMinutes','break_stand','وقت تقوم وتتحرك',s=>`لو مناسب لك، خد ${s.breakMinutes} دقايق للوقوف أو حركة خفيفة. لو مش قادر تقوم اختار تمرين وانت قاعد.`],
 ['nextEye',null,'break_eye','راحة للعين 20-20-20',()=> 'بص بعيد عن الشاشة لمسافة 20 قدم (حوالي 6 متر) لمدة 20 ثانية.'],
 ['nextWater','waterMinutes','break_water','تذكير بالمياه',()=> 'لو مناسب لك، خد شوية مياه. اتبع أي تعليمات طبية خاصة بالسوائل.']]){
 const rows=await Session.find({active:true,endsAt:{$gt:now},[field]:{$lte:now,$ne:null}});
 for(const s of rows){const u=await require('../models/User').findById(s.user);if(!u?.isActive)continue;
 const due=s[field];const claimed=await Session.findOneAndUpdate({_id:s._id,active:true,endsAt:{$gt:now},[field]:due},{$set:{[field]:new Date(now.getTime()+(minutes?s[minutes]:20)*60000)}},{new:true});if(!claimed)continue;
 const n=await notify(s.user,type,title,body(s),null,null,`break:${s._id}:${field}:${due.getTime()}`,120);if(n)sent++;
 }}return sent;
}
module.exports={breakReminders};
