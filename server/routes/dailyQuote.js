const express    = require('express');
const path       = require('path');
const quotes     = require('../data/quotes.json');
const SavedQuote = require('../models/SavedQuote');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Helper — pick quote of the day (deterministic by day number)
function getDailyQuote() {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000
  );
  return quotes[dayOfYear % quotes.length];
}

// ── GET /api/quotes/daily ──────────────────────────────────────
// Returns today's quote (same for everyone, changes at midnight)
router.get('/daily', protect, async (req, res) => {
  try {
    const quote = getDailyQuote();
    // Check if current user has saved it
    const saved = await SavedQuote.findOne({ user: req.user._id, quoteId: quote.id });
    res.json({ success: true, quote, isSaved: !!saved });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/quotes/random ────────────────────────────────────
// Returns a random quote (different each call)
router.get('/random', protect, async (req, res) => {
  try {
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    const saved = await SavedQuote.findOne({ user: req.user._id, quoteId: quote.id });
    res.json({ success: true, quote, isSaved: !!saved });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/quotes ────────────────────────────────────────────
// All quotes with optional ?category= filter and ?search= text search
router.get('/', protect, async (req, res) => {
  try {
    let result = [...quotes];

    if (req.query.category && req.query.category !== 'all') {
      result = result.filter(q => q.category === req.query.category);
    }
    if (req.query.search) {
      const q = req.query.search.toLowerCase();
      result = result.filter(r =>
        r.text.toLowerCase().includes(q) ||
        r.textAr.includes(req.query.search) ||
        r.author.toLowerCase().includes(q)
      );
    }

    // Get all saved IDs for this user in one query
    const saved = await SavedQuote.find({ user: req.user._id }).select('quoteId');
    const savedIds = new Set(saved.map(s => s.quoteId));

    const withSaved = result.map(q => ({ ...q, isSaved: savedIds.has(q.id) }));

    res.json({
      success: true,
      count: withSaved.length,
      categories: [...new Set(quotes.map(q => q.category))].sort(),
      quotes: withSaved
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/quotes/:id/save ─────────────────────────────────
// Save a quote to favourites
router.post('/:id/save', protect, async (req, res) => {
  try {
    const quote = quotes.find(q => q.id === parseInt(req.params.id));
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });

    await SavedQuote.findOneAndUpdate(
      { user: req.user._id, quoteId: quote.id },
      { user: req.user._id, quoteId: quote.id, text: quote.text, textAr: quote.textAr, author: quote.author, category: quote.category },
      { upsert: true, new: true }
    );
    res.json({ success: true, message: 'Quote saved to favourites' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/quotes/:id/save ───────────────────────────────
// Remove quote from favourites
router.delete('/:id/save', protect, async (req, res) => {
  try {
    await SavedQuote.findOneAndDelete({ user: req.user._id, quoteId: parseInt(req.params.id) });
    res.json({ success: true, message: 'Quote removed from favourites' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/quotes/saved ──────────────────────────────────────
// Get all saved quotes for current user
router.get('/saved', protect, async (req, res) => {
  try {
    const saved = await SavedQuote.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, count: saved.length, quotes: saved });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
