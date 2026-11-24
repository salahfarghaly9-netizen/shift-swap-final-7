const assert=require('node:assert/strict'),{MongoMemoryReplSet}=require('mongodb-memory-server'),mongoose=require('mongoose'),request=require('supertest'),jwt=require('jsonwebtoken');
(async()=>{
const db=await MongoMemoryReplSet.create({replSet:{count:1}});process.env.MONGODB_URI=db.getUri();process.env.JWT_SECRET=require('crypto').randomBytes(32).toString('hex');process.env.NODE_ENV='test';
const app=require('../server/index');await mongoose.connection.asPromise();
const User=require('../server/models/User'),Shift=require('../server/models/Shift'),SwapRequest=require('../server/models/SwapRequest'),Offer=require('../server/models/MarketOffer');
const users=await User.create(['Manager Demo','Employee One','Employee Two'].map((name,i)=>({name,email:`auto${i}@example.test`,password:require('crypto').randomBytes(20).toString('hex'),department:'Test',membership:'approved',role:i?'employee':'manager'})));
const auth=i=>({Authorization:'Bearer '+jwt.sign({id:users[i]._id},process.env.JWT_SECRET)}),r=request(app);

// 1. Manager can switch to automatic completion with warnings only (no rest limit).
assert.equal((await r.put('/api/market/policy').set(auth(0)).send({managerApproval:false,minRestHours:null})).status,200);
assert.equal((await r.get('/api/market/policy').set(auth(1))).body.policy.managerApproval,false);

// 2. Market: two fitting offers exchange automatically, no manager action.
const s1=await Shift.create({user:users[1]._id,date:'2028-02-08',startTime:'18:00',endTime:'23:00',type:'Night',department:'Test',workMode:'Office'});
const s2=await Shift.create({user:users[2]._id,date:'2028-02-06',startTime:'08:00',endTime:'16:00',type:'Morning',department:'Test',workMode:'Home'});
const a=await r.post('/api/market').set(auth(1)).send({autoConsent:true,shiftId:s1._id,start:'2028-02-08T20:00',end:'2028-02-08T23:00',returnOptions:[{start:'2028-02-06T08:00',end:'2028-02-06T16:00'}]});
assert.equal(a.status,201);assert.equal(a.body.offer.autoConsent,true);assert.equal(a.body.matched,false);
const b=await r.post('/api/market').set(auth(2)).send({autoConsent:true,shiftId:s2._id,start:'2028-02-06T09:00',end:'2028-02-06T12:00',returnOptions:[{start:'2028-02-08T18:00',end:'2028-02-08T23:00'}]});
assert.equal(b.status,201);assert.equal(b.body.matched,true);
assert.equal(await Offer.countDocuments({status:'Approved'}),2);
assert.equal(await Offer.countDocuments({status:'Matched'}),0);
// Offered segments moved to the other owner.
assert.ok(await Shift.exists({user:users[2]._id,date:'2028-02-08',startTime:'20:00',endTime:'23:00'}));
assert.ok(await Shift.exists({user:users[1]._id,date:'2028-02-06',startTime:'09:00',endTime:'12:00'}));
const notices=(await r.get('/api/notifications').set(auth(1))).body.notifications;
assert.ok(notices.find(n=>n.type==='market_matched'));

// 3. Whole-shift coverage swap completes automatically once accepted.
const s3=await Shift.create({user:users[1]._id,date:'2028-03-10',startTime:'08:00',endTime:'16:00',type:'Morning',department:'Test',workMode:'Office'});
const cov=await r.post('/api/swaps').set(auth(1)).send({shiftId:s3._id,mode:'Coverage'});
assert.equal(cov.status,201);
const acc=await r.post('/api/swaps/'+cov.body.swap._id+'/accept').set(auth(2)).send({});
assert.equal(acc.status,200);assert.equal(acc.body.auto,true);
const covDone=await SwapRequest.findById(cov.body.swap._id);
assert.equal(covDone.status,'Approved');assert.equal(covDone.reviewedBy,null);
assert.equal(String((await Shift.findById(s3._id)).user),String(users[2]._id));

// 4. Whole-shift exchange completes automatically after both sides agree.
const s4=await Shift.create({user:users[1]._id,date:'2028-04-11',startTime:'08:00',endTime:'16:00',type:'Morning',department:'Test',workMode:'Office'});
const s5=await Shift.create({user:users[2]._id,date:'2028-04-12',startTime:'16:00',endTime:'23:00',type:'Night',department:'Test',workMode:'Home'});
const exc=await r.post('/api/swaps').set(auth(1)).send({shiftId:s4._id,mode:'Exchange'});
assert.equal(exc.status,201);
const prop=await r.post('/api/swaps/'+exc.body.swap._id+'/accept').set(auth(2)).send({shiftId:s5._id});
assert.equal(prop.status,200);
const con=await r.post('/api/swaps/'+exc.body.swap._id+'/consent').set(auth(1)).send({});
assert.equal(con.status,200);assert.equal(con.body.auto,true);
const excDone=await SwapRequest.findById(exc.body.swap._id);
assert.equal(excDone.status,'Approved');
assert.equal(String((await Shift.findById(s4._id)).user),String(users[2]._id));
assert.equal(String((await Shift.findById(s5._id)).user),String(users[1]._id));

// 5. Back to manager approval: matches wait for the manager again, and the manager approve route still works.
assert.equal((await r.put('/api/market/policy').set(auth(0)).send({managerApproval:true,minRestHours:null})).status,200);
const s6=await Shift.create({user:users[1]._id,date:'2028-05-08',startTime:'18:00',endTime:'23:00',type:'Night',department:'Test',workMode:'Office'});
const s7=await Shift.create({user:users[2]._id,date:'2028-05-06',startTime:'08:00',endTime:'16:00',type:'Morning',department:'Test',workMode:'Home'});
await r.post('/api/market').set(auth(1)).send({autoConsent:true,shiftId:s6._id,start:'2028-05-08T20:00',end:'2028-05-08T23:00',returnOptions:[{start:'2028-05-06T08:00',end:'2028-05-06T16:00'}]});
await r.post('/api/market').set(auth(2)).send({autoConsent:true,shiftId:s7._id,start:'2028-05-06T09:00',end:'2028-05-06T12:00',returnOptions:[{start:'2028-05-08T18:00',end:'2028-05-08T23:00'}]});
assert.equal(await Offer.countDocuments({status:'Matched'}),2);
const m=await Offer.findOne({status:'Matched'});
assert.equal((await r.post('/api/market/'+m._id+'/approve').set(auth(0))).status,200);
assert.equal(await Offer.countDocuments({status:'Approved'}),4);

console.log('PASS: automatic policy without rest limit, market auto-exchange, coverage and exchange auto-completion, manager mode restored.');
await mongoose.disconnect();await db.stop();
})().catch(e=>{console.error(e);process.exit(1)});
