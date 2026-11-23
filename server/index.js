require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const morgan    = require('morgan');
const path      = require('path');
const connectDB = require('./config/db');

if (!process.env.MONGODB_URI) {
  console.error('\n❌  MONGODB_URI not set!');
  console.error('    Render → Environment tab → Add MONGODB_URI\n');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET not set — using insecure default');
  process.env.JWT_SECRET = 'shiftswap_insecure_default_2026';
}

connectDB();
const app = express();

app.use(cors({origin:'*',methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Authorization']}));
app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:false}));
if (process.env.NODE_ENV !== 'test') app.use(morgan((tokens,req,res)=>req.path.startsWith('/api/calendar-feed/feed/')?'GET /api/calendar-feed/feed/[redacted] '+res.statusCode:tokens.method(req,res)+' '+tokens.url(req,res)+' '+tokens.status(req,res)));

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/imports', require('./routes/rosterImport'));
app.use('/api/shifts',        require('./routes/shifts'));
app.use('/api/market',require('./routes/market'));
app.use('/api/swaps',         require('./routes/swapRequests'));
app.use('/api/breaks', require('./routes/breaks'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/calendar-feed', require('./routes/calendarFeed'));
app.use('/api/calendar',      require('./routes/googleCalendar'));
app.use('/api/shift-notes',   require('./routes/shiftNotes'));
app.use('/api/trades',        require('./routes/swapTrade'));
app.use('/api/quotes',        require('./routes/dailyQuote'));

app.get('/api/health', (_req, res) => res.json({
  success:true, app:'Nextcare — Shift Swap System',
  designer:'Salah Farghaly', email:'salahfarghaly9@gmail.com',
  env:process.env.NODE_ENV||'development', time:new Date().toISOString()
}));

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  if (err.name==='ValidationError') return res.status(400).json({success:false,message:Object.values(err.errors).map(e=>e.message).join(', ')});
  if (err.code===11000) return res.status(409).json({success:false,message:`${Object.keys(err.keyValue||{})[0]||'field'} already exists`});
  if (['JsonWebTokenError','TokenExpiredError'].includes(err.name)) return res.status(401).json({success:false,message:'Session expired — please log in again'});
  res.status(err.status||500).json({success:false,message:err.message||'Server error'});
});

const PORT = parseInt(process.env.PORT,10)||3000;
if (require.main === module) app.listen(PORT,'0.0.0.0', () => {
  require('./services/notificationService').startReminders();
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🏥  Nextcare — Shift Swap System');
  console.log('  ✏️   Designed by Salah Farghaly');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  🚀  Port : ${PORT}`);
  console.log(`  🌍  Env  : ${process.env.NODE_ENV||'development'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});
module.exports = app;
