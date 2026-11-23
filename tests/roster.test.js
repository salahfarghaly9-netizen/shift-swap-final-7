const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');const {MongoMemoryReplSet}=require('mongodb-memory-server');const mongoose=require('mongoose');const request=require('supertest');const jwt=require('jsonwebtoken');
(async()=>{
 const db=await MongoMemoryReplSet.create({replSet:{count:1}});process.env.MONGODB_URI=db.getUri();process.env.JWT_SECRET=require('crypto').randomBytes(32).toString('hex');process.env.NODE_ENV='test';
 const app=require('../server/index');await mongoose.connection.asPromise();const User=require('../server/models/User'),Shift=require('../server/models/Shift');
 const users=await User.create(['Manager Example','Employee Alpha','Employee Beta'].map((name,i)=>({name,email:['manager','alpha','beta'][i]+'@example.com',password:require('crypto').randomBytes(24).toString('hex'),department:'Example team',role:i?'employee':'manager'})));
 const tokens=users.map(u=>jwt.sign({id:u._id},process.env.JWT_SECRET));const auth=i=>({Authorization:'Bearer '+tokens[i]});
 async function book(rows,sheet='Roster'){const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet(sheet);rows.forEach(r=>ws.addRow(r));return Buffer.from(await wb.xlsx.writeBuffer());}
 async function preview(buffer,people={},mappings={}){return request(app).post('/api/imports/preview').set(auth(0)).field('people',JSON.stringify(people)).field('mappings',JSON.stringify(mappings)).attach('file',buffer,'test.xlsx');}
 const fixture=await book([['Officer','22-11-2026','23-11-2026','24-11-2026','25-11-2026'],['','Sunday','Monday','Tuesday','Wednesday'],['Example A','17:00-0:00','9:00-14:00/17:00-22:00','AN','OFF'],['Example B','8:00-16:00','OFF','16:00-2:00','OFF']]);
 const colorBook=new ExcelJS.Workbook();await colorBook.xlsx.load(fixture);colorBook.worksheets[0].getCell('C3').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFC000'}};const colored=Buffer.from(await colorBook.xlsx.writeBuffer());const parsed=await require('../server/services/rosterParser').parse(colored,'Roster',{}, {'Example A':'alpha@example.com','Example B':'beta@example.com'});assert.equal(parsed.rows.find(r=>r.date==='2026-11-23').workMode,'Office');assert.equal(parsed.rows.find(r=>r.type==='AnnualLeave').type,'AnnualLeave');
 let p=await preview(fixture);assert.equal(p.status,200);assert.equal(p.body.unmatched.length,2);assert.equal(await Shift.countDocuments(),0);
 p=await preview(fixture,{'Example A':'alpha@example.com','Example B':'beta@example.com'});assert.equal(p.body.errors.length,0);
 p=await preview(fixture,{'Example A':'alpha@example.com','Example B':'beta@example.com'},{AN:{skip:true}});assert.deepEqual(p.body.errors,[]);assert.equal(p.body.ready,6);
 let c=await request(app).post('/api/imports/'+p.body.importId+'/commit').set(auth(0));assert.equal(c.status,200,JSON.stringify(c.body));assert.equal(c.body.created,6);assert.equal((await request(app).post('/api/imports/'+p.body.importId+'/commit').set(auth(0))).status,409);
 p=await preview(fixture,{'Example A':'alpha@example.com','Example B':'beta@example.com'},{AN:{skip:true}});assert.equal(p.body.ready,0);assert.equal(p.body.duplicates,6);
 const own=await request(app).get('/api/shifts/my?week=2026-11-22').set(auth(1));assert.equal(own.body.shifts.length,4);assert.equal(new Date(own.body.weekStart).toISOString().slice(0,10),'2026-11-22');
 assert.equal((await request(app).get('/api/shifts/my?week=2026-11-29').set(auth(1))).body.shifts.length,0);
 assert.equal((await request(app).post('/api/imports/preview').set(auth(1))).status,403);
 const conflict=await book([['Email','Date','Start','End'],['alpha@example.com','2026-11-23','13:00','18:00']],'Shifts');p=await preview(conflict);assert.equal(p.body.errors.length,1);
 const overnight=await book([['Email','Date','Start','End'],['beta@example.com','2026-11-25','01:00','05:00']],'Shifts');p=await preview(overnight);assert.equal(p.body.errors.length,1);
 const formula=await book([['Email','Date','Start','End'],['alpha@example.com','2026-12-01',{formula:'1+1'},'16:00']],'Shifts');p=await preview(formula);assert.ok(p.body.errors.length);
 const unknown=await book([['Email','Date','Start','End'],['missing@example.com','2026-12-01','08:00','16:00']],'Shifts');p=await preview(unknown);assert.ok(p.body.errors.length);
 const shift=await Shift.create({user:users[1]._id,date:'2027-01-10',startTime:'08:00',endTime:'12:00',type:'Morning',department:'Example team'});let sw=await request(app).post('/api/swaps').set(auth(1)).send({shiftId:shift._id});assert.equal(sw.status,201);assert.equal((await request(app).post('/api/swaps/'+sw.body.swap._id+'/accept').set(auth(2))).status,200);
 let approved=await request(app).post('/api/swaps/'+sw.body.swap._id+'/approve').set(auth(0));assert.equal(approved.status,200,JSON.stringify(approved.body));assert.equal(String((await Shift.findById(shift._id)).user),String(users[2]._id));assert.equal((await request(app).get('/api/shifts/my?week=2026-11-22').set(auth(1))).body.shifts.length,4);
 assert.equal((await request(app).get('/api/shifts/my?week=2026-11-22').set(auth(2))).body.shifts.length,2);
 const tmpl=await request(app).get('/api/imports/template').set(auth(0));assert.equal(tmpl.status,200);
 // New workflow tests, future fictional dates only.
 const exchangeA=await Shift.create({user:users[1]._id,date:'2027-02-01',startTime:'08:00',endTime:'12:00',type:'Morning',department:'Example team'});
 const exchangeB=await Shift.create({user:users[2]._id,date:'2027-02-02',startTime:'12:00',endTime:'16:00',type:'Afternoon',department:'Example team'});
 let ex=await request(app).post('/api/swaps').set(auth(1)).send({shiftId:exchangeA._id,mode:'Exchange'});assert.equal(ex.status,201);
 assert.equal((await request(app).post('/api/swaps/'+ex.body.swap._id+'/accept').set(auth(2)).send({shiftId:exchangeA._id})).status,400);
 assert.equal((await request(app).post('/api/swaps/'+ex.body.swap._id+'/accept').set(auth(2)).send({shiftId:exchangeB._id})).status,200);
 assert.equal((await request(app).post('/api/swaps/'+ex.body.swap._id+'/approve').set(auth(0))).status,400);
 assert.equal((await request(app).post('/api/swaps/'+ex.body.swap._id+'/consent').set(auth(2))).status,409);
 assert.equal((await request(app).post('/api/swaps/'+ex.body.swap._id+'/consent').set(auth(1))).status,200);
 let result=await request(app).post('/api/swaps/'+ex.body.swap._id+'/approve').set(auth(0));assert.equal(result.status,200,JSON.stringify(result.body));
 assert.equal(String((await Shift.findById(exchangeA._id)).user),String(users[2]._id));assert.equal(String((await Shift.findById(exchangeB._id)).user),String(users[1]._id));
 const future=await book([['Officer','01-03-2027'],['Example saved','08:00-16:00']]);
 p=await preview(future,{'Example saved':'alpha@example.com'});c=await request(app).post('/api/imports/'+p.body.importId+'/commit').set(auth(0)).send({});assert.equal(c.status,200,JSON.stringify(c.body));
 const batchId=p.body.importId;const Roster=require('../server/models/RosterImport');assert.equal((await Roster.findById(batchId)).expiresAt,null);
 assert.equal((await request(app).get('/api/imports/mappings').set(auth(0))).body.mappings.find(m=>m.officer==='Example saved').email,'alpha@example.com');
 const repeat=await preview(future);assert.equal(repeat.body.unmatched.length,0);assert.equal(repeat.body.duplicates,1);
 const undo=await request(app).post('/api/imports/'+batchId+'/undo').set(auth(0));assert.equal(undo.status,200,JSON.stringify(undo.body));assert.equal(undo.body.removed,1);assert.equal((await request(app).post('/api/imports/'+batchId+'/undo').set(auth(0))).status,409);
 assert.equal((await request(app).get('/api/imports/history').set(auth(1))).status,403);
 p=await preview(future);c=await request(app).post('/api/imports/'+p.body.importId+'/commit').set(auth(0)).send({});assert.equal(c.status,200);
 const modified=await Shift.findOne({importBatch:p.body.importId});modified.notes='Changed after import';await modified.save();
 assert.equal((await request(app).post('/api/imports/'+p.body.importId+'/undo').set(auth(0))).status,409);
 const audit=await request(app).get('/api/imports/audit').set(auth(0));assert.ok(audit.body.events.some(e=>e.action==='two_way_swap_approved'));assert.ok(audit.body.events.some(e=>e.action==='roster_undone'));
 const notes=await request(app).get('/api/notifications').set(auth(1));assert.ok(notes.body.notifications.some(n=>n.type==='schedule_published'));assert.ok(notes.body.notifications.some(n=>n.type==='schedule_undone'));
 assert.equal((await request(app).get('/api/notifications/settings').set(auth(1))).body.reminderMinutes,0);
 assert.equal((await request(app).put('/api/notifications/settings').set(auth(1)).send({reminderMinutes:7})).status,400);
 assert.equal((await request(app).put('/api/notifications/settings').set(auth(1)).send({reminderMinutes:60})).status,200);
 await Shift.create({user:users[1]._id,date:'2027-04-01',startTime:'12:00',endTime:'16:00',type:'Morning',department:'Example team'});
 const svc=require('../server/services/notificationService');assert.equal(await svc.reminders(new Date('2027-04-01T09:30:00Z')),1);assert.equal(await svc.reminders(new Date('2027-04-01T09:35:00Z')),0);
 assert.equal((await request(app).post('/api/notifications/push').set(auth(1)).send({subscription:{endpoint:'https://127.0.0.1/attack',keys:{p256dh:'x',auth:'x'}}})).status,400);
 const enable=await request(app).post('/api/calendar-feed/enable').set(auth(1));assert.equal(enable.status,200);const feedPath=enable.body.path;
 let feed=await request(app).get(feedPath);assert.equal(feed.status,200);assert.match(feed.headers['content-type'],/text\/calendar/);assert.ok(feed.text.includes('UID:shift-'+exchangeB._id));assert.ok(!feed.text.includes('UID:shift-'+exchangeA._id));
 const leave=await Shift.create({user:users[1]._id,date:'2027-05-02',startTime:'00:00',endTime:'23:59',type:'AnnualLeave',department:'Example team'});
 const night=await Shift.create({user:users[1]._id,date:'2027-05-03',startTime:'22:00',endTime:'02:00',type:'Night',workMode:'Office',department:'Example team'});
 feed=await request(app).get(feedPath);assert.ok(feed.text.includes('DTSTART;VALUE=DATE:20270502'));assert.ok(feed.text.includes('DTEND;VALUE=DATE:20270503'));assert.ok(feed.text.includes('DTSTART:20270503T190000Z'));assert.ok(feed.text.includes('DTEND:20270503T230000Z'));assert.ok(feed.text.includes('LOCATION:Office'));
 await Shift.findByIdAndDelete(night._id);assert.ok(!(await request(app).get(feedPath)).text.includes('UID:shift-'+night._id));
 const rotated=await request(app).post('/api/calendar-feed/enable').set(auth(1));assert.equal((await request(app).get(feedPath)).status,404);assert.equal((await request(app).get(rotated.body.path)).status,200);
 await request(app).delete('/api/calendar-feed/enable').set(auth(1));assert.equal((await request(app).get(rotated.body.path)).status,404);assert.equal((await request(app).post('/api/calendar-feed/enable')).status,401);
 const ma=await Shift.create({user:users[1]._id,date:'2027-06-01',startTime:'08:00',endTime:'16:00',type:'Morning',workMode:'Office',department:'Example team'});
 const mb=await Shift.create({user:users[2]._id,date:'2027-06-02',startTime:'08:00',endTime:'16:00',type:'Morning',workMode:'Home',department:'Example team'});
 const payload=(shiftId,day,want)=>({shiftId,start:day+'T10:00',end:day+'T12:00',wantStart:want+'T10:00',wantEnd:want+'T12:00'});
 let mo=await request(app).post('/api/market').set(auth(1)).send(payload(ma._id,'2027-06-01','2027-06-02'));assert.equal(mo.status,201,JSON.stringify(mo.body));const marketId=mo.body.offer._id;
 assert.equal((await request(app).post('/api/swaps').set(auth(1)).send({shiftId:ma._id})).status,409);
 const counterOffer=await request(app).post('/api/market').set(auth(2)).send(payload(mb._id,'2027-06-02','2027-06-01'));assert.equal(counterOffer.status,201,JSON.stringify(counterOffer.body));assert.equal(counterOffer.body.matched,true);const reviewText=await request(app).get('/api/market').set(auth(0));assert.ok(reviewText.body.restChecks[marketId].every(t=>t.includes('Rest')));
 assert.equal((await request(app).post('/api/market/'+marketId+'/approve').set(auth(1))).status,403);
 assert.equal((await request(app).post('/api/market/'+marketId+'/approve').set(auth(0))).status,200);
 const pieces=await Shift.find({date:'2027-06-01'}).sort({startTime:1});assert.equal(pieces.length,3);assert.equal(pieces[0].startTime,'08:00');assert.equal(pieces[0].endTime,'10:00');assert.equal(String(pieces[1].user),String(users[2]._id));assert.equal(pieces[1].workMode,'Office');assert.equal(pieces[2].startTime,'12:00');assert.equal(pieces.reduce((n,s)=>n+s.hours,0),8);
 assert.equal((await request(app).put('/api/market/policy').set(auth(0)).send({managerApproval:false,minRestHours:null})).status,400);
 assert.ok((await request(app).get('/api/notifications').set(auth(2))).body.notifications.some(n=>n.type==='market_offer'));
 async function marketShift(user,date,startTime='08:00',endTime='16:00'){return Shift.create({user:users[user]._id,date,startTime,endTime,type:'Morning',department:'Example team'});}
 async function offer(user,s,date,want,start='08:00',end='16:00'){return request(app).post('/api/market').set(auth(user)).send({autoConsent:true,shiftId:s._id,start:date+'T'+start,end:date+'T'+end,wantStart:want+'T'+start,wantEnd:want+'T'+end});}
 let xa=await marketShift(1,'2027-07-01'),xb=await marketShift(2,'2027-07-03');
 let oa=await offer(1,xa,'2027-07-01','2027-07-03'),ob=await offer(2,xb,'2027-07-03','2027-07-01');assert.equal(ob.body.matched,true);await request(app).post('/api/market/'+oa.body.offer._id+'/withdraw').set(auth(1));const Market=require('../server/models/MarketOffer');assert.equal((await Market.findById(ob.body.offer._id)).status,'Open');await request(app).post('/api/market/'+ob.body.offer._id+'/withdraw').set(auth(2));
 assert.equal((await request(app).put('/api/market/policy').set(auth(0)).send({managerApproval:false,minRestHours:8})).status,200);
 oa=await offer(1,xa,'2027-07-01','2027-07-03');ob=await offer(2,xb,'2027-07-03','2027-07-01');assert.equal(ob.body.matched,true);assert.equal((await Market.findById(oa.body.offer._id)).status,'Approved');assert.equal(await Shift.countDocuments({_id:{$in:[xa._id,xb._id]}}),0);
 xa=await marketShift(1,'2027-08-01');xb=await marketShift(2,'2027-08-03');await marketShift(1,'2027-08-03','07:00','09:00');oa=await offer(1,xa,'2027-08-01','2027-08-03');ob=await offer(2,xb,'2027-08-03','2027-08-01');assert.equal(ob.body.matched,false);assert.equal((await Market.findById(oa.body.offer._id)).status,'Open');
 xa=await marketShift(1,'2027-09-01');xb=await marketShift(2,'2027-09-03');await marketShift(1,'2027-09-03','18:00','22:00');oa=await offer(1,xa,'2027-09-01','2027-09-03');ob=await offer(2,xb,'2027-09-03','2027-09-01');assert.equal(ob.body.matched,false); // 2h rest is below configured 8.
 assert.equal((await request(app).put('/api/market/policy').set(auth(0)).send({managerApproval:true,minRestHours:null})).status,200);
 xa=await marketShift(1,'2027-10-01');xb=await marketShift(2,'2027-10-03');oa=await offer(1,xa,'2027-10-01','2027-10-03');ob=await offer(2,xb,'2027-10-03','2027-10-01');assert.equal(ob.body.matched,true);xa.notes='Later edit';await xa.save();assert.equal((await request(app).post('/api/market/'+oa.body.offer._id+'/approve').set(auth(0))).status,409);assert.equal((await request(app).post('/api/market/'+oa.body.offer._id+'/reject').set(auth(0))).status,200);
 // Preserve a fresh fictional pair for the visual test.
 await marketShift(1,'2027-11-01');await marketShift(2,'2027-11-03');
 const impact=await require('../server/routes/market').weeklyImpact({owner:users[1]._id,start:Date.parse('2027-11-06T18:00Z'),end:Date.parse('2027-11-06T22:00Z')},{owner:users[2]._id,start:Date.parse('2027-11-07T08:00Z'),end:Date.parse('2027-11-07T12:00Z')});assert.equal(impact.length,4);assert.equal(impact[0].after-impact[0].before,-4);assert.equal(impact[1].after-impact[1].before,4);assert.ok(impact[0].under40);assert.equal(impact[2].after-impact[2].before,4);assert.equal(impact[3].after-impact[3].before,-4);
 console.log('PASS: cross-week before/after hours and soft under-40 indicators.');
 console.log('PASS: auto mode with explicit rest policy, whole-shift transfer, withdrawal unlock, overlap/rest rejection and stale-match protection.');
 console.log('PASS: mutual-window matching, partial shift split and hours conservation, location preservation, manager-only approval, standard-offer lock, broadcast notification, safe default policy.');
 console.log('PASS: isolated calendar feed, ownership after exchange, all-day leave, Cairo DST, overnight office shift, removed shift, token rotation/revocation and authentication.');
 console.log('PASS: two-way exchange consent and atomic transfer, persistent mappings, batch history, safe undo and modified protection, audit, schedule notifications, optional reminders and dedupe, push endpoint validation.');
 console.log('PASS: roster, split shifts, overnight, second header, name mapping, unknown code, explicit skip, permissions, preview-only, atomic commit, repeat protection, dedupe, overlap, formula rejection, unknown staff, weekly isolation, approval ownership transfer, template.');
 // Keep this isolated instance alive only during the local visual test.
 if(process.env.VISUAL_TEST){const fs=require('fs');fs.writeFileSync('/tmp/shift-visual.json',JSON.stringify({tokens,emails:users.map(u=>u.email)}));fs.writeFileSync('/tmp/roster-anonymous.xlsx',fixture);app.listen(3100,'0.0.0.0',()=>console.log('Visual test ready at 3100'));}else{await mongoose.disconnect();await db.stop();}
})().catch(e=>{console.error(e);process.exit(1);});
