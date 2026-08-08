package de.nagellacke.domain

import de.nagellacke.domain.model.AppData
import de.nagellacke.domain.model.Manicure
import de.nagellacke.domain.model.Polish
import de.nagellacke.domain.model.Sticker
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.time.temporal.TemporalAdjusters
import java.time.temporal.WeekFields
import java.util.Locale
import kotlin.math.roundToInt

/** Port of v3/apps/web/src/utils/report.ts — kept in sync deliberately (see #149). */
enum class ReportPeriod { Week, Month }

private data class PeriodBounds(val startMs: Long, val endMs: Long, val label: String)

private fun dayStartMs(date: LocalDate): Long =
    LocalDateTime.of(date, LocalTime.MIN).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()

private fun dayEndMs(date: LocalDate): Long =
    LocalDateTime.of(date, LocalTime.MAX).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()

private fun periodBounds(period: ReportPeriod, ref: LocalDate): PeriodBounds = when (period) {
    ReportPeriod.Week -> {
        val monday = ref.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        val sunday = monday.plusDays(6)
        val weekNum = monday.get(WeekFields.ISO.weekOfWeekBasedYear())
        val fmt = DateTimeFormatter.ofPattern("dd.MM", Locale.GERMANY)
        PeriodBounds(
            startMs = dayStartMs(monday),
            endMs   = dayEndMs(sunday),
            label   = "KW $weekNum · ${monday.format(fmt)}–${sunday.format(fmt)} ${monday.year}",
        )
    }
    ReportPeriod.Month -> {
        val start = ref.withDayOfMonth(1)
        val end = start.plusMonths(1).minusDays(1)
        val monthName = start.month.getDisplayName(TextStyle.FULL, Locale.GERMAN)
        PeriodBounds(startMs = dayStartMs(start), endMs = dayEndMs(end), label = "$monthName ${start.year}")
    }
}

private fun stars(rating: Int?): String {
    if (rating == null || rating == 0) return ""
    val full = rating.coerceIn(0, 5)
    return "★".repeat(full) + "☆".repeat(5 - full)
}

private val HEX_COLOR = Regex("^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")
private fun safeColor(color: String?): String = if (color != null && HEX_COLOR.matches(color)) color else "#999999"

private fun escHtml(s: String?): String =
    (s ?: "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

private fun colorDots(colors: List<String>?): String {
    if (colors.isNullOrEmpty()) return ""
    return colors.joinToString("") {
        "<span style=\"display:inline-block;width:12px;height:12px;border-radius:50%;background:${safeColor(it)};border:1px solid rgba(0,0,0,.15);margin-right:2px;vertical-align:middle\"></span>"
    }
}

private fun photoTag(filename: String?, alt: String, photoUrl: (String) -> String?, style: String = ""): String {
    if (filename == null) return ""
    val url = photoUrl(filename) ?: return ""
    return "<img src=\"$url\" alt=\"${escHtml(alt)}\" loading=\"lazy\" style=\"width:100%;height:100%;object-fit:cover;border-radius:8px;$style\" onerror=\"this.style.display='none'\">"
}

private const val REPORT_CSS = """
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Georgia', 'Times New Roman', serif; background: #fdf4f9; color: #2d1b2e; }
    .cover {
      min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; text-align: center;
      background: linear-gradient(160deg, #880e4f 0%, #ad1457 30%, #c2185b 55%, #9c27b0 80%, #6a1b9a 100%);
      color: #fff; padding: 48px 32px; position: relative; overflow: hidden;
    }
    .cover::before {
      content: ''; position: absolute; inset: 0;
      background: radial-gradient(ellipse at 30% 40%, rgba(255,255,255,.12) 0%, transparent 60%),
                  radial-gradient(ellipse at 70% 70%, rgba(255,182,213,.15) 0%, transparent 50%);
    }
    .cover-emoji { font-size: 72px; margin-bottom: 24px; position: relative; }
    .cover-title { font-size: 48px; font-weight: 700; letter-spacing: -1px; position: relative; margin-bottom: 8px; }
    .cover-sub { font-size: 22px; opacity: .85; position: relative; margin-bottom: 32px; }
    .cover-chips { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; position: relative; }
    .chip {
      background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.3);
      border-radius: 20px; padding: 8px 18px; font-size: 15px;
    }
    .chip strong { display: block; font-size: 22px; font-weight: 700; }
    .section { max-width: 860px; margin: 0 auto; padding: 48px 32px; }
    .section-title {
      font-size: 28px; font-weight: 700; color: #880e4f;
      border-bottom: 3px solid #f8bbd0; padding-bottom: 12px; margin-bottom: 28px;
    }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .stat-card {
      background: #fff; border-radius: 16px; padding: 20px 16px; text-align: center;
      box-shadow: 0 2px 12px rgba(136,14,79,.08); border: 1px solid #fce4ec;
    }
    .stat-num { font-size: 40px; font-weight: 700; color: #c2185b; }
    .stat-label { font-size: 13px; color: #ad5d78; margin-top: 4px; font-style: italic; }
    .chart-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .chart-label { width: 120px; font-size: 13px; color: #5d3a4a; text-align: right; flex-shrink: 0; }
    .chart-bar-wrap { flex: 1; background: #fce4ec; border-radius: 6px; height: 20px; overflow: hidden; }
    .chart-bar { height: 100%; border-radius: 6px; background: linear-gradient(90deg, #e91e8c, #c2185b); }
    .chart-val { width: 28px; font-size: 13px; font-weight: 600; color: #880e4f; }
    .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 18px; }
    .polish-card, .sticker-card, .manicure-entry {
      background: #fff; border-radius: 16px; overflow: hidden;
      box-shadow: 0 2px 12px rgba(136,14,79,.08); border: 1px solid #fce4ec;
    }
    .polish-photo, .polish-swatch { height: 140px; }
    .polish-swatch { display: flex; align-items: center; justify-content: center; font-size: 36px; }
    .polish-body { padding: 14px 14px 16px; }
    .polish-name { font-size: 15px; font-weight: 700; color: #2d1b2e; margin-bottom: 2px; }
    .polish-brand { font-size: 12px; color: #9e6b7a; margin-bottom: 6px; }
    .polish-finish {
      display: inline-block; background: #fce4ec; color: #c2185b;
      border-radius: 12px; padding: 2px 10px; font-size: 11px; margin-bottom: 6px;
    }
    .polish-stars { color: #f48fb1; font-size: 14px; margin-bottom: 4px; }
    .polish-notes { font-size: 12px; color: #9e6b7a; font-style: italic; }
    .sticker-photo { height: 130px; background: #fdf4f9; }
    .sticker-body { padding: 12px 14px 14px; }
    .sticker-name { font-size: 14px; font-weight: 700; color: #2d1b2e; }
    .sticker-type { font-size: 11px; color: #9e6b7a; margin-top: 2px; }
    .manicure-entry { padding: 20px; margin-bottom: 20px; }
    .manicure-date { font-size: 18px; font-weight: 700; color: #880e4f; margin-bottom: 12px; }
    .manicure-photos { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
    .manicure-photo-slot { height: 90px; border-radius: 8px; overflow: hidden; background: #fce4ec; }
    .polish-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .polish-chip {
      display: inline-flex; align-items: center; gap: 5px; background: #fce4ec;
      border-radius: 14px; padding: 4px 10px; font-size: 12px; color: #c2185b;
    }
    .polish-chip-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; border: 1px solid rgba(0,0,0,.1); }
    .manicure-notes { font-size: 13px; color: #9e6b7a; font-style: italic; margin-top: 8px; }
    .empty { text-align: center; padding: 32px; color: #ad5d78; font-style: italic; }
"""

/**
 * Renders a self-contained HTML report (cover + stats + new items in [period]), matching
 * `generateReport()` on the web app field-for-field. [photoUrl] resolves a stored filename to a
 * loadable URL (or null if it can't be resolved for the current sync provider) — same contract
 * as [de.nagellacke.ui.collection.PhotoResolution].
 */
fun generateReportHtml(data: AppData, period: ReportPeriod, ref: LocalDate, photoUrl: (String) -> String?): String {
    val bounds = periodBounds(period, ref)
    fun inPeriod(ts: Long) = ts in bounds.startMs..bounds.endMs

    val activePolishes  = data.polishes.filter { it.deletedAt == null }
    val activeStickers  = data.stickers.filter { it.deletedAt == null }
    val activeManicures = data.manicures.filter { it.deletedAt == null }

    val newPolishes = activePolishes.filter { inPeriod(it.createdAt) }
    val newStickers = activeStickers.filter { inPeriod(it.createdAt) }
    val manicures = activeManicures.filter { m ->
        runCatching { inPeriod(dayStartMs(LocalDate.parse(m.date))) }.getOrDefault(false)
    }.sortedByDescending { it.date }

    val ratedPolishes = activePolishes.filter { it.rating > 0 }
    val avgRating = if (ratedPolishes.isNotEmpty()) String.format(Locale.US, "%.1f", ratedPolishes.map { it.rating }.average()) else null

    val finishCounts = activePolishes.flatMap { it.finish }.groupingBy { it.label }.eachCount()
    val topFinishes = finishCounts.entries.sortedByDescending { it.value }.take(5)
    val maxFinish = topFinishes.firstOrNull()?.value ?: 1

    val brandCounts = activePolishes.filter { it.brand.isNotBlank() }.groupingBy { it.brand }.eachCount()
    val topBrands = brandCounts.entries.sortedByDescending { it.value }.take(5)
    val maxBrand = topBrands.firstOrNull()?.value ?: 1

    val periodLabel = if (period == ReportPeriod.Week) "Wochenbericht" else "Monatsbericht"
    val periodNounSuffix = if (period == ReportPeriod.Week) " Woche" else "n Monat"

    val polishCards = if (newPolishes.isNotEmpty()) {
        "<div class=\"cards-grid\">" + newPolishes.joinToString("") { p: Polish ->
            val visual = if (p.photo != null && photoTag(p.photo, p.name, photoUrl).isNotEmpty())
                "<div class=\"polish-photo\">${photoTag(p.photo, p.name, photoUrl)}</div>"
            else
                "<div class=\"polish-swatch\" style=\"background:${safeColor(p.color)}15\">" +
                    "<span style=\"width:48px;height:48px;border-radius:50%;background:${safeColor(p.color)};display:inline-block;box-shadow:0 2px 8px rgba(0,0,0,.2)\"></span></div>"
            """<div class="polish-card">$visual
              <div class="polish-body">
                <div class="polish-name">${escHtml(p.name)}</div>
                <div class="polish-brand">${escHtml(p.brand)}${if (p.num.isNotBlank()) " · ${escHtml(p.num)}" else ""}</div>
                ${p.finish.joinToString(" ") { "<span class=\"polish-finish\">${escHtml(it.label)}</span>" }}
                ${if (p.rating > 0) "<div class=\"polish-stars\">${stars(p.rating)}</div>" else ""}
                ${if (p.notes.isNotBlank()) "<div class=\"polish-notes\">${escHtml(p.notes)}</div>" else ""}
              </div></div>"""
        } + "</div>"
    } else "<div class=\"empty\">Keine neuen Lacke in diesem Zeitraum.</div>"

    val stickerCards = if (newStickers.isNotEmpty()) {
        "<div class=\"cards-grid\">" + newStickers.joinToString("") { s: Sticker ->
            val photo = photoTag(s.photo, s.name, photoUrl, "width:100%;height:100%;object-fit:cover")
            val visual = photo.ifEmpty { "<div style=\"height:100%;display:flex;align-items:center;justify-content:center;font-size:36px;\">✨</div>" }
            """<div class="sticker-card">
              <div class="sticker-photo">$visual</div>
              <div class="sticker-body">
                <div class="sticker-name">${escHtml(s.name)}</div>
                <div class="sticker-type">${escHtml(s.type.label)}${if (s.brand.isNotBlank()) " · ${escHtml(s.brand)}" else ""}</div>
                ${if (s.colors.isNotEmpty()) "<div style=\"margin-top:6px\">${colorDots(s.colors)}</div>" else ""}
                ${if (s.rating > 0) "<div class=\"polish-stars\" style=\"margin-top:4px\">${stars(s.rating)}</div>" else ""}
                ${if (s.notes.isNotBlank()) "<div class=\"polish-notes\">${escHtml(s.notes)}</div>" else ""}
              </div></div>"""
        } + "</div>"
    } else "<div class=\"empty\">Keine neuen Sticker in diesem Zeitraum.</div>"

    val manicureEntries = if (manicures.isNotEmpty()) {
        manicures.joinToString("") { m: Manicure ->
            val slots = listOfNotNull(m.photos.fingerRight, m.photos.fingerLeft, m.photos.thumbRight, m.photos.thumbLeft, m.photo)
            val displayPhotos = slots.take(4)
            val photosHtml = if (displayPhotos.isNotEmpty()) {
                "<div class=\"manicure-photos\">" +
                    displayPhotos.joinToString("") { f -> "<div class=\"manicure-photo-slot\">${photoTag(f, "Maniküre-Foto", photoUrl)}</div>" } +
                    (0 until (4 - displayPhotos.size)).joinToString("") { "<div class=\"manicure-photo-slot\"></div>" } +
                    "</div>"
            } else ""
            val polishChips = if (m.polishRefs.isNotEmpty())
                m.polishRefs.joinToString("") { r -> "<span class=\"polish-chip\"><span class=\"polish-chip-dot\" style=\"background:${safeColor(r.color)}\"></span>${escHtml(r.name)}</span>" }
            else
                m.polishIds.joinToString("") { n -> "<span class=\"polish-chip\">${escHtml(n)}</span>" }
            val dateLabel = runCatching {
                LocalDate.parse(m.date).format(DateTimeFormatter.ofPattern("EEEE, dd. MMMM yyyy", Locale.GERMAN))
            }.getOrDefault(m.date)
            """<div class="manicure-entry">
              <div class="manicure-date">${escHtml(dateLabel)}</div>
              $photosHtml
              ${if (polishChips.isNotEmpty()) "<div class=\"polish-chips\">$polishChips</div>" else ""}
              ${if (m.notes.isNotBlank()) "<div class=\"manicure-notes\">${escHtml(m.notes)}</div>" else ""}
            </div>"""
        }
    } else "<div class=\"empty\">Keine Maniküren in diesem Zeitraum.</div>"

    val finishRows = topFinishes.joinToString("") { (finish, count) ->
        """<div class="chart-row">
          <div class="chart-label">${escHtml(finish)}</div>
          <div class="chart-bar-wrap"><div class="chart-bar" style="width:${(count * 100.0 / maxFinish).roundToInt()}%"></div></div>
          <div class="chart-val">$count</div>
        </div>"""
    }
    val brandRows = topBrands.joinToString("") { (brand, count) ->
        """<div class="chart-row">
          <div class="chart-label">${escHtml(brand)}</div>
          <div class="chart-bar-wrap"><div class="chart-bar" style="width:${(count * 100.0 / maxBrand).roundToInt()}%;background:linear-gradient(90deg,#9c27b0,#7b1fa2)"></div></div>
          <div class="chart-val">$count</div>
        </div>"""
    }

    val generatedAt = LocalDate.now().format(DateTimeFormatter.ofPattern("dd. MMMM yyyy", Locale.GERMAN))

    return """<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nagellacke $periodLabel · ${bounds.label}</title>
  <style>$REPORT_CSS</style>
</head>
<body>
  <div class="cover">
    <div class="cover-emoji">💅</div>
    <div class="cover-title">Nagellacke</div>
    <div class="cover-sub">$periodLabel · ${bounds.label}</div>
    <div class="cover-chips">
      <div class="chip"><strong>${newPolishes.size}</strong> neue Lacke</div>
      <div class="chip"><strong>${newStickers.size}</strong> neue Sticker</div>
      <div class="chip"><strong>${manicures.size}</strong> Maniküren</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">📊 Sammlung im Überblick</div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-num">${activePolishes.size}</div><div class="stat-label">Lacke gesamt</div></div>
      <div class="stat-card"><div class="stat-num">${activeStickers.size}</div><div class="stat-label">Sticker gesamt</div></div>
      <div class="stat-card"><div class="stat-num">${activeManicures.size}</div><div class="stat-label">Maniküren gesamt</div></div>
      ${if (avgRating != null) "<div class=\"stat-card\"><div class=\"stat-num\">$avgRating</div><div class=\"stat-label\">⌀ Bewertung ★</div></div>" else ""}
    </div>
    ${if (topFinishes.isNotEmpty()) "<div style=\"margin-bottom:32px\"><div style=\"font-size:15px;font-weight:600;color:#880e4f;margin-bottom:14px\">Top Finishes</div>$finishRows</div>" else ""}
    ${if (topBrands.isNotEmpty()) "<div><div style=\"font-size:15px;font-weight:600;color:#880e4f;margin-bottom:14px\">Top Marken</div>$brandRows</div>" else ""}
  </div>

  <div class="section" style="background:#fff9fc">
    <div class="section-title">🧴 Neue Lacke diese$periodNounSuffix</div>
    $polishCards
  </div>

  <div class="section">
    <div class="section-title">✨ Neue Sticker diese$periodNounSuffix</div>
    $stickerCards
  </div>

  <div class="section" style="background:#fff9fc">
    <div class="section-title">💅 Maniküren diese$periodNounSuffix</div>
    $manicureEntries
  </div>

  <div style="text-align:center;padding:24px 32px 48px;color:#ad5d78;font-size:12px;font-style:italic">
    Erstellt am $generatedAt · Nagellacke
  </div>
</body>
</html>"""
}
