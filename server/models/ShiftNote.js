const mongoose = require('mongoose');

const noteItemSchema = new mongoose.Schema({
  content:   { type: String, required: true, maxlength: 1000 },
  author:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isUrgent:  { type: Boolean, default: false },
  isPinned:  { type: Boolean, default: false },
  editHistory: [{
    content:   String,
    editedAt:  { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const shiftNoteSchema = new mongoose.Schema({
  shift: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shift',
    required: true,
    unique: true
  },
  notes: [noteItemSchema],
  signatures: [{
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    signedAt: { type: Date, default: Date.now }
  }],
  lastUpdated: { type: Date, default: Date.now }
}, { timestamps: true });

// Index for fast lookup by shift
shiftNoteSchema.index({ shift: 1 });

module.exports = mongoose.model('ShiftNote', shiftNoteSchema);
