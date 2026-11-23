const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Shift type → Google Calendar color
const SHIFT_COLORS = {
  Morning:   '1',  // Lavender (blue)
  Afternoon: '5',  // Banana (yellow)
  Night:     '8',  // Graphite (dark)
  Half:      '2',  // Sage (green)
};

/**
 * Build a Google Calendar event from a Shift document
 */
function buildCalendarEvent(shift, user) {
  const date = new Date(shift.date);
  const dateStr = date.toISOString().split('T')[0]; // "2026-05-10"

  // Handle overnight shifts (Night: 00:00–08:00)
  const [sh, sm] = shift.startTime.split(':').map(Number);
  const [eh, em] = shift.endTime.split(':').map(Number);

  const startDt = new Date(`${dateStr}T${shift.startTime}:00`);
  let endDt     = new Date(`${dateStr}T${shift.endTime}:00`);
  if (eh < sh || (eh === sh && em < sm)) {
    // End is next day
    endDt.setDate(endDt.getDate() + 1);
  }

  return {
    summary:     `🏥 ${shift.type} Shift — ${shift.department}`,
    description: `Nextcare Shift Swap System\nEmployee: ${user.name}\nDepartment: ${shift.department}\nType: ${shift.type}\nShift ID: ${shift._id}`,
    location:    'Nextcare Medical Care',
    colorId:     SHIFT_COLORS[shift.type] || '1',
    start: { dateTime: startDt.toISOString(), timeZone: 'Africa/Cairo' },
    end:   { dateTime: endDt.toISOString(),   timeZone: 'Africa/Cairo' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'email', minutes: 120 },
      ],
    },
    extendedProperties: {
      private: {
        shiftSwapId:   String(shift._id),
        shiftType:     shift.type,
        department:    shift.department,
        source:        'shiftswap',
      }
    }
  };
}

module.exports = { oauth2Client, SHIFT_COLORS, buildCalendarEvent };
