import type { AppData, Polish, Sticker, Manicure } from '@nagellacke/core';

export type ReportPeriod = 'week' | 'month';

interface PeriodBounds {
  start: Date;
  end: Date;
  label: string;
  shortLabel: string;
}

function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export function getPeriodBounds(period: ReportPeriod, refDate: Date): PeriodBounds {
  if (period === 'week') {
    const day = refDate.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const start = new Date(refDate);
    start.setDate(refDate.getDate() + diff);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    const label = `Kalenderwoche ${getWeekNumber(start)}, ${start.getFullYear()}`;
    const shortLabel = `KW${getWeekNumber(start)}/${start.getFullYear()}`;
    return { start, end, label, shortLabel };
  } else {
    const start = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
    const end = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0, 23, 59, 59, 999);
    const label = refDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    const shortLabel = refDate.toLocaleDateString('de-DE', { month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
    return { start, end, label, shortLabel };
  }
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function photoUrl(filename: string): string {
  return `${window.location.origin}/photos/${encodeURIComponent(filename)}`;
}

function fmtDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('de-DE', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function fmtDateShort(date: Date): string {
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function stars(rating?: number): string {
  if (!rating) return '';
  const n = Math.round(Math.min(5, Math.max(1, rating)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function active<T extends { deletedAt?: number }>(items: T[]): T[] {
  return items.filter(i => !i.deletedAt);
}

function inPeriod(ts: number, start: Date, end: Date): boolean {
  return ts >= start.getTime() && ts <= end.getTime();
}

function renderPolishCard(p: Polish): string {
  const visual = p.photo
    ? `<img class="card-img" src="${photoUrl(p.photo)}" alt="${esc(p.name)}" loading="lazy" />`
    : `<div class="card-swatch" style="background:${esc(p.color)};"></div>`;
  return `
    <div class="card">
      ${visual}
      <div class="card-body">
        <div class="card-name">${esc(p.name)}</div>
        <div class="card-sub">${esc(p.brand)}${p.num ? ` · #${esc(p.num)}` : ''}</div>
        <div class="card-tags">
          <span class="tag">${esc(p.finish)}</span>
          ${p.rating ? `<span class="tag-stars">${stars(p.rating)}</span>` : ''}
        </div>
        ${p.notes ? `<div class="card-notes">${esc(p.notes)}</div>` : ''}
      </div>
    </div>`;
}

function renderStickerCard(s: Sticker): string {
  const visual = s.photo
    ? `<img class="card-img" src="${photoUrl(s.photo)}" alt="${esc(s.name)}" loading="lazy" />`
    : `<div class="card-swatch card-swatch--sticker">✦</div>`;
  const colorDots = (s.colors ?? [])
    .map(c => `<span class="color-dot" style="background:${esc(c)};"></span>`)
    .join('');
  return `
    <div class="card">
      ${visual}
      <div class="card-body">
        <div class="card-name">${esc(s.name)}</div>
        ${s.brand ? `<div class="card-sub">${esc(s.brand)}</div>` : ''}
        <div class="card-tags">
          <span class="tag">${esc(s.type)}</span>
          ${colorDots}
        </div>
        ${s.notes ? `<div class="card-notes">${esc(s.notes)}</div>` : ''}
      </div>
    </div>`;
}

function renderManicureEntry(m: Manicure): string {
  const photoSlots: string[] = [];
  if (m.photos) {
    for (const slot of ['fingerRight', 'fingerLeft', 'thumbRight', 'thumbLeft'] as const) {
      const f = m.photos[slot];
      if (f) photoSlots.push(`<img class="diary-photo" src="${photoUrl(f)}" alt="${slot}" loading="lazy" />`);
    }
  }
  if (m.photo && photoSlots.length === 0) {
    photoSlots.push(`<img class="diary-photo" src="${photoUrl(m.photo)}" alt="Foto" loading="lazy" />`);
  }

  const polishChips = m.polishRefs?.length
    ? m.polishRefs.map(pr => `
        <span class="chip chip--polish">
          ${pr.color ? `<span class="chip-dot" style="background:${esc(pr.color)};"></span>` : ''}
          ${esc(pr.name)}
        </span>`).join('')
    : (m.polishes ?? []).map(n => `<span class="chip chip--polish">${esc(n)}</span>`).join('');

  const stickerChips = m.stickerRefs?.length
    ? m.stickerRefs.map(sr => `<span class="chip chip--sticker">✦ ${esc(sr.name)}</span>`).join('')
    : (m.stickers ?? []).map(s => `<span class="chip chip--sticker">✦ ${esc(s)}</span>`).join('');

  return `
    <div class="diary-entry">
      <div class="diary-date">${fmtDate(m.date)}</div>
      ${photoSlots.length > 0 ? `<div class="diary-photos">${photoSlots.join('')}</div>` : ''}
      ${polishChips ? `<div class="chip-row">${polishChips}</div>` : ''}
      ${stickerChips ? `<div class="chip-row">${stickerChips}</div>` : ''}
      ${m.notes ? `<div class="diary-notes">${esc(m.notes)}</div>` : ''}
    </div>`;
}

function barChart(entries: [string, number][], total: number): string {
  return entries.map(([label, count]) => `
    <div class="bar-row">
      <div class="bar-label">${esc(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round((count / total) * 100)}%"></div></div>
      <div class="bar-count">${count}</div>
    </div>`).join('');
}

function emptyState(msg: string): string {
  return `<div class="empty">${esc(msg)}</div>`;
}

export function generateReportHtml(data: AppData, period: ReportPeriod, refDate: Date): string {
  const { start, end, label } = getPeriodBounds(period, refDate);
  const periodWord = period === 'week' ? 'Woche' : 'Monat';
  const generatedAt = new Date().toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const allPolishes  = active(data.polishes);
  const allStickers  = active(data.stickers);
  const allManicures = active(data.manicures);

  const newPolishes = allPolishes.filter(p => inPeriod(p.createdAt, start, end));
  const newStickers = allStickers.filter(s => inPeriod(s.createdAt, start, end));
  const periodManicures = allManicures
    .filter(m => { const d = new Date(m.date); return d >= start && d <= end; })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Finish distribution
  const finishCounts: Record<string, number> = {};
  for (const p of allPolishes) finishCounts[p.finish] = (finishCounts[p.finish] ?? 0) + 1;
  const topFinishes = Object.entries(finishCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Brand distribution
  const brandCounts: Record<string, number> = {};
  for (const p of allPolishes) if (p.brand) brandCounts[p.brand] = (brandCounts[p.brand] ?? 0) + 1;
  const topBrands = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const avgRating = allPolishes.filter(p => p.rating).length > 0
    ? (allPolishes.filter(p => p.rating).reduce((s, p) => s + (p.rating ?? 0), 0) /
       allPolishes.filter(p => p.rating).length).toFixed(1)
    : null;

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>💅 Beauty Report · ${esc(label)}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --pink:#e91e8c;--pink2:#f48fb1;--pink-light:#fce4ec;--pink-dark:#880e4f;
      --gray:#616161;--gray-light:#f5f5f5;--text:#212121;--radius:12px;
    }
    body{font-family:'Helvetica Neue',Arial,sans-serif;color:var(--text);background:#fff;line-height:1.5}

    /* Cover */
    .cover{
      background:linear-gradient(135deg,#ff80ab 0%,#e91e8c 50%,#880e4f 100%);
      color:#fff;padding:52px 40px 44px;position:relative;overflow:hidden;
    }
    .cover::after{
      content:'💅';position:absolute;right:28px;top:20px;font-size:80px;opacity:.2;
      line-height:1;pointer-events:none;
    }
    .cover-eyebrow{font-size:11px;letter-spacing:4px;text-transform:uppercase;opacity:.75;margin-bottom:10px}
    .cover h1{font-size:44px;font-weight:800;letter-spacing:-1px;margin-bottom:4px}
    .cover h2{font-size:22px;font-weight:300;opacity:.9;margin-bottom:6px}
    .cover-range{font-size:13px;opacity:.65;margin-bottom:28px}
    .cover-chips{display:flex;gap:16px;flex-wrap:wrap}
    .cover-chip{background:rgba(255,255,255,.18);border-radius:var(--radius);padding:12px 20px;text-align:center;min-width:90px}
    .cover-chip-num{font-size:30px;font-weight:700;line-height:1}
    .cover-chip-lbl{font-size:10px;opacity:.8;letter-spacing:1px;text-transform:uppercase;margin-top:3px}

    /* Layout */
    .content{padding:32px 40px;max-width:880px;margin:0 auto}
    .section{margin-bottom:44px}
    .section-title{
      font-size:10px;font-weight:700;letter-spacing:4px;text-transform:uppercase;
      color:var(--pink);border-bottom:2px solid var(--pink-light);padding-bottom:7px;margin-bottom:20px;
    }

    /* Stats grid */
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px}
    .stat-box{background:var(--gray-light);border-radius:var(--radius);padding:16px 18px}
    .stat-label{font-size:10px;color:var(--gray);text-transform:uppercase;letter-spacing:1px}
    .stat-value{font-size:30px;font-weight:700;color:var(--pink-dark);margin:4px 0}
    .stat-sub{font-size:12px;color:var(--gray)}

    /* Bar chart */
    .charts{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:22px}
    .chart-title{font-size:11px;font-weight:600;color:var(--gray);letter-spacing:1px;text-transform:uppercase;margin-bottom:10px}
    .bar-row{display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:13px}
    .bar-label{flex:0 0 100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--gray)}
    .bar-track{flex:1;background:var(--pink-light);border-radius:4px;height:8px}
    .bar-fill{background:linear-gradient(90deg,var(--pink) 0%,var(--pink2) 100%);border-radius:4px;height:8px}
    .bar-count{flex:0 0 22px;text-align:right;font-weight:600;color:var(--pink-dark);font-size:12px}

    /* Cards */
    .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:16px}
    .card{border:1px solid #eee;border-radius:var(--radius);overflow:hidden;break-inside:avoid}
    .card-img{width:100%;height:140px;object-fit:cover;display:block}
    .card-swatch{width:100%;height:100px}
    .card-swatch--sticker{display:flex;align-items:center;justify-content:center;font-size:40px;background:var(--pink-light)}
    .card-body{padding:12px}
    .card-name{font-weight:600;font-size:14px}
    .card-sub{font-size:12px;color:var(--gray);margin-top:2px}
    .card-tags{display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-top:6px}
    .tag{background:var(--pink-light);color:var(--pink-dark);border-radius:20px;padding:2px 8px;font-size:11px;font-weight:500}
    .tag-stars{font-size:12px;color:var(--pink)}
    .color-dot{width:12px;height:12px;border-radius:50%;display:inline-block;border:1px solid rgba(0,0,0,.12);flex-shrink:0}
    .card-notes{font-size:12px;color:var(--gray);margin-top:8px;font-style:italic}

    /* Diary */
    .diary-entry{border-left:3px solid var(--pink-light);padding:14px 18px;margin-bottom:22px;break-inside:avoid}
    .diary-date{font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--pink);margin-bottom:10px}
    .diary-photos{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
    .diary-photo{width:120px;height:120px;object-fit:cover;border-radius:8px}
    .chip-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:7px}
    .chip{display:inline-flex;align-items:center;gap:4px;border-radius:20px;padding:3px 10px;font-size:12px;font-weight:500}
    .chip--polish{background:var(--gray-light)}
    .chip--sticker{background:var(--pink-light);color:var(--pink-dark)}
    .chip-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;border:1px solid rgba(0,0,0,.12)}
    .diary-notes{font-size:13px;color:var(--gray);font-style:italic;margin-top:6px}

    /* Empty */
    .empty{text-align:center;padding:28px;color:var(--gray);font-size:14px;background:var(--gray-light);border-radius:var(--radius)}

    /* Footer */
    .footer{text-align:center;padding:24px 40px;font-size:11px;color:var(--gray);border-top:1px solid #eee}

    /* Print button (hidden when printing) */
    .print-fab{
      position:fixed;bottom:24px;right:24px;
      background:var(--pink);color:#fff;
      border:none;border-radius:28px;padding:14px 26px;font-size:15px;font-weight:600;
      cursor:pointer;box-shadow:0 4px 16px rgba(233,30,140,.4);z-index:1000;
    }

    @media print{
      .print-fab{display:none}
      .cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .bar-fill{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      @page{margin:12mm}
    }
  </style>
</head>
<body>

<div class="cover">
  <div class="cover-eyebrow">Nagellacke · Bericht</div>
  <h1>💅 Beauty Report</h1>
  <h2>${esc(label)}</h2>
  <div class="cover-range">${fmtDateShort(start)} – ${fmtDateShort(end)}</div>
  <div class="cover-chips">
    <div class="cover-chip">
      <div class="cover-chip-num">${allPolishes.length}</div>
      <div class="cover-chip-lbl">Lacke</div>
    </div>
    <div class="cover-chip">
      <div class="cover-chip-num">${allStickers.length}</div>
      <div class="cover-chip-lbl">Sticker</div>
    </div>
    <div class="cover-chip">
      <div class="cover-chip-num">${allManicures.length}</div>
      <div class="cover-chip-lbl">Maniküren</div>
    </div>
    ${newPolishes.length > 0 ? `
    <div class="cover-chip">
      <div class="cover-chip-num">+${newPolishes.length}</div>
      <div class="cover-chip-lbl">Neu diese ${esc(periodWord)}</div>
    </div>` : ''}
    ${periodManicures.length > 0 ? `
    <div class="cover-chip">
      <div class="cover-chip-num">${periodManicures.length}</div>
      <div class="cover-chip-lbl">Maniküren diese ${esc(periodWord)}</div>
    </div>` : ''}
  </div>
</div>

<div class="content">

  <!-- Stats Overview -->
  <div class="section">
    <div class="section-title">Gesamtübersicht · Statistik</div>
    <div class="stats-grid">
      <div class="stat-box">
        <div class="stat-label">Lacke gesamt</div>
        <div class="stat-value">${allPolishes.length}</div>
        <div class="stat-sub">${allPolishes.filter(p => p.status === 'ok').length} aktiv · ${allPolishes.filter(p => p.status === 'wish').length} Wunsch</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Sticker gesamt</div>
        <div class="stat-value">${allStickers.length}</div>
        <div class="stat-sub">${allStickers.filter(s => s.status === 'ok').length} verfügbar</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Maniküren gesamt</div>
        <div class="stat-value">${allManicures.length}</div>
        <div class="stat-sub">diese ${esc(periodWord)}: ${periodManicures.length}</div>
      </div>
      ${avgRating ? `
      <div class="stat-box">
        <div class="stat-label">Ø Bewertung</div>
        <div class="stat-value">${avgRating}</div>
        <div class="stat-sub">★ von 5</div>
      </div>` : ''}
      ${newPolishes.length > 0 ? `
      <div class="stat-box">
        <div class="stat-label">Neue Lacke</div>
        <div class="stat-value">+${newPolishes.length}</div>
        <div class="stat-sub">diese ${esc(periodWord)}</div>
      </div>` : ''}
      ${newStickers.length > 0 ? `
      <div class="stat-box">
        <div class="stat-label">Neue Sticker</div>
        <div class="stat-value">+${newStickers.length}</div>
        <div class="stat-sub">diese ${esc(periodWord)}</div>
      </div>` : ''}
    </div>

    ${(topFinishes.length > 0 || topBrands.length > 0) ? `
    <div class="charts">
      ${topFinishes.length > 0 ? `
      <div>
        <div class="chart-title">Top Finishes</div>
        ${barChart(topFinishes, allPolishes.length)}
      </div>` : ''}
      ${topBrands.length > 0 ? `
      <div>
        <div class="chart-title">Top Marken</div>
        ${barChart(topBrands, allPolishes.length)}
      </div>` : ''}
    </div>` : ''}
  </div>

  <!-- New Polishes -->
  <div class="section">
    <div class="section-title">Neue Lacke · Diese ${esc(periodWord)} (${newPolishes.length})</div>
    ${newPolishes.length > 0
      ? `<div class="cards">${newPolishes.map(p => renderPolishCard(p)).join('')}</div>`
      : emptyState(`Keine neuen Lacke in dieser ${periodWord} hinzugefügt`)}
  </div>

  <!-- New Stickers -->
  <div class="section">
    <div class="section-title">Neue Sticker · Diese ${esc(periodWord)} (${newStickers.length})</div>
    ${newStickers.length > 0
      ? `<div class="cards">${newStickers.map(s => renderStickerCard(s)).join('')}</div>`
      : emptyState(`Keine neuen Sticker in dieser ${periodWord} hinzugefügt`)}
  </div>

  <!-- Diary -->
  <div class="section">
    <div class="section-title">Maniküre-Tagebuch · Diese ${esc(periodWord)} (${periodManicures.length})</div>
    ${periodManicures.length > 0
      ? periodManicures.map(m => renderManicureEntry(m)).join('')
      : emptyState(`Keine Tagebucheinträge in dieser ${periodWord}`)}
  </div>

</div>

<div class="footer">
  💅 Nagellacke App · ${esc(label)} · Erstellt am ${esc(generatedAt)}
</div>

<button class="print-fab" onclick="window.print()">📄 Als PDF speichern</button>

</body>
</html>`;
}

export function openReport(data: AppData, period: ReportPeriod, refDate: Date): void {
  const html = generateReportHtml(data, period, refDate);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
