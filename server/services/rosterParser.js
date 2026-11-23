const ExcelJS = require('exceljs');
const crypto = require('crypto');
function workMode(cell,fallback){
 const fill=cell.fill;const color=fill&&fill.fgColor;const rgb=color&&color.argb;
 if(rgb){const h=rgb.slice(-6);const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4),16);
 if(r>180&&g>65&&g<225&&b<130&&r>g*1.08)return 'Office';
 if(r>235&&g>235&&b>235)return 'Home';}
 if(fallback&&fallback!=='Auto')return fallback;
 if(!fill||fill.pattern==='none'||!color)return 'Home';
 return 'Unspecified';
}
const OFF = /^(off|leave|annual leave|rest|اجازة|إجازة|راحة|عطلة|-)$/i;
const clean = v => String(v == null ? '' : v).trim();
function value(cell) {
  const v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (v.formula || v.sharedFormula) throw new Error(`Formula not allowed in ${cell.address}. Paste values first.`);
    if (v.richText) return v.richText.map(x => x.text).join('');
    if (v.text) return v.text;
  }
  return v;
}
function date(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
  let s = clean(v);
  if(/^\d{2}-\d{2}-\d{4}$/.test(s))s=s.slice(6)+'-'+s.slice(3,5)+'-'+s.slice(0,2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s)) || new Date(s).toISOString().slice(0,10)!==s) throw new Error('Use a real Excel date or YYYY-MM-DD, not an ambiguous date.');
  return s;
}
function time(v) {
  if (v instanceof Date) return v.toISOString().slice(11,16);
  if (typeof v === 'number' && v>=0 && v<1) {const m=Math.round(v*1440)%1440;return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;}
  const m = clean(v).match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1]>23 || +m[2]>59) throw new Error('Time must use 24-hour HH:mm, for example 08:00.');
  return m[1].padStart(2,'0')+':'+m[2];
}
function typeFor(start,end) {const h=+start.slice(0,2);return h>=20||h<6?'Night':h>=12?'Afternoon':'Morning';}
const aliases = {email:['email','e-mail','الايميل','الإيميل','البريد الإلكتروني','البريد الالكتروني'],date:['date','التاريخ'],start:['start','starttime','start time','بداية','من'],end:['end','endtime','end time','نهاية','الى','إلى'],type:['type','النوع'],department:['department','القسم'],name:['name','officer','الاسم']};
function header(v) {const s=clean(v).toLowerCase();return Object.keys(aliases).find(k=>aliases[k].includes(s))||s;}
async function parse(buffer, sheetName, mappings={}, people={}, fallback='Auto') {
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer);
  const sheetNames=wb.worksheets.map(s=>s.name);const ws=sheetName?wb.getWorksheet(sheetName):wb.worksheets[0];
  if(!ws)throw new Error('Choose a worksheet.');
  if(ws.rowCount>1000||ws.columnCount>100)throw new Error('Maximum 1,000 rows and 100 columns per sheet. Split this file.');
  const head=ws.getRow(1).values.slice(1).map(header), cols={};head.forEach((v,i)=>cols[v]=i+1);
  if(!cols.email&&!cols.name)throw new Error('First row must contain Email or Officer. Staff must have registered accounts.');
  const rows=[],errors=[],unmatched=new Set(),names=new Set();let off=0;const warnings=[];
  const add=(r,d,s,e,t,dep,n,mode)=>{try{const startTime=time(s),endTime=time(e);if(startTime===endTime&&t!=='AnnualLeave')throw new Error('Start and end cannot be identical.'); const type=clean(t)||typeFor(startTime,endTime);if(!['Morning','Afternoon','Night','Half','AnnualLeave'].includes(type))throw new Error('Type must be Morning, Afternoon, Night or Half.');rows.push({row:r,email:clean(n).toLowerCase(),date:date(d),startTime,endTime,type,department:clean(dep),workMode:mode||'Unspecified'});}catch(err){errors.push({row:r,message:err.message});}};
  const long=!!cols.date;
  if(long&&(!cols.start||!cols.end))throw new Error('Row format needs Email, Date, Start and End columns.');
  const dates=[];
  if(!long) head.forEach((h,i)=>{if(['email','name','department'].includes(h)||!h)return;try{dates.push({col:i+1,date:date(value(ws.getRow(1).getCell(i+1)))});}catch(e){errors.push({row:1,message:`Column ${i+1}: ${e.message}`});}});
  if(!long&&!dates.length)throw new Error('Roster format needs full dates in the header row.');
  for(let r=2;r<=ws.rowCount;r++){
    const row=ws.getRow(r);if(!row.hasValues)continue;
    try{
      const get=c=>c?value(row.getCell(c)):'';const person=clean(get(cols.name)), email=cols.email?get(cols.email):people[person],dep=get(cols.department);
      if(!person&&!clean(email)&&r===2)continue;
      if(person)names.add(person);
      if(!cols.email&&!email){unmatched.add(person);continue;}
      if(!clean(email)){errors.push({row:r,message:'Missing email.'});continue;}
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(email))){errors.push({row:r,message:'Invalid email.'});continue;}
      if(long)add(r,get(cols.date),get(cols.start),get(cols.end),get(cols.type),dep,email);
      else for(const d of dates){const v=clean(get(d.col));if(!v||OFF.test(v)){off++;continue;}const mode=workMode(row.getCell(d.col),fallback);if(/^AN$/i.test(v)){add(r,d.date,'00:00','00:00','AnnualLeave',dep,email,'Unspecified');continue;}const mapped=mappings[v];if(mapped&&mapped.skip===true){off++;continue;}if(mapped)add(r,d.date,mapped.start,mapped.end,mapped.type,dep,email,mode);else{
        for(const segment of v.split('/')){const m=segment.trim().match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/);if(m)add(r,d.date,m[1],m[2],'',dep,email,mode);else errors.push({row:r,message:`${d.date}: unknown shift code "${v.slice(0,25)}". Define its hours or explicitly skip it.`});}
      }}

    }catch(e){errors.push({row:r,message:e.message});}
    if(rows.length>3000)throw new Error('Maximum 3,000 shifts per import.');
  }
  return {rows,errors,off,unmatched:[...unmatched],people:[...names],warnings,sheets:sheetNames,sheet:ws.name,format:long?'rows':'roster'};
}
function importKey(r) {return crypto.createHash('sha256').update([r.email,r.date,r.startTime,r.endTime].join('|')).digest('hex');}
module.exports={parse,date,time,importKey,workMode};
