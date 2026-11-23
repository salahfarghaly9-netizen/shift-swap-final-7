const express=require('express');
const crypto=require('crypto');
const User=require('../models/User');
const Shift=require('../models/Shift');
const {protect}=require('../middleware/auth');
const {cairoStart}=require('../services/notificationService');
const router=express.Router();
const hash=t=>crypto.createHash('sha256').update(t).digest('hex');
const esc=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const stamp=d=>new Date(d).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
function fold(s){const out=[];let line='';for(const ch of s){if(Buffer.byteLength(line+ch)>73){out.push(line);line=' '+ch;}else line+=ch;}out.push(line);return out.join('\r\n');}
function calendar(shifts){const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Nextcare//Personal Shifts//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Nextcare shifts','X-WR-TIMEZONE:Africa/Cairo'];for(const s of shifts){const date=new Date(s.date).toISOString().slice(0,10);const leave=['AnnualLeave','SickLeave','Training'].includes(s.type);lines.push('BEGIN:VEVENT','UID:shift-'+s._id+'@nextcare-shift-swap','DTSTAMP:'+stamp(s.updatedAt||s.createdAt||s.date),'LAST-MODIFIED:'+stamp(s.updatedAt||s.createdAt||s.date),'CLASS:PRIVATE','STATUS:CONFIRMED','SUMMARY:'+esc(leave?({AnnualLeave:'Annual leave',SickLeave:'Sick leave',Training:'Training'}[s.type]):s.type+' shift · '+(s.workMode==='Office'?'Office':s.workMode==='Home'?'Home':'Location unspecified')));if(leave){const end=new Date(date);end.setUTCDate(end.getUTCDate()+1);lines.push('DTSTART;VALUE=DATE:'+date.replace(/-/g,''),'DTEND;VALUE=DATE:'+end.toISOString().slice(0,10).replace(/-/g,''));}else{const start=cairoStart(s);let endDate=new Date(s.date);if(s.endTime<=s.startTime)endDate.setUTCDate(endDate.getUTCDate()+1);const end=cairoStart({date:endDate,startTime:s.endTime});lines.push('DTSTART:'+stamp(start),'DTEND:'+stamp(end),'LOCATION:'+esc(s.workMode==='Office'?'Office':s.workMode==='Home'?'Home':'Unspecified'));}lines.push('DESCRIPTION:'+esc('Read-only schedule. Check the app for recent swaps. Cairo time. '+s.department),'TRANSP:OPAQUE','END:VEVENT');}lines.push('END:VCALENDAR');return lines.map(fold).join('\r\n')+'\r\n';}
router.get('/feed/:token.ics',async(req,res)=>{try{const token=req.params.token;if(!/^[a-f0-9]{64}$/.test(token))return res.sendStatus(404);const user=await User.findOne({calendarTokenHash:hash(token),isActive:true});if(!user||(user.role!=='manager'&&user.membership!=='approved'))return res.sendStatus(404);const shifts=await Shift.find({user:user._id,status:{$ne:'Swapped'}}).sort({date:1,startTime:1});res.set({'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});res.send(calendar(shifts));}catch(e){res.sendStatus(503);}});
router.use(protect);
router.get('/settings',async(req,res)=>{const u=await User.findById(req.user._id).select('+calendarTokenHash');res.json({success:true,enabled:!!u.calendarTokenHash});});
router.post('/enable',async(req,res)=>{const token=crypto.randomBytes(32).toString('hex');await User.updateOne({_id:req.user._id},{$set:{calendarTokenHash:hash(token)}});res.set('Cache-Control','no-store').json({success:true,path:'/api/calendar-feed/feed/'+token+'.ics'});});
router.delete('/enable',async(req,res)=>{await User.updateOne({_id:req.user._id},{$unset:{calendarTokenHash:1}});res.json({success:true});});
module.exports=router;
module.exports.calendar=calendar;
