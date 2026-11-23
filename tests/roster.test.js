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
 const shift=own.body.shifts[0];let sw=await request(app).post('/api/swaps').set(auth(1)).send({shiftId:shift._id});assert.equal(sw.status,201);assert.equal((await request(app).post('/api/swaps/'+sw.body.swap._id+'/accept').set(auth(2))).status,200);
 let approved=await request(app).post('/api/swaps/'+sw.body.swap._id+'/approve').set(auth(0));assert.equal(approved.status,200,JSON.stringify(approved.body));assert.equal(String((await Shift.findById(shift._id)).user),String(users[2]._id));assert.equal((await request(app).get('/api/shifts/my?week=2026-11-22').set(auth(1))).body.shifts.length,3);
 assert.equal((await request(app).get('/api/shifts/my?week=2026-11-22').set(auth(2))).body.shifts.length,3);
 const tmpl=await request(app).get('/api/imports/template').set(auth(0));assert.equal(tmpl.status,200);
 console.log('PASS: roster, split shifts, overnight, second header, name mapping, unknown code, explicit skip, permissions, preview-only, atomic commit, repeat protection, dedupe, overlap, formula rejection, unknown staff, weekly isolation, approval ownership transfer, template.');
 // Keep this isolated instance alive only during the local visual test.
 if(process.env.VISUAL_TEST){const fs=require('fs');fs.writeFileSync('/tmp/shift-visual.json',JSON.stringify({tokens,emails:users.map(u=>u.email)}));fs.writeFileSync('/tmp/roster-anonymous.xlsx',fixture);app.listen(3100,'0.0.0.0',()=>console.log('Visual test ready at 3100'));}else{await mongoose.disconnect();await db.stop();}
})().catch(e=>{console.error(e);process.exit(1);});
