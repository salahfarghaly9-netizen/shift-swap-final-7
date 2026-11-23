const Notification=require('../models/Notification');
const User=require('../models/User');
const Shift=require('../models/Shift');
const Setting=require('../models/AppSetting');
const webpush=require('web-push');
let keys;
async function pushKeys(){if(keys)return keys;let s=await Setting.findOne({key:'vapid'});if(!s){try{s=await Setting.create({key:'vapid',value:webpush.generateVAPIDKeys()});}catch(e){if(e.code!==11000)throw e;s=await Setting.findOne({key:'vapid'});}}keys=s.value;webpush.setVapidDetails('mailto:salahfarghaly9@gmail.com',keys.publicKey,keys.privateKey);return keys;}
async function push(userId,title,message,ttl=3600){try{await pushKeys();const u=await User.findById(userId).select('+pushSubscriptions');for(const sub of u?.pushSubscriptions||[]){try{await webpush.sendNotification(sub,JSON.stringify({title,body:message,url:'/'}),{TTL:ttl});}catch(e){if([404,410].includes(e.statusCode))await User.updateOne({_id:userId},{$pull:{pushSubscriptions:{endpoint:sub.endpoint}}});}}}catch(e){console.warn('Push delivery unavailable:',e.message);}}
async function notify(user,type,title,message,relatedSwap,session,key,ttl){
 const data={user,type,title,message,relatedSwap:relatedSwap||null};if(key)data.deliveryKey=key;
 let n;try{[n]=await Notification.create([data],session?{session}:{});}catch(e){if(e.code===11000)return null;throw e;}
 if(!session)await push(user,title,message,ttl);return n;
}
function cairoStart(s){
 const [y,m,d]=new Date(s.date).toISOString().slice(0,10).split('-').map(Number),[h,min]=s.startTime.split(':').map(Number);
 let start=new Date(Date.UTC(y,m-1,d,h,min));for(let i=0;i<2;i++){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(start).map(p=>[p.type,p.value]));const wall=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute);start=new Date(start.getTime()+Date.UTC(y,m-1,d,h,min)-wall);}
return start;
}
async function reminders(now=new Date()){
 const users=await User.find({isActive:true,reminderMinutes:{$in:[15,30,60,120]}});
 let sent=0;
 for(const u of users){const shifts=await Shift.find({user:u._id,type:{$ne:'AnnualLeave'},date:{$gte:new Date(now.getTime()-86400000),$lte:new Date(now.getTime()+172800000)}});
 for(const s of shifts){
 // Roster dates/times are Cairo wall-clock values, including DST.
 const start=cairoStart(s);
 const delta=start-now;if(delta<=0||delta>u.reminderMinutes*60000)continue;
 const key='shift:'+s._id+':'+start.toISOString()+':'+u._id;
 const n=await notify(u._id,'shift_reminder','Shift reminder',`Your shift ${s.startTime} - ${s.endTime} Cairo time. ${s.workMode==='Office'?'In the office':s.workMode==='Home'?'At home':''}`,null,null,key);if(n)sent++;
 }}return sent;
}
function startReminders(){const tick=()=>Promise.all([reminders(),require('./breakReminders').breakReminders()]).catch(e=>console.warn('Reminder check:',e.message));tick();const t=setInterval(tick,60000);t.unref();}
module.exports={cairoStart,notify,push,pushKeys,reminders,startReminders};
