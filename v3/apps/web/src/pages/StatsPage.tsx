import { useMemo } from 'react';
import type { AppData } from '@nagellacke/core';
import { hexToHue, FINISH_OPTIONS, STATUS_OPTIONS } from '@nagellacke/core';
import type { useAppData } from '../useAppData';
import styles from './StatsPage.module.css';

type AppDataHook = ReturnType<typeof useAppData>;

export default function StatsPage({ appData }: { appData: AppDataHook }) {
  const { polishes, stickers, manicures } = appData.data;

  const active = useMemo(() => polishes.filter((p) => !p.deletedAt), [polishes]);
  const activeStickers = useMemo(() => stickers.filter((s) => !s.deletedAt), [stickers]);
  const activeManicures = useMemo(() => manicures.filter((m) => !m.deletedAt), [manicures]);

  const byFinish = useMemo(() => countBy(active, (p) => p.finish), [active]);
  const byStatus = useMemo(() => countBy(active, (p) => p.status), [active]);
  const byBrand = useMemo(() => {
    const counts = countBy(active, (p) => p.brand || 'Unbekannt');
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [active]);

  const topRated = useMemo(
    () => [...active].filter((p) => (p.rating ?? 0) > 0).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 5),
    [active],
  );

  const colorPalette = useMemo(
    () => [...active].sort((a, b) => hexToHue(a.color) - hexToHue(b.color)),
    [active],
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2 className={styles.title}>Statistik</h2>
      </header>

      <div className={styles.kpiRow}>
        <KpiCard num={active.length} label="Lacke" />
        <KpiCard num={activeStickers.length} label="Sticker" />
        <KpiCard num={activeManicures.length} label="Maniküren" />
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Farbpalette</h2>
        <div className={styles.palette}>
          {colorPalette.map((p) => (
            <div
              key={p.id}
              className={styles.paletteDot}
              style={{ background: p.color }}
              title={`${p.name} – ${p.brand}`}
            />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Nach Finish</h2>
        <BarChart
          data={FINISH_OPTIONS.map((o) => ({ label: `${o.icon} ${o.label}`, value: byFinish[o.value] ?? 0 }))}
          total={active.length}
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Nach Status</h2>
        <BarChart
          data={STATUS_OPTIONS.map((o) => ({ label: o.label, value: byStatus[o.value] ?? 0 }))}
          total={active.length}
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Top-Marken</h2>
        <BarChart
          data={byBrand.map(([label, value]) => ({ label, value }))}
          total={active.length}
        />
      </section>

      {topRated.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Bestbewertet</h2>
          <div className={styles.topList}>
            {topRated.map((p) => (
              <div key={p.id} className={styles.topItem}>
                <div className={styles.topSwatch} style={{ background: p.color }} />
                <div className={styles.topInfo}>
                  <div className={styles.topName}>{p.name}</div>
                  <div className={styles.topBrand}>{p.brand}</div>
                </div>
                <div className={styles.topRating}>{'★'.repeat(p.rating ?? 0)}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function KpiCard({ num, label }: { num: number; label: string }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiNum}>{num}</div>
      <div className={styles.kpiLabel}>{label}</div>
    </div>
  );
}

function BarChart({ data, total }: { data: { label: string; value: number }[]; total: number }) {
  const filtered = data.filter((d) => d.value > 0);
  if (filtered.length === 0) return <div className={styles.empty}>Keine Daten</div>;
  return (
    <div className={styles.bars}>
      {filtered.map((d) => (
        <div key={d.label} className={styles.barRow}>
          <div className={styles.barLabel}>{d.label}</div>
          <div className={styles.barTrack}>
            <div
              className={styles.barFill}
              style={{ width: `${Math.round((d.value / total) * 100)}%` }}
            />
          </div>
          <div className={styles.barCount}>{d.value}</div>
        </div>
      ))}
    </div>
  );
}

function countBy<T>(arr: T[], key: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of arr) {
    const k = key(item);
    result[k] = (result[k] ?? 0) + 1;
  }
  return result;
}
