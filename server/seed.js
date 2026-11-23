require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const User = require('./models/User');
const Shift = require('./models/Shift');
const SwapRequest = require('./models/SwapRequest');
const Notification = require('./models/Notification');

const TYPES = [
  {type:'Morning',start:'08:00',end:'16:00'},
  {type:'Afternoon',start:'16:00',end:'00:00'},
  {type:'Night',start:'00:00',end:'08:00'},
  {type:'Half',start:'08:00',end:'12:00'},
];
const pick = arr => arr[Math.floor(Math.random()*arr.length)];
const addDays = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r; };

async function seed() {
  await connectDB();
  console.log('\n🌱 Seeding...\n');
  await Promise.all([User.deleteMany({}),Shift.deleteMany({}),SwapRequest.deleteMany({}),Notification.deleteMany({})]);

  const manager = await User.create({name:'Salah Farghaly',email:'manager@nextcare.com',password:'manager123',role:'manager',department:'Management'});
  console.log(`👔 Manager: ${manager.email} / manager123`);

  const empData = [
    {name:'Ahmed Mohamed',  email:'ahmed@nextcare.com',   department:'Operations'},
    {name:'Sara Mahmoud',   email:'sara@nextcare.com',    department:'Operations'},
    {name:'Mohamed Ali',    email:'mo@nextcare.com',      department:'Support'},
    {name:'Nour Hossam',    email:'nour@nextcare.com',    department:'Support'},
    {name:'Karim Reda',     email:'karim@nextcare.com',   department:'Nursing'},
    {name:'Heba Mansour',   email:'heba@nextcare.com',    department:'Reception'},
    {name:'Rami Selim',     email:'rami@nextcare.com',    department:'Support'},
    {name:'Yasmin Omar',    email:'yasmin@nextcare.com',  department:'Nursing'},
    {name:'Omar Farouk',    email:'omar@nextcare.com',    department:'Operations'},
    {name:'Mona Khaled',    email:'mona@nextcare.com',    department:'Reception'},
  ];
  const employees = await User.insertMany(empData.map(e=>({...e,password:'emp123456',role:'employee'})));
  console.log(`👥 ${employees.length} employees (password: emp123456)`);

  const today = new Date(); today.setHours(0,0,0,0);
  const shiftDocs = [];
  for (const emp of employees) {
    for (let d=0;d<14;d++) {
      if (d%7===5||d%7===6) continue;
      const t = pick(TYPES);
      shiftDocs.push({user:emp._id,date:addDays(today,d),startTime:t.start,endTime:t.end,type:t.type,department:emp.department,status:'Confirmed'});
    }
  }
  const shifts = await Shift.insertMany(shiftDocs,{ordered:false});
  console.log(`📅 ${shifts.length} shifts created`);

  // Sample swaps
  const [ahmed,,nour,rami] = employees;
  const aShift = shifts.find(s=>s.user.toString()===ahmed._id.toString());
  if (aShift) {
    aShift.status='NeedsCoverage'; await aShift.save();
    await SwapRequest.create({requester:ahmed._id,requesterShift:aShift._id,reason:'Family event',availableTimes:'Friday & Saturday',urgency:'Medium',status:'Open'});
  }
  const nShift = shifts.find(s=>s.user.toString()===nour._id.toString());
  if (nShift) {
    nShift.status='NeedsCoverage'; await nShift.save();
    const sw = await SwapRequest.create({requester:nour._id,requesterShift:nShift._id,acceptor:rami._id,reason:'Medical emergency',urgency:'Urgent',status:'Accepted'});
    await Notification.create({user:nour._id,type:'swap_accepted',title:'Swap Accepted',message:'Rami Selim accepted your swap — awaiting manager approval',relatedSwap:sw._id});
  }

  console.log('\n✅ Seed complete!\n');
  console.log('  manager@nextcare.com  /  manager123');
  console.log('  ahmed@nextcare.com    /  emp123456\n');
  await mongoose.disconnect(); process.exit(0);
}
seed().catch(err => { console.error('❌ Seed failed:', err); process.exit(1); });
