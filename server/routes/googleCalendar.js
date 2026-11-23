const express      = require('express');
const { google }   = require('googleapis');
const { oauth2Client } = require('../config/googleCalendar');
const GoogleToken  = require('../models/GoogleToken');
const Shift        = require('../models/Shift');
const { protect }  = require('../middleware/auth');
const { syncAllShiftsForUser } = require('../services/calendarService');

const router = express.Router();

// OAuth scopes needed
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

// ── GET /api/calendar/status ───────────────────────────────────
// Check if current user has connected Google Calendar
router.get('/status', protect, async (req, res) => {
  try {
    const token = await GoogleToken.findOne({ user: req.user._id });
    res.json({
      success: true,
      connected: !!token,
      enabled:   token?.calendarEnabled ?? false,
      calendarId: token?.calendarId ?? 'primary',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/calendar/auth-url ─────────────────────────────────
// Returns the Google OAuth URL to redirect the user to
router.get('/auth-url', protect, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({
      success: false,
      message: 'Google Calendar is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your environment variables.',
    });
  }

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',      // get refresh token
    prompt:      'consent',      // force consent to always get refresh token
    scope:       SCOPES,
    state:       String(req.user._id), // pass user ID through OAuth flow
  });

  res.json({ success: true, url });
});

// ── GET /api/calendar/callback ─────────────────────────────────
// Google redirects here after user grants permission
router.get('/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;

  if (error) {
    return res.redirect(`${process.env.CLIENT_URL || ''}/?calendar=denied`);
  }
  if (!code || !userId) {
    return res.redirect(`${process.env.CLIENT_URL || ''}/?calendar=error`);
  }

  try {
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await client.getToken(code);

    // Upsert the token doc
    await GoogleToken.findOneAndUpdate(
      { user: userId },
      {
        user:          userId,
        accessToken:   tokens.access_token,
        refreshToken:  tokens.refresh_token,
        expiryDate:    tokens.expiry_date,
        scope:         tokens.scope,
        tokenType:     tokens.token_type,
        calendarEnabled: true,
      },
      { upsert: true, new: true }
    );

    // Trigger background sync of existing confirmed shifts
    const User = require('../models/User');
    const user = await User.findById(userId);
    if (user) {
      const now = new Date();
      const shifts = await Shift.find({
        user:   userId,
        date:   { $gte: now },
        status: 'Confirmed'
      }).limit(50);
      syncAllShiftsForUser(userId, user, shifts); // fire and forget
    }

    res.redirect(`${process.env.CLIENT_URL || '/'}?calendar=connected`);
  } catch (err) {
    console.error('Google Calendar callback error:', err.message);
    res.redirect(`${process.env.CLIENT_URL || '/'}?calendar=error`);
  }
});

// ── DELETE /api/calendar/disconnect ───────────────────────────
// Remove user's Google Calendar connection
router.delete('/disconnect', protect, async (req, res) => {
  try {
    await GoogleToken.findOneAndDelete({ user: req.user._id });
    res.json({ success: true, message: 'Google Calendar disconnected' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PATCH /api/calendar/settings ──────────────────────────────
// Toggle sync on/off, change calendar ID
router.patch('/settings', protect, async (req, res) => {
  try {
    const updates = {};
    if (req.body.calendarEnabled !== undefined) updates.calendarEnabled = req.body.calendarEnabled;
    if (req.body.calendarId)                    updates.calendarId      = req.body.calendarId;

    const token = await GoogleToken.findOneAndUpdate(
      { user: req.user._id },
      updates,
      { new: true }
    );
    if (!token) return res.status(404).json({ success: false, message: 'Not connected to Google Calendar' });
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/calendar/sync-all ───────────────────────────────
// Manually re-sync all upcoming shifts to Google Calendar
router.post('/sync-all', protect, async (req, res) => {
  try {
    const user   = req.user;
    const shifts = await Shift.find({ user: user._id, date: { $gte: new Date() }, status: 'Confirmed' });
    const result = await syncAllShiftsForUser(user._id, user, shifts);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
