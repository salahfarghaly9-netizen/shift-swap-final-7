const mongoose = require('mongoose');
const shiftSchema = new mongoose.Schema({
  user:       { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  date:       { type:Date, required:true },
  startTime:  { type:String, required:true },
  endTime:    { type:String, required:true },
  department: { type:String, required:true },
  type:       { type:String, enum:['Morning','Afternoon','Night','Half'], required:true },
  status:     { type:String, enum:['Confirmed','NeedsCoverage','Swapped'], default:'Confirmed' },
  notes:      { type:String }
}, { timestamps:true, toJSON:{virtuals:true}, toObject:{virtuals:true} });
shiftSchema.virtual('hours').get(function() {
  const [sh,sm]=this.startTime.split(':').map(Number);
  const [eh,em]=this.endTime.split(':').map(Number);
  let d=(eh*60+em)-(sh*60+sm); if(d<0)d+=1440; return Math.round(d/60*10)/10;
});
shiftSchema.index({ user:1, date:1, startTime:1 }, { unique:true });
module.exports = mongoose.model('Shift', shiftSchema);
