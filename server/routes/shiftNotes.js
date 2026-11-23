const express   = require('express');
const { body, validationResult } = require('express-validator');
const ShiftNote = require('../models/ShiftNote');
const Shift     = require('../models/Shift');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);
router.use('/:shiftId',async(req,res,next)=>{try{const shift=await Shift.findById(req.params.shiftId);if(!shift)return res.status(404).json({success:false,message:'Shift not found'});if(req.user.role!=='manager'&&String(shift.user)!==String(req.user._id))return res.status(403).json({success:false,message:'You can only read notes on your own shifts.'});next();}catch(e){res.status(400).json({success:false,message:'Invalid shift'});}});

// ── GET /api/shift-notes/:shiftId ─────────────────────────────
// Get all notes for a shift (creates empty doc if none exist yet)
router.get('/:shiftId', async (req, res) => {
  try {
    let doc = await ShiftNote.findOne({ shift: req.params.shiftId })
      .populate('notes.author',     'name department')
      .populate('signatures.user',  'name department');

    if (!doc) {
      doc = await ShiftNote.create({ shift: req.params.shiftId, notes: [], signatures: [] });
    }
    res.json({ success: true, shiftNote: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/shift-notes/:shiftId ────────────────────────────
// Add a new note to a shift
router.post('/:shiftId', [
  body('content').trim().notEmpty().withMessage('Note content is required')
                 .isLength({ max: 1000 }).withMessage('Note max 1000 characters'),
  body('isUrgent').optional().isBoolean(),
  body('isPinned').optional().isBoolean(),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ success: false, errors: errs.array() });

  try {
    let doc = await ShiftNote.findOne({ shift: req.params.shiftId });
    if (!doc) {
      doc = new ShiftNote({ shift: req.params.shiftId });
    }

    doc.notes.push({
      content:  req.body.content,
      author:   req.user._id,
      isUrgent: req.body.isUrgent || false,
      isPinned: req.body.isPinned || false,
    });
    doc.lastUpdated = new Date();
    await doc.save();

    const populated = await doc.populate('notes.author', 'name department');
    res.status(201).json({ success: true, shiftNote: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PATCH /api/shift-notes/:shiftId/notes/:noteId ─────────────
// Edit an existing note (only the original author or manager)
router.patch('/:shiftId/notes/:noteId', [
  body('content').optional().trim().notEmpty(),
  body('isUrgent').optional().isBoolean(),
  body('isPinned').optional().isBoolean(),
], async (req, res) => {
  try {
    const doc = await ShiftNote.findOne({ shift: req.params.shiftId });
    if (!doc) return res.status(404).json({ success: false, message: 'Shift notes not found' });

    const note = doc.notes.id(req.params.noteId);
    if (!note) return res.status(404).json({ success: false, message: 'Note not found' });

    // Only author or manager can edit
    const isAuthor  = note.author.toString() === req.user._id.toString();
    const isManager = req.user.role === 'manager';
    if (!isAuthor && !isManager) {
      return res.status(403).json({ success: false, message: 'Only the note author or manager can edit this note' });
    }

    // Save edit history before updating
    if (req.body.content && req.body.content !== note.content) {
      note.editHistory.push({ content: note.content });
    }

    if (req.body.content  !== undefined) note.content  = req.body.content;
    if (req.body.isUrgent !== undefined) note.isUrgent = req.body.isUrgent;
    if (req.body.isPinned !== undefined) note.isPinned = req.body.isPinned;
    note.updatedAt   = new Date();
    doc.lastUpdated  = new Date();

    await doc.save();
    const populated = await doc.populate('notes.author', 'name department');
    res.json({ success: true, shiftNote: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/shift-notes/:shiftId/notes/:noteId ────────────
// Delete a note (author or manager only)
router.delete('/:shiftId/notes/:noteId', async (req, res) => {
  try {
    const doc = await ShiftNote.findOne({ shift: req.params.shiftId });
    if (!doc) return res.status(404).json({ success: false, message: 'Shift notes not found' });

    const note = doc.notes.id(req.params.noteId);
    if (!note) return res.status(404).json({ success: false, message: 'Note not found' });

    const isAuthor  = note.author.toString() === req.user._id.toString();
    const isManager = req.user.role === 'manager';
    if (!isAuthor && !isManager) {
      return res.status(403).json({ success: false, message: 'Not authorised to delete this note' });
    }

    note.deleteOne();
    doc.lastUpdated = new Date();
    await doc.save();
    res.json({ success: true, message: 'Note deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/shift-notes/:shiftId/sign ───────────────────────
// Team member signs off that they have read the notes
router.post('/:shiftId/sign', async (req, res) => {
  try {
    let doc = await ShiftNote.findOne({ shift: req.params.shiftId });
    if (!doc) {
      doc = await ShiftNote.create({ shift: req.params.shiftId });
    }

    // Check not already signed
    const alreadySigned = doc.signatures.some(
      s => s.user?.toString() === req.user._id.toString()
    );
    if (alreadySigned) {
      return res.status(409).json({ success: false, message: 'You have already signed off on this shift' });
    }

    doc.signatures.push({ user: req.user._id, signedAt: new Date() });
    await doc.save();

    const populated = await doc.populate('signatures.user', 'name department');
    res.json({ success: true, message: 'Signed off successfully', shiftNote: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/shift-notes/:shiftId/unsigned ────────────────────
// Get list of team members who haven't signed yet (manager use)
router.get('/:shiftId/unsigned', async (req, res) => {
  try {
    const [doc, shift] = await Promise.all([
      ShiftNote.findOne({ shift: req.params.shiftId }).populate('signatures.user', '_id'),
      Shift.findById(req.params.shiftId).populate('user', 'name department')
    ]);

    if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });

    const signedIds = (doc?.signatures || []).map(s => s.user?._id?.toString());

    // For demo: return shift owner as the only person who needs to sign
    const unsigned = [shift.user].filter(u => !signedIds.includes(u?._id?.toString()));
    res.json({ success: true, unsigned });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
