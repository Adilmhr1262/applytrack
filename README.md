# ApplyTrack

Every application. One clear place.

ApplyTrack is a privacy-first job application tracker. It runs as a single static website with no backend, no account, and no server. All records stay in your own browser, stored in IndexedDB, so they survive reloads and browser restarts.

## What it does

- Dashboard with totals, active applications, interviews, offers, pipeline counts, overdue and upcoming follow-ups, and recent activity.
- Applications list with search by company or job title, status filter, and sorting by newest, oldest, or next follow-up.
- Add and edit applications: company, job title, location, job posting URL, application date, salary, notes, status, and follow-up date.
- Pipeline statuses: Saved, Applied, Screening, Interview, Offer, Rejected, Withdrawn.
- Status history: every status change is recorded with a date, and shown on the edit page and in recent activity.
- Quick actions on each application: change status in place, edit, duplicate, delete (with confirmation), and open the original job listing.
- Backup and restore: export all records as one JSON file, and import a backup with full validation. An invalid backup changes nothing.
- Preferences: default status for new applications and default sort order, saved in the browser.
- Clear all data, with confirmation, from Settings.

## How to use it

Open `index.html` in a browser, or serve the folder with any static file server. No build step and no installation are needed.

1. Go to Add application and save your first application.
2. Set a follow-up date to see it on the Dashboard.
3. Use Applications to search, filter, and update records.
4. Use Settings to export a backup before clearing data or moving browsers.

## Data and privacy

- Storage: IndexedDB (database `ApplyTrackDB`), plus a small preferences entry in localStorage.
- Nothing is uploaded, synced, or sent to any server. The only network request is the Google Fonts stylesheet for Plus Jakarta Sans and Inter; if fonts cannot load, the site falls back to system fonts and still works.
- User-entered text is rendered as plain text, never as HTML, so markup typed into a field is shown literally.
- Imported JSON is validated record by record before any existing data is replaced, including its version (only version 1), its status history, and its created dates. Replacement itself runs in a single IndexedDB transaction, so a failed write leaves the old data untouched.

## Files

- `index.html` — structure for Dashboard, Applications, Add/Edit, and Settings.
- `style.css` — layout, including a desktop sidebar and bottom navigation on mobile.
- `app.js` — all application logic, IndexedDB storage, validation, and rendering.
