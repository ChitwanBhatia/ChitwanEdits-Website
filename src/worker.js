// The site's small server side, on Cloudflare. Files in site/ are served before this runs;
// only the contact form's /api/enquiry requests (and other unknown paths) reach it.
//
// Each enquiry is emailed to Chitwan at once, then reminded every 2 hours (daytime only, India time)
// until he clicks that enquiry's "Stop the reminders" link, for up to 3 days. Rules: reminders.js.
// Emails go only to the verified address in NOTIFY_TO, which Cloudflare sends for free.
// Enquiries are also kept in the D1 database (table in migrations/0001_enquiries.sql).

import { REMINDER_EVERY_HOURS, STOP_AFTER_DAYS, isQuietTime, nextReminderAt } from './reminders.js';

const MAX_PER_HOUR = 30; // flood guard for the whole form
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/enquiry' && request.method === 'POST') return receiveEnquiry(request, env);
    if (url.pathname === '/api/enquiry/stop') return stopReminders(request, url, env);
    return env.ASSETS.fetch(request);
  },

  // Cron trigger (wrangler.jsonc): sends reminders that have come due.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(sendDueReminders(env));
  },
};

/* ---------------- Receiving the form ---------------- */

async function receiveEnquiry(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request' }, 400);
  }
  if (data.botcheck) return json({ ok: true }); // hidden field only bots fill in: quietly ignore

  const name = clean(data.name, 100);
  const contact = clean(data.contact, 150);
  const message = clean(data.message, 4000, true);
  if (!name || !contact || !message) return json({ ok: false, error: 'Please fill in every field.' }, 400);

  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM enquiries WHERE at > ?').bind(Date.now() - 3600 * 1000).first('n');
  if (recent >= MAX_PER_HOUR) return json({ ok: false, error: 'Too many messages right now. Please try again later.' }, 429);

  const enquiry = {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    name,
    contact,
    message,
    page: clean(data.page, 200),
    at: Date.now(),
    sent: 0,
  };
  try {
    await sendEnquiryEmail(env, enquiry);
  } catch (err) {
    console.error('enquiry email failed', err && (err.code || err.message));
    return json({ ok: false, error: 'Could not send right now.' }, 502);
  }
  enquiry.sent = 1;
  await env.DB.prepare('INSERT INTO enquiries (id, token, name, contact, message, page, at, sent, due) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(enquiry.id, enquiry.token, name, contact, message, enquiry.page, enquiry.at, enquiry.sent, nextReminderAt(enquiry.at, enquiry.at))
    .run();
  return json({ ok: true });
}

/* ---------------- Reminders ---------------- */

// Runs every 10 minutes. At night nothing goes out; reminders that came due wait until 8 am.
async function sendDueReminders(env) {
  const now = Date.now();
  if (isQuietTime(now)) return;
  const { results } = await env.DB.prepare('SELECT * FROM enquiries WHERE due IS NOT NULL AND due <= ? ORDER BY due LIMIT 50')
    .bind(now)
    .all();
  for (const enquiry of results) {
    const next = nextReminderAt(enquiry.at, now);
    try {
      await sendEnquiryEmail(env, enquiry, { last: next === null });
    } catch (err) {
      console.error('reminder email failed, will retry', err && (err.code || err.message));
      continue;
    }
    await env.DB.prepare('UPDATE enquiries SET sent = ?, due = ? WHERE id = ?').bind(enquiry.sent + 1, next, enquiry.id).run();
  }
}

// GET shows a button; only the POST from that button stops the reminders,
// so link scanners in email apps can't stop them by accident.
async function stopReminders(request, url, env) {
  const id = url.searchParams.get('id') || '';
  const token = url.searchParams.get('t') || '';
  const enquiry = /^[\w-]{36}$/.test(id) ? await env.DB.prepare('SELECT name, token, due FROM enquiries WHERE id = ?').bind(id).first() : null;
  const valid = enquiry && enquiry.token === token && enquiry.due !== null;

  if (request.method === 'POST') {
    if (valid) await env.DB.prepare('UPDATE enquiries SET due = NULL WHERE id = ?').bind(id).run();
    return htmlPage('Reminders stopped', valid
      ? `<p>You won't get more reminders about <strong>${esc(enquiry.name)}</strong>'s enquiry.</p>`
      : '<p>There are no reminders left for this enquiry.</p>');
  }
  return htmlPage('Stop reminders?', valid
    ? `<p>Stop the remaining reminder emails about <strong>${esc(enquiry.name)}</strong>'s enquiry?</p>
       <form method="post"><button type="submit">Yes, stop reminders</button></form>`
    : '<p>There are no reminders left for this enquiry.</p>');
}

/* ---------------- The email ---------------- */

// `last`: no more reminders will follow this one (the 3-day safety stop).
async function sendEnquiryEmail(env, e, { last = false } = {}) {
  const reminder = e.sent; // 0 for the first email, then 1, 2, 3...
  const isEmail = EMAIL_RE.test(e.contact);
  const wa = isEmail ? '' : whatsappLink(e.contact);
  const when = new Date(e.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const stopUrl = last ? '' : `${env.SITE_URL}/api/enquiry/stop?id=${e.id}&t=${e.token}`;
  const subject = reminder === 0
    ? `New enquiry from ${e.name}`
    : `${last ? 'Last reminder' : `Reminder ${reminder}`}: enquiry from ${e.name}`;
  const banner = reminder === 0 ? '' : last
    ? `Last reminder: this enquiry came in on ${when}. Reminders stop after ${STOP_AFTER_DAYS} days.`
    : `Reminder ${reminder}: this enquiry came in on ${when}.`;
  const schedule = `You'll be reminded every ${REMINDER_EVERY_HOURS} hours (not between 11 pm and 8 am) until you stop the reminders for this enquiry.`;
  const howToReply = isEmail
    ? `Just press Reply to answer ${e.name} at ${e.contact}.`
    : wa
      ? `Chat with ${e.name} on WhatsApp: ${wa.url}${wa.guessed ? ' (country code +91 assumed, as none was given)' : ''}`
      : `Contact ${e.name} at ${e.contact}.`;

  const text = [
    banner ? `${banner}\n` : '',
    `Name: ${e.name}`,
    `${isEmail ? 'Email' : 'Phone'}: ${e.contact}`,
    `Received: ${when} (India time)`,
    '',
    'Message:',
    e.message,
    '',
    howToReply,
    stopUrl ? `\n${schedule}\nAlready handled it? Stop the reminders: ${stopUrl}` : '',
    '\nSent by the contact form on chitwanedits.com',
  ].join('\n');

  const button = (href, label) => `<a href="${esc(href)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#d4ff3a;color:#0b0b0d;font-weight:600;text-decoration:none">${label}</a>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1d1d1f;max-width:560px">
  ${banner ? `<p style="margin:0 0 14px;padding:8px 12px;border-radius:8px;background:#fff4d6">${esc(banner)}</p>` : ''}
  <p style="margin:0 0 4px"><strong>${esc(e.name)}</strong> sent a message through your website.</p>
  <p style="margin:0 0 16px;color:#555">${isEmail ? 'Email' : 'Phone'}: ${esc(e.contact)} · ${esc(when)} (India time)</p>
  <div style="margin:0 0 18px;padding:14px 16px;border-left:3px solid #d4ff3a;background:#f6f6f4;white-space:pre-wrap">${esc(e.message)}</div>
  <p style="margin:0 0 18px">${isEmail
    ? `Just press <strong>Reply</strong> to answer ${esc(e.name)} at ${esc(e.contact)}.`
    : wa
      ? `${button(wa.url, `Chat with ${esc(e.name)} on WhatsApp`)}${wa.guessed ? '<br><span style="color:#777;font-size:13px">Country code +91 assumed, as none was given.</span>' : ''}`
      : `Contact ${esc(e.name)} at ${esc(e.contact)}.`}</p>
  ${stopUrl ? `<p style="margin:0 0 6px;font-size:13px;color:#777">${esc(schedule)}<br>Already handled it? <a href="${esc(stopUrl)}" style="color:#d4ff3a;background:#0b0b0d;padding:2px 8px;border-radius:999px;text-decoration:none">Stop the reminders</a></p>` : ''}
  <p style="margin:0;font-size:12px;color:#999">Sent by the contact form on chitwanedits.com</p>
</div>`;

  await env.EMAIL.send({
    from: { email: env.FROM_ADDRESS, name: `${e.name.replace(/["<>]/g, '')} via Chitwan Edits` },
    to: env.NOTIFY_TO,
    subject,
    text,
    html,
    ...(isEmail ? { replyTo: e.contact } : {}),
  });
}

// wa.me needs the number with its country code. Ten digits without one are taken as Indian.
function whatsappLink(contact) {
  const plus = /^\s*(\+|00)/.test(contact);
  let digits = contact.replace(/\D/g, '');
  if (contact.trim().startsWith('00')) digits = digits.slice(2);
  if (digits.length < 7) return null;
  const guessed = !plus && digits.length === 10;
  return { url: `https://wa.me/${guessed ? `91${digits}` : digits}`, guessed };
}

/* ---------------- Helpers ---------------- */

function clean(value, max, multiline = false) {
  let s = String(value ?? '').trim().slice(0, max);
  if (!multiline) s = s.replace(/\s+/g, ' ');
  return s;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const htmlPage = (title, body) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} | Chitwan Edits</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0d;color:#f4f4f2;font:16px/1.5 system-ui,sans-serif}
main{max-width:420px;padding:32px;text-align:center}h1{font-size:1.4rem}button{margin-top:12px;padding:12px 22px;border:0;border-radius:999px;background:#d4ff3a;color:#0b0b0d;font:inherit;font-weight:600;cursor:pointer}a{color:#d4ff3a}</style>
</head><body><main><h1>${esc(title)}</h1>${body}<p><a href="/">chitwanedits.com</a></p></main></body></html>`, {
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
});
