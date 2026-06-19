# AutoClaudeFail — Unimplemented Parts of Issue #30 (Weekly/Monthly Reports)

This file documents the parts of the "Weekly / Monthly Reports" feature request that were **not implemented** and why.

---

## What WAS implemented

A client-side HTML report generator (`v3/apps/web/src/utils/report.ts`) with:
- **Cover page** with gradient design, period label, and summary statistics
- **Stats overview** with total polishes/stickers/manicures, bar charts for top finishes and brands
- **New polishes this week/month** with photo or color swatch, brand, finish, rating, and notes
- **New stickers this week/month** with photo, type, colors, and notes
- **Manicure diary entries** for the period with all photos, polish/sticker chips, and notes
- A "Save as PDF" button using the browser's native print-to-PDF dialog
- Accessible from **Settings → Berichte** in the web app
- Period selector (week/month) and date picker

---

## What was NOT implemented and why

### 1. Email delivery

**Requested:** "sent via email"

**Why not done:**
- The nagellacke server has no email infrastructure. There is no SMTP configuration, no email library installed, and no concept of user email addresses in the user schema (`username` + `password_hash` only — see `v3/server/src/db.ts`).
- Adding email requires: an SMTP library (e.g. `nodemailer`), new env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`), storing the recipient address, and handling TLS/authentication for various email providers.
- This is a substantial feature addition that goes beyond report generation.

**To implement this later:**
1. Install `nodemailer` in `v3/server/`
2. Add email address field to the user schema in `v3/server/src/db.ts`
3. Add a settings UI for SMTP config and recipient email
4. Add a `POST /api/reports/email` endpoint that generates the HTML report server-side and sends it via nodemailer
5. Store SMTP settings in `DATA_DIR` or environment variables

---

### 2. Automatic end-of-week/month scheduling

**Requested:** "available for download at the end of the week/month"

**Why not done:**
- The nagellacke server is a stateless Fastify HTTP server with no built-in scheduler, cron, or job queue.
- Automatic delivery would require either:
  - A system-level cron job (outside the app) calling an API endpoint
  - An in-process scheduler (e.g. `node-cron`) running inside the Fastify server
- This also depends on email delivery being implemented first.

**To implement this later:**
1. Install `node-cron` in `v3/server/`
2. Add a cron job in `v3/server/src/index.ts` that fires on the last day of each week/month
3. The cron job calls the report generation logic and sends the email via nodemailer
4. Add a settings endpoint to enable/disable scheduled reports
5. Add a `REPORT_SCHEDULE=weekly|monthly|both|none` env var (default: `none`)

---

### 3. "Beautifully designed" PDF with full graphic design

**Requested:** "Beautifully designed"

**Why partially done:**
- The implemented report uses styled HTML with a pink gradient cover, bar charts, card layouts, and structured typography — it looks clean and polished.
- However, "beautifully designed" is subjective. A pixel-perfect, design-agency-quality PDF would require:
  - A headless browser (Puppeteer/Playwright) to render HTML → PDF server-side for consistent cross-browser output
  - A dedicated graphic design (fonts, color palette decisions, layout specifications)
  - Proper print CSS fine-tuning across different browsers/OS combinations
- The current implementation relies on the browser's native print-to-PDF, which varies slightly between Chrome, Firefox, and Safari.

**To improve the design later:**
1. Install `puppeteer` in `v3/server/`
2. Add a `POST /api/reports/pdf` endpoint that renders the HTML report via Puppeteer and returns a proper PDF binary (`application/pdf`)
3. The web app's "Bericht erstellen" button can then trigger a download of the server-generated PDF directly
4. This gives consistent PDF output regardless of browser

---

### 4. Android app integration

**Requested:** (implied by the app being multi-platform)

**Why not done:**
- The Android app (`android/`) is a separate native Kotlin/Jetpack Compose codebase.
- Adding report generation there would require a dedicated Android PDF library (e.g. Android's built-in `PdfDocument` API or iText).
- This is out of scope for a web-focused implementation.

---

## Summary table

| Feature | Status | Blocker |
|---|---|---|
| PDF report with stats, polishes, stickers, diary | ✅ Done | — |
| Photos included in report | ✅ Done | — |
| Download at any time (on demand) | ✅ Done | — |
| "Beautifully designed" (clean HTML/print) | ✅ Partial | No headless browser / design spec |
| Email delivery | ❌ Not done | No SMTP infrastructure |
| Automatic end-of-week/month delivery | ❌ Not done | No scheduler + depends on email |
| Consistent server-rendered PDF binary | ❌ Not done | Puppeteer not installed |
| Android app report | ❌ Not done | Different codebase (Kotlin) |
