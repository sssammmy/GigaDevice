# GigaDevice Americas CES Meeting Booking

Public website where customers and GigaDevice RSMs book meetings with the GigaDevice Americas team at CES.

## What it does

* Branded landing page with event dates, hotel and meeting suite
* Two booking paths: customers book for themselves, RSMs book on behalf of a customer
* Live slot availability across multiple meeting rooms with no double booking
* Confirmation page, calendar invite (.ics) and a private link to view or cancel
* Optional confirmation emails to the customer and RSM, plus a copy to the internal team
* Password protected admin dashboard at `/admin` with filters, room schedule, cancel and CSV export

## Run locally

Requires Node.js 20 or newer.

```
npm install
cp .env.example .env      # set ADMIN_PASSWORD at minimum
npm start
```

Open http://localhost:3000 for the public site and http://localhost:3000/admin for the dashboard (user `admin`, password from `ADMIN_PASSWORD`).

Run tests with `npm test`.

## Customize the event

Edit `config/event.json` and restart.

| Setting | Purpose |
| --- | --- |
| `eventName`, `tagline`, `venue`, `address`, `suite` | Text shown on the site and in invites. Put the suite number in `suite` once known, for example "Suite 2410" |
| `days` | Each show day with start and end time (Las Vegas local time) |
| `slotMinutes` | Meeting length |
| `rooms` | Meeting rooms. Set to one room, so each time slot can be booked only once. Add rooms to allow meetings at the same time |
| `blockedSlots` | Times to close, such as lunch |
| `topics` | Topic choices on the form |
| `regions` | RSM region choices |
| `contactEmail` | Shown in the header, footer and emails |

CES 2027 dates are preset to January 6 to 9, 2027. Meetings are in a private suite at Fontainebleau Las Vegas. Confirm the dates and add the suite number before launch.

## Branding

The header uses the official GigaDevice mark and white wordmark from `public/assets`. Replace those files to change the logo. Brand colors are defined at the top of `public/styles.css`.

## Email

Render's free plan blocks normal email (SMTP), so the site sends email through a small Google Apps Script that uses your own Gmail account. It is free and allows about 100 recipients a day.

1. Sign in to the Gmail account that should send the emails and open https://script.google.com. Click New project.
2. Paste the contents of `tools/gmail-relay.gs`. Change `SECRET` to a long random phrase. Save.
3. Click Deploy, then New deployment, type Web app. Set Execute as Me and Who has access Anyone. Click Deploy and allow access when Google asks. On the warning screen click Advanced, then Go to project.
4. Copy the Web app URL that ends in `/exec`.
5. In Render, open the service, then Environment, and add:
   * `GMAIL_SCRIPT_URL` with the Web app URL
   * `GMAIL_SCRIPT_SECRET` with the same phrase as `SECRET`
   * `NOTIFY_EMAILS` with your address. Separate several with commas.
6. Save. After the restart, open `/admin` and click Send test email.

The admin page shows whether email is on, who gets alerts, and the last emails sent or failed with the reason.

What gets sent:
* Every address in `NOTIFY_EMAILS` gets an alert for each new booking and cancellation
* The customer and the RSM get a confirmation with a calendar invite and a cancel link, and a notice if the meeting is cancelled. When you cancel from the admin page, choose OK on the second prompt to email them

On hosts that allow SMTP you can use the `SMTP_*` settings instead.

## Deploy for free

Free setup: Render hosts the site at a free web address like `https://gigadevice-ces.onrender.com`. Turso stores the bookings for free, because Render's free plan erases local files on every restart.

**Step 1. Create the free database (Turso)**

1. Sign up at https://turso.tech (GitHub login works).
2. Create a database, for example `gigadevice-ces`.
3. Copy the database URL. It starts with `libsql://`.
4. Create a database token and copy it.

**Step 2. Create the free site (Render)**

1. Sign up at https://render.com with your GitHub account.
2. Click New, then Blueprint, and pick the `sssammmy/GigaDevice` repo. Render reads `render.yaml`.
3. When asked, fill in:
   * `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from step 1
   * `ADMIN_PASSWORD`, a strong password for `/admin`
   * Email settings can be left blank for now. See the Email section
4. Click Apply. In a few minutes the site is live at `https://gigadevice-ces.onrender.com`. If that name is taken, Render adds a few characters. The final address is shown at the top of the service page.

**Step 3. Keep it awake (optional, free)**

Free Render sites go to sleep after 15 minutes without visitors, and the next visitor waits about a minute. To prevent this, create a free monitor at https://uptimerobot.com that checks `https://<your-site>.onrender.com/api/config` every 5 minutes. One always-on site fits within Render's free monthly hours.

**Step 4. Branded address (optional)**

For an address like `ces.gigadevice.com`, ask your IT team to add a CNAME record pointing to your onrender.com address, then add the custom domain under Settings in Render. This costs nothing if the company domain already exists.

**Updating the site.** Any change pushed to `main` redeploys automatically. Bookings are kept in Turso.

**Other hosting.** The included Dockerfile runs anywhere. Without Turso settings it stores bookings in `data/bookings.db`, so mount that folder on a persistent volume.

## Sharing with RSMs

Send RSMs the link with `?type=rsm` added, for example `https://ces.example.com/?type=rsm`. The form opens with the RSM path selected.

## Backups

Use Export CSV in the admin dashboard for a quick snapshot. Bookings live in Turso when configured, otherwise in the file at `DB_PATH`.
