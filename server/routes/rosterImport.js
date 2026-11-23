const express=require('express');
const multer=require('multer');
const ExcelJS=require('exceljs');
const mongoose=require('mongoose');
const User=require('../models/User');
const Shift=require('../models/Shift');
const RosterImport=require('../models/RosterImport');
const Audit=require('../models/ScheduleAudit');
const Mapping=require('../models/OfficerMapping');
const Swap=require('../models/SwapRequest');
const {notify,push}=require('../services/notificationService');
const {parse}=require('../services/rosterParser');
const {protect,managerOnly}=require('../middleware/auth');
const router=express.Router();router.use(protect,managerOnly);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1}});
function interval(s){const a=new Date(s.date).getTime()+minutes(s.startTime)*60000;let b=new Date(s.date).getTime()+minutes(s.endTime)*60000;if(b<=a)b+=86400000;return [a,b];}
function minutes(t){const [h,m]=t.split(':').map(Number);return h*60+m;}
function overlap(a,b){const [s,e]=interval(a),[x,y]=interval(b);return s<y&&x<e;}
async function validate(rows,session){
 const users=await User.find({email:{$in:[...new Set(rows.map(r=>r.email))]},isActive:true}).session(session||null);
 const byEmail=new Map(users.map(u=>[u.email,u]));const errors=[],ready=[];let duplicates=0;
 const existing=await Shift.find({user:{$in:users.map(u=>u._id)}}).session(session||null);
 for(const r of rows){const u=byEmail.get(r.email);if(!u){errors.push({row:r.row,message:`No active account for ${r.email}. Register first.`});continue;}
 const item={...r,user:u._id,department:r.department||u.department};const same=existing.concat(ready).filter(s=>String(s.user)===String(u._id));
 const exact=same.find(s=>new Date(s.date).toISOString().slice(0,10)===r.date&&s.startTime===r.startTime&&s.endTime===r.endTime);
 if(exact){if(exact.type!==item.type||exact.department!==item.department||exact.workMode!==item.workMode)errors.push({row:r.row,message:`Existing shift has different details for ${r.email} on ${r.date}. No overwrite allowed.`});else duplicates++;continue;}
 if(same.some(s=>overlap(s,item))){errors.push({row:r.row,message:`Overlapping shift for ${r.email} on ${r.date}. No overwrite allowed.`});continue;}
 ready.push(item);
 }
 return {rows:ready,errors,duplicates};
}
router.get('/mappings',async(req,res,next)=>{try{res.json({success:true,mappings:await Mapping.find().select('officer email reviewedBy updatedAt').lean()});}catch(e){next(e);}});
router.delete('/mappings/:id',async(req,res,next)=>{try{await Mapping.deleteOne({_id:req.params.id});res.json({success:true});}catch(e){next(e);}});
router.get('/audit',async(req,res,next)=>{try{res.json({success:true,events:await Audit.find().populate('actor','name').sort({createdAt:-1}).limit(100).lean()});}catch(e){next(e);}});
router.get('/history',async(req,res,next)=>{try{res.json({success:true,batches:await RosterImport.find({committedAt:{$ne:null}}).select('manager sheet committedAt undoneAt undoneBy snapshot').populate('manager','name').populate('undoneBy','name').sort({committedAt:-1}).limit(50).lean()});}catch(e){next(e);}});
router.get('/template',async(req,res,next)=>{try{
 const wb=new ExcelJS.Workbook();const a=wb.addWorksheet('Shifts');a.addRow(['Email','Date','Start','End','Type','Department']);a.addRow(['employee@example.com','2026-12-01','08:00','16:00','Morning','Example team']);
 const b=wb.addWorksheet('Roster');b.addRow(['Email','Name','2026-12-01','2026-12-02','2026-12-03']);b.addRow(['employee@example.com','Example employee','08:00-16:00','OFF','16:00-00:00']);
 const c=wb.addWorksheet('Instructions');[['Use ONE schedule sheet per upload. Choose Shifts OR Roster.'],['Replace sample emails with the exact emails of registered team accounts.'],['Dates: YYYY-MM-DD or real Excel date cells. Times: 24-hour HH:mm.'],['Roster cells: HH:mm-HH:mm, OFF, leave, or a code mapped in the import screen.'],['Blank roster cells and OFF are skipped; existing shifts are never deleted or overwritten.'],['Preview first. Errors block the entire import. Matching existing shifts are skipped.'],['Night shifts belong to their START date and end on the next day.'],['This example contains fictional data only.']].forEach(r=>c.addRow(r));
 wb.worksheets.forEach(s=>{s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0F766E'}};s.columns.forEach(x=>x.width=s===c?105:25);});
 res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.set('Content-Disposition','attachment; filename="team-roster-template.xlsx"');res.send(Buffer.from(await wb.xlsx.writeBuffer()));
 }catch(e){next(e);}});
router.post('/preview',upload.single('file'),async(req,res)=>{try{
 if(!req.file||!req.file.originalname.toLowerCase().endsWith('.xlsx'))return res.status(400).json({success:false,message:'Upload an .xlsx file, up to 2 MB. Save older .xls files as .xlsx first.'});
 let mappings={},people={};try{mappings=JSON.parse(req.body.mappings||'{}');people=JSON.parse(req.body.people||'{}');}catch{throw new Error('Invalid code mapping.');}
 const saved=await Mapping.find().lean();people={...Object.fromEntries(saved.map(x=>[x.officer,x.email])),...people};
 const p=await parse(req.file.buffer,req.body.sheet,mappings,people,req.body.workMode||'Auto');const v=await validate(p.rows);const errors=p.errors.concat(v.errors,p.unmatched.map(n=>({row:'-',message:`Map Officer to an account: ${n}`})));
 if(!p.rows.length&&!errors.length)errors.push({row:1,message:'No working shifts found.'});
 const doc=await RosterImport.create({manager:req.user._id,sheet:p.sheet,rows:p.rows.map((r,i)=>({...r,sourceIndex:i})),people,errors,duplicates:v.duplicates,off:p.off});
 res.json({success:true,importId:doc._id,people:p.people,unmatched:p.unmatched,sheets:p.sheets,sheet:p.sheet,format:p.format,ready:v.rows.length,duplicates:v.duplicates,off:p.off,errors,preview:v.rows.map(r=>({...r,sourceIndex:p.rows.findIndex(x=>x.row===r.row&&x.date===r.date&&x.startTime===r.startTime&&x.email===r.email) ,user:undefined}))});
 }catch(e){res.status(400).json({success:false,message:e.message});}});
router.post('/:id/commit',async(req,res)=>{
 const session=await mongoose.startSession();let count=0,duplicates=0;
 try{await session.withTransaction(async()=>{
 const doc=await RosterImport.findOne({_id:req.params.id,manager:req.user._id}).session(session);
 if(!doc)throw new Error('Preview expired or not found. Upload again.');
 if(doc.committedAt)throw new Error('This preview was already imported.');
 if(doc.errors.length)throw new Error('Fix all preview errors before importing.');
 const overrides=req.body.modes||{};doc.rows.forEach((r,i)=>{if(overrides[i]&&['Office','Home','Unspecified'].includes(overrides[i]))r.workMode=overrides[i];});
 const v=await validate(doc.rows,session);if(v.errors.length)throw new Error('Schedule changed or conflicts found. Upload again for a fresh preview.');
 let inserted=[];if(v.rows.length)inserted=await Shift.insertMany(v.rows.map(r=>({user:r.user,date:r.date,startTime:r.startTime,endTime:r.endTime,type:r.type,workMode:r.workMode,department:r.department,importBatch:doc._id,notes:'Imported from Excel'})),{session});
 doc.snapshot=inserted.map(s=>({_id:s._id,user:s.user,date:s.date,startTime:s.startTime,endTime:s.endTime,type:s.type,department:s.department,workMode:s.workMode,status:s.status,updatedAt:s.updatedAt}));
 for(const [officer,email] of Object.entries(doc.people||{})){if(!officer.trim()||!email)continue;const exists=await User.exists({email,isActive:true}).session(session);if(exists)await Mapping.updateOne({officer},{$set:{email,reviewedBy:req.user._id}},{upsert:true,session});}
 for(const uid of [...new Set(inserted.map(s=>String(s.user)))])await notify(uid,'schedule_published','جدول جديد','اتضافت مواعيد جديدة لجدولك. افتح جدولي الأسبوعي للمراجعة.',null,session);
 await Audit.create([{actor:req.user._id,action:'roster_published',resource:String(doc._id),after:doc.snapshot}],{session});
 count=v.rows.length;duplicates=v.duplicates;doc.expiresAt=null;doc.committedAt=new Date();await doc.save({session});
 });const saved=await RosterImport.findById(req.params.id);for(const uid of [...new Set((saved.snapshot||[]).map(s=>String(s.user)))])push(uid,'جدول جديد','اتضافت مواعيد جديدة لجدولك.');res.json({success:true,created:count,duplicates});}
 catch(e){res.status(409).json({success:false,message:e.message});}finally{await session.endSession();}
});
router.post('/:id/undo',async(req,res)=>{
 const session=await mongoose.startSession();let removed=0;
 try{await session.withTransaction(async()=>{
 const doc=await RosterImport.findById(req.params.id).session(session);
 if(!doc?.committedAt||doc.undoneAt)throw new Error('Batch not found or already undone.');
 const shifts=await Shift.find({importBatch:doc._id}).session(session);
 if(shifts.length!==doc.snapshot.length)throw new Error('Some shifts were removed or changed. Undo is blocked; review individually.');
 for(const snap of doc.snapshot){const s=shifts.find(x=>String(x._id)===String(snap._id));if(!s||new Date(s.updatedAt).getTime()!==new Date(snap.updatedAt).getTime()||String(s.user)!==String(snap.user))throw new Error('A shift changed after import. Undo is blocked to protect later changes.');}
 if(await Swap.exists({$or:[{requesterShift:{$in:shifts.map(s=>s._id)}},{acceptorShift:{$in:shifts.map(s=>s._id)}}]}).session(session))throw new Error('This batch has swap activity. Undo is blocked to protect that history.');
 if(shifts.some(s=>interval(s)[0]<=Date.now()))throw new Error('A shift in this batch has started or passed. Undo is blocked.');
 await Audit.create([{actor:req.user._id,action:'roster_undone',resource:String(doc._id),before:doc.snapshot}],{session});
 await Shift.deleteMany({importBatch:doc._id}).session(session);removed=shifts.length;doc.undoneAt=new Date();doc.undoneBy=req.user._id;await doc.save({session});
 for(const uid of [...new Set(shifts.map(s=>String(s.user)))])await notify(uid,'schedule_undone','تم سحب جدول','المدير تراجع عن رفعة جدول. راجع مواعيدك الحالية.',null,session);
 });res.json({success:true,removed});}catch(e){res.status(409).json({success:false,message:e.message});}finally{await session.endSession();}
});
module.exports=router;
module.exports.overlap=overlap;
