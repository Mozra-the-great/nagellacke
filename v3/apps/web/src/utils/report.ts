import type { AppData, Polish, Sticker, Manicure } from '@nagellacke/core';

function getPeriodBounds(period: 'week' | 'month', ref: Date): { start: Date; end: Date; label: string } {
  const d = new Date(ref);
  if (period === 'week') {
    const day = d.getDay(); // 0=Sun,1=Mon,...
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    const fmt = (dt: Date) => dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    return { start: monday, end: sunday, label: `KW ${getWeekNumber(monday)} · ${fmt(monday)}–${fmt(sunday)} ${monday.getFullYear()}` };
  } else {
    const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    const label = d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    return { start, end, label };
  }
}

function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function stars(rating: number | undefined): string {
  if (!rating) return '';
  const full = Math.round(rating);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function colorDots(colors: string[] | undefined): string {
  if (!colors?.length) return '';
  return colors.map(c => `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${c};border:1px solid rgba(0,0,0,.15);margin-right:2px;vertical-align:middle"></span>`).join('');
}

function photoTag(filename: string | undefined | null, alt: string, style = ''): string {
  if (!filename) return '';
  return `<img src="/photos/${encodeURIComponent(filename)}" alt="${alt}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:8px;${style}" onerror="this.style.display='none'">`;
}

export function generateReport(data: AppData, period: 'week' | 'month', ref: Date): string {
  const { start, end, label } = getPeriodBounds(period, ref);

  const inPeriod = (ts: number) => ts >= start.getTime() && ts <= end.getTime();

  const newPolishes  = data.polishes.filter(p => !p.deletedAt && inPeriod(p.createdAt));
  const newStickers  = data.stickers.filter(s => !s.deletedAt && inPeriod(s.createdAt));
  const manicures    = data.manicures.filter(m => !m.deletedAt && inPeriod(new Date(m.date).getTime()));

  const totalPolishes  = data.polishes.filter(p => !p.deletedAt).length;
  const totalStickers  = data.stickers.filter(s => !s.deletedAt).length;
  const totalManicures = data.manicures.filter(m => !m.deletedAt).length;

  const ratedPolishes = data.polishes.filter(p => !p.deletedAt && p.rating);
  const avgRating = ratedPolishes.length
    ? (ratedPolishes.reduce((s, p) => s + (p.rating ?? 0), 0) / ratedPolishes.length).toFixed(1)
    : null;

  const finishCounts: Record<string, number> = {};
  for (const p of data.polishes.filter(p => !p.deletedAt)) {
    finishCounts[p.finish] = (finishCounts[p.finish] ?? 0) + 1;
  }
  const topFinishes = Object.entries(finishCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxFinish = topFinishes[0]?.[1] ?? 1;

  const brandCounts: Record<string, number> = {};
  for (const p of data.polishes.filter(p => !p.deletedAt)) {
    if (p.brand) brandCounts[p.brand] = (brandCounts[p.brand] ?? 0) + 1;
  }
  const topBrands = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxBrand = topBrands[0]?.[1] ?? 1;

  const periodLabel = period === 'week' ? 'Woche' : 'Monat';

  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Georgia', 'Times New Roman', serif; background: #fdf4f9; color: #2d1b2e; }
    .save-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 999;
      background: linear-gradient(135deg, #e91e8c, #9c27b0);
      color: #fff; border: none; border-radius: 28px; padding: 14px 28px;
      font-size: 15px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 20px rgba(233,30,140,.4);
      display: flex; align-items: center; gap: 8px;
    }
    .save-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 24px rgba(233,30,140,.5); }

    /* ── Cover ── */
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
      border-radius: 20px; padding: 8px 18px; font-size: 15px; backdrop-filter: blur(8px);
    }
    .chip strong { display: block; font-size: 22px; font-weight: 700; }

    /* ── Sections ── */
    .section { max-width: 860px; margin: 0 auto; padding: 48px 32px; }
    .section-title {
      font-size: 28px; font-weight: 700; color: #880e4f;
      border-bottom: 3px solid #f8bbd0; padding-bottom: 12px; margin-bottom: 28px;
    }

    /* ── Stats ── */
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

    /* ── Polish cards ── */
    .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 18px; }
    .polish-card {
      background: #fff; border-radius: 16px; overflow: hidden;
      box-shadow: 0 2px 12px rgba(136,14,79,.08); border: 1px solid #fce4ec;
    }
    .polish-photo { height: 140px; position: relative; overflow: hidden; }
    .polish-swatch { height: 140px; display: flex; align-items: center; justify-content: center; font-size: 36px; }
    .polish-body { padding: 14px 14px 16px; }
    .polish-name { font-size: 15px; font-weight: 700; color: #2d1b2e; margin-bottom: 2px; }
    .polish-brand { font-size: 12px; color: #9e6b7a; margin-bottom: 6px; }
    .polish-finish {
      display: inline-block; background: #fce4ec; color: #c2185b;
      border-radius: 12px; padding: 2px 10px; font-size: 11px; margin-bottom: 6px;
    }
    .polish-stars { color: #f48fb1; font-size: 14px; margin-bottom: 4px; }
    .polish-notes { font-size: 12px; color: #9e6b7a; font-style: italic; }

    /* ── Sticker cards ── */
    .sticker-card {
      background: #fff; border-radius: 16px; overflow: hidden;
      box-shadow: 0 2px 12px rgba(136,14,79,.08); border: 1px solid #fce4ec;
    }
    .sticker-photo { height: 130px; position: relative; overflow: hidden; background: #fdf4f9; }
    .sticker-body { padding: 12px 14px 14px; }
    .sticker-name { font-size: 14px; font-weight: 700; color: #2d1b2e; }
    .sticker-type { font-size: 11px; color: #9e6b7a; margin-top: 2px; }

    /* ── Manicure entries ── */
    .manicure-entry {
      background: #fff; border-radius: 16px; padding: 20px;
      box-shadow: 0 2px 12px rgba(136,14,79,.08); border: 1px solid #fce4ec;
      margin-bottom: 20px;
    }
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

    /* ── Empty state ── */
    .empty { text-align: center; padding: 32px; color: #ad5d78; font-style: italic; }

    /* ── Page breaks for print ── */
    @media print {
      .save-btn { display: none !important; }
      .cover { min-height: auto; padding: 60px 40px; page-break-after: always; }
      .section { page-break-inside: avoid; }
      .polish-card, .sticker-card, .manicure-entry { page-break-inside: avoid; }
    }
  `;

  const polishCards = newPolishes.length
    ? `<div class="cards-grid">${newPolishes.map((p: Polish) => `
      <div class="polish-card">
        ${p.photo
          ? `<div class="polish-photo">${photoTag(p.photo, p.name)}</div>`
          : `<div class="polish-swatch" style="background:${p.color}15">
               <span style="width:48px;height:48px;border-radius:50%;background:${p.color};display:inline-block;box-shadow:0 2px 8px rgba(0,0,0,.2)"></span>
             </div>`}
        <div class="polish-body">
          <div class="polish-name">${escHtml(p.name)}</div>
          <div class="polish-brand">${escHtml(p.brand)}${p.num ? ` · ${escHtml(p.num)}` : ''}</div>
          <span class="polish-finish">${escHtml(p.finish)}</span>
          ${p.rating ? `<div class="polish-stars">${stars(p.rating)}</div>` : ''}
          ${p.notes ? `<div class="polish-notes">${escHtml(p.notes)}</div>` : ''}
        </div>
      </div>`).join('')}</div>`
    : `<div class="empty">Keine neuen Lacke in diesem Zeitraum.</div>`;

  const stickerCards = newStickers.length
    ? `<div class="cards-grid">${newStickers.map((s: Sticker) => `
      <div class="sticker-card">
        <div class="sticker-photo">${photoTag(s.photo, s.name, 'width:100%;height:100%;object-fit:cover') || '<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:36px;">✨</div>'}</div>
        <div class="sticker-body">
          <div class="sticker-name">${escHtml(s.name)}</div>
          <div class="sticker-type">${escHtml(s.type)}${s.brand ? ` · ${escHtml(s.brand)}` : ''}</div>
          ${s.colors?.length ? `<div style="margin-top:6px">${colorDots(s.colors)}</div>` : ''}
          ${s.rating ? `<div class="polish-stars" style="margin-top:4px">${stars(s.rating)}</div>` : ''}
          ${s.notes ? `<div class="polish-notes">${escHtml(s.notes)}</div>` : ''}
        </div>
      </div>`).join('')}</div>`
    : `<div class="empty">Keine neuen Sticker in diesem Zeitraum.</div>`;

  const manicureEntries = manicures.length
    ? manicures.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((m: Manicure) => {
        const photoSlots = [m.photos?.fingerRight, m.photos?.fingerLeft, m.photos?.thumbRight, m.photos?.thumbLeft, m.photo].filter(Boolean) as string[];
        const displayPhotos = photoSlots.slice(0, 4);

        const polishChips = m.polishRefs?.length
          ? m.polishRefs.map(r => `<span class="polish-chip"><span class="polish-chip-dot" style="background:${r.color ?? '#ccc'}"></span>${escHtml(r.name)}</span>`).join('')
          : (m.polishes ?? []).map(n => `<span class="polish-chip">${escHtml(n)}</span>`).join('');

        return `<div class="manicure-entry">
          <div class="manicure-date">${new Date(m.date).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div>
          ${displayPhotos.length ? `
            <div class="manicure-photos">
              ${displayPhotos.map(f => `<div class="manicure-photo-slot">${photoTag(f, 'Maniküre-Foto')}</div>`).join('')}
              ${Array.from({ length: 4 - displayPhotos.length }, () => '<div class="manicure-photo-slot"></div>').join('')}
            </div>` : ''}
          ${polishChips ? `<div class="polish-chips">${polishChips}</div>` : ''}
          ${m.notes ? `<div class="manicure-notes">${escHtml(m.notes)}</div>` : ''}
        </div>`;
      }).join('')
    : `<div class="empty">Keine Maniküren in diesem Zeitraum.</div>`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nagellacke ${periodLabel}sbericht · ${label}</title>
  <style>${css}</style>
</head>
<body>
  <button class="save-btn" onclick="window.print()">🖨 Als PDF speichern</button>

  <!-- Cover -->
  <div class="cover">
    <div class="cover-emoji">💅</div>
    <div class="cover-title">Nagellacke</div>
    <div class="cover-sub">${periodLabel}sbericht · ${label}</div>
    <div class="cover-chips">
      <div class="chip"><strong>${newPolishes.length}</strong> neue Lacke</div>
      <div class="chip"><strong>${newStickers.length}</strong> neue Sticker</div>
      <div class="chip"><strong>${manicures.length}</strong> Maniküren</div>
    </div>
  </div>

  <!-- Stats Overview -->
  <div class="section">
    <div class="section-title">📊 Sammlung im Überblick</div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-num">${totalPolishes}</div><div class="stat-label">Lacke gesamt</div></div>
      <div class="stat-card"><div class="stat-num">${totalStickers}</div><div class="stat-label">Sticker gesamt</div></div>
      <div class="stat-card"><div class="stat-num">${totalManicures}</div><div class="stat-label">Maniküren gesamt</div></div>
      ${avgRating ? `<div class="stat-card"><div class="stat-num">${avgRating}</div><div class="stat-label">⌀ Bewertung ★</div></div>` : ''}
    </div>

    ${topFinishes.length ? `
    <div style="margin-bottom:32px">
      <div style="font-size:15px;font-weight:600;color:#880e4f;margin-bottom:14px">Top Finishes</div>
      ${topFinishes.map(([finish, count]) => `
        <div class="chart-row">
          <div class="chart-label">${escHtml(finish)}</div>
          <div class="chart-bar-wrap"><div class="chart-bar" style="width:${Math.round((count / maxFinish) * 100)}%"></div></div>
          <div class="chart-val">${count}</div>
        </div>`).join('')}
    </div>` : ''}

    ${topBrands.length ? `
    <div>
      <div style="font-size:15px;font-weight:600;color:#880e4f;margin-bottom:14px">Top Marken</div>
      ${topBrands.map(([brand, count]) => `
        <div class="chart-row">
          <div class="chart-label">${escHtml(brand)}</div>
          <div class="chart-bar-wrap"><div class="chart-bar" style="width:${Math.round((count / maxBrand) * 100)}%;background:linear-gradient(90deg,#9c27b0,#7b1fa2)"></div></div>
          <div class="chart-val">${count}</div>
        </div>`).join('')}
    </div>` : ''}
  </div>

  <!-- New Polishes -->
  <div class="section" style="background:#fff9fc">
    <div class="section-title">🧴 Neue Lacke diese${period === 'week' ? ' Woche' : 'n Monat'}</div>
    ${polishCards}
  </div>

  <!-- New Stickers -->
  <div class="section">
    <div class="section-title">✨ Neue Sticker diese${period === 'week' ? ' Woche' : 'n Monat'}</div>
    ${stickerCards}
  </div>

  <!-- Manicure Diary -->
  <div class="section" style="background:#fff9fc">
    <div class="section-title">💅 Maniküren diese${period === 'week' ? ' Woche' : 'n Monat'}</div>
    ${manicureEntries}
  </div>

  <div style="text-align:center;padding:24px 32px 48px;color:#ad5d78;font-size:12px;font-style:italic">
    Erstellt am ${new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })} · Nagellacke
  </div>
</body>
</html>`;
}

function escHtml(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
