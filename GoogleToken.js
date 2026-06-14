const { google }     = require('googleapis');
const { oauth2Client, buildCalendarEvent } = require('../config/googleCalendar');
const GoogleToken    = require('../models/GoogleToken');

/**
 * Get an authenticated calendar client for a user.
 * Returns null if user has not connected Google Calendar.
 */
async function getCalendarClient(userId) {
  const tokenDoc = await GoogleToken.findOne({ user: userId, calendarEnabled: true });
  if (!tokenDoc) return null;

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  client.setCredentials({
    access_token:  tokenDoc.accessToken,
    refresh_token: tokenDoc.refreshToken,
    expiry_date:   tokenDoc.expiryDate,
  });

  // Auto-refresh if expired
  client.on('tokens', async (tokens) => {
    if (tokens.refresh_token) tokenDoc.refreshToken = tokens.refresh_token;
    tokenDoc.accessToken = tokens.access_token;
    tokenDoc.expiryDate  = tokens.expiry_date;
    await tokenDoc.save();
  });

  return { client, calendarId: tokenDoc.calendarId || 'primary' };
}

/**
 * Add a shift event to user's Google Calendar.
 * Returns the created event ID (store on the Shift for later updates).
 */
async function addShiftEvent(userId, shift, user) {
  const auth = await getCalendarClient(userId);
  if (!auth) return null;

  try {
    const calendar = google.calendar({ version: 'v3', auth: auth.client });
    const event    = buildCalendarEvent(shift, user);
    const res      = await calendar.events.insert({
      calendarId: auth.calendarId,
      resource:   event,
    });
    console.log(`📅 Calendar event created: ${res.data.id} for user ${user.name}`);
    return res.data.id;
  } catch (err) {
    console.error('Calendar addShiftEvent error:', err.message);
    return null;
  }
}

/**
 * Update an existing calendar event (e.g. shift time changed or swapped).
 */
async function updateShiftEvent(userId, shift, user, googleEventId) {
  const auth = await getCalendarClient(userId);
  if (!auth || !googleEventId) return false;

  try {
    const calendar = google.calendar({ version: 'v3', auth: auth.client });
    const event    = buildCalendarEvent(shift, user);
    await calendar.events.update({
      calendarId: auth.calendarId,
      eventId:    googleEventId,
      resource:   event,
    });
    console.log(`📅 Calendar event updated: ${googleEventId}`);
    return true;
  } catch (err) {
    console.error('Calendar updateShiftEvent error:', err.message);
    return false;
  }
}

/**
 * Delete a calendar event (e.g. shift cancelled or swap withdrawn).
 */
async function deleteShiftEvent(userId, googleEventId) {
  const auth = await getCalendarClient(userId);
  if (!auth || !googleEventId) return false;

  try {
    const calendar = google.calendar({ version: 'v3', auth: auth.client });
    await calendar.events.delete({
      calendarId: auth.calendarId,
      eventId:    googleEventId,
    });
    console.log(`📅 Calendar event deleted: ${googleEventId}`);
    return true;
  } catch (err) {
    console.error('Calendar deleteShiftEvent error:', err.message);
    return false;
  }
}

/**
 * Sync all confirmed shifts for a user after they connect Google Calendar.
 * Called once after OAuth callback.
 */
async function syncAllShiftsForUser(userId, user, shifts) {
  const auth = await getCalendarClient(userId);
  if (!auth) return { synced: 0, failed: 0 };

  const calendar = google.calendar({ version: 'v3', auth: auth.client });
  let synced = 0, failed = 0;

  for (const shift of shifts) {
    try {
      const event  = buildCalendarEvent(shift, user);
      const res    = await calendar.events.insert({ calendarId: auth.calendarId, resource: event });
      shift.googleEventId = res.data.id;
      await shift.save();
      synced++;
    } catch {
      failed++;
    }
  }

  console.log(`📅 Bulk sync: ${synced} synced, ${failed} failed for ${user.name}`);
  return { synced, failed };
}

module.exports = { addShiftEvent, updateShiftEvent, deleteShiftEvent, syncAllShiftsForUser };
