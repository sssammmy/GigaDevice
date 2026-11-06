/**
 * GigaDevice CES booking site: Gmail email relay
 *
 * Render's free plan blocks normal email (SMTP). This small Google Apps Script
 * sends the booking emails from your own Gmail account instead.
 *
 * Setup (about 5 minutes):
 * 1. Go to https://script.google.com while signed in to the Gmail account
 *    that should send the emails. Click New project.
 * 2. Delete the sample code and paste this whole file.
 * 3. Change SECRET below to a long random phrase. Use the same value for
 *    GMAIL_SCRIPT_SECRET in Render.
 * 4. Click Deploy, then New deployment. Select type Web app.
 *    Execute as: Me. Who has access: Anyone. Click Deploy.
 * 5. Google asks you to authorize. Choose your account, click Advanced,
 *    then Go to project (unsafe), then Allow. This is your own script.
 * 6. Copy the Web app URL (ends in /exec). Use it for GMAIL_SCRIPT_URL in Render.
 *
 * If you edit this script later, use Deploy, Manage deployments, edit the
 * existing deployment, and choose New version so the URL stays the same.
 */

const SECRET = 'change-this-to-a-long-random-phrase';

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'Invalid request' });
  }
  if (SECRET === 'change-this-to-a-long-random-phrase') {
    return reply({ ok: false, error: 'Set SECRET in the Apps Script first' });
  }
  if (data.secret !== SECRET) {
    return reply({ ok: false, error: 'Secret does not match GMAIL_SCRIPT_SECRET' });
  }
  if (!data.to || !data.subject) {
    return reply({ ok: false, error: 'Missing recipient or subject' });
  }

  const options = { name: data.fromName || 'GigaDevice Americas' };
  if (data.replyTo) options.replyTo = data.replyTo;
  if (data.attachments && data.attachments.length) {
    options.attachments = data.attachments.map(function (a) {
      return Utilities.newBlob(a.content, a.contentType || 'text/plain', a.filename);
    });
  }

  try {
    MailApp.sendEmail(data.to, data.subject, data.text || '', options);
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message ? err.message : err) });
  }
  return reply({ ok: true, remainingToday: MailApp.getRemainingDailyQuota() });
}

function doGet() {
  return reply({ ok: true, message: 'Gmail relay is running.' });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor if Google does not prompt you to authorize.
function authorize() {
  MailApp.getRemainingDailyQuota();
}
