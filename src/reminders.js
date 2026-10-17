// When reminder emails go out. Kept separate from worker.js so the rules are easy to read and test.
//
// - A reminder every 2 hours after the previous email, until it's stopped from the email's link.
// - Quiet hours (India time) apply to reminders only: one that comes due at night waits until morning.
//   The first email about an enquiry always goes out immediately.
// - Safety stop: no reminders more than 3 days after the enquiry came in.

export const REMINDER_EVERY_HOURS = 2;
export const STOP_AFTER_DAYS = 3;
export const QUIET_FROM_HOUR = 23; // 11 pm
export const QUIET_UNTIL_HOUR = 8; // 8 am
const INDIA_OFFSET_MINUTES = 330; // UTC+5:30, no daylight saving

const HOUR = 3600 * 1000;

export function indiaHour(time) {
  const minutesOfDay = ((Math.floor(time / 60000) + INDIA_OFFSET_MINUTES) % 1440 + 1440) % 1440;
  return Math.floor(minutesOfDay / 60);
}

export function isQuietTime(time) {
  const h = indiaHour(time);
  return h >= QUIET_FROM_HOUR || h < QUIET_UNTIL_HOUR;
}

// The reminder after an email sent at `sentAt`, or null once the safety stop is reached.
export function nextReminderAt(receivedAt, sentAt) {
  const due = sentAt + REMINDER_EVERY_HOURS * HOUR;
  return due - receivedAt > STOP_AFTER_DAYS * 24 * HOUR ? null : due;
}
