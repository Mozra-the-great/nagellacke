import { useMemo } from 'react';
import { View, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Text, useTheme, Surface } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { hexToHue, FINISH_OPTIONS, STATUS_OPTIONS } from '@nagellacke/core';
import { useAppData } from '../src/AppDataContext';

export default function StatsScreen() {
  const theme = useTheme();
  const appData = useAppData();

  const active = useMemo(() => appData.data.polishes.filter((p) => !p.deletedAt), [appData.data.polishes]);
  const activeStickers = useMemo(() => appData.data.stickers.filter((s) => !s.deletedAt), [appData.data.stickers]);
  const activeManicures = useMemo(() => appData.data.manicures.filter((m) => !m.deletedAt), [appData.data.manicures]);

  const byFinish = useMemo(() => countBy(active, (p) => p.finish), [active]);
  const byStatus = useMemo(() => countBy(active, (p) => p.status), [active]);
  const byBrand = useMemo(
    () => Object.entries(countBy(active, (p) => p.brand || 'Unbekannt')).sort((a, b) => b[1] - a[1]).slice(0, 8),
    [active],
  );

  const colorPalette = useMemo(
    () => [...active].sort((a, b) => hexToHue(a.color) - hexToHue(b.color)),
    [active],
  );

  const topRated = useMemo(
    () => [...active].filter((p) => (p.rating ?? 0) > 0).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 5),
    [active],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.primary }]}>Statistik</Text>

        {/* KPIs */}
        <View style={styles.kpiRow}>
          <KpiCard num={active.length} label="Lacke" color={theme.colors.primary} />
          <KpiCard num={activeStickers.length} label="Sticker" color={theme.colors.secondary} />
          <KpiCard num={activeManicures.length} label="Maniküren" color={theme.colors.tertiary} />
        </View>

        {/* Color palette */}
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Farbpalette</Text>
          <View style={styles.palette}>
            {colorPalette.map((p) => (
              <View key={p.id} style={[styles.paletteDot, { backgroundColor: p.color }]} />
            ))}
          </View>
        </View>

        {/* By finish */}
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Nach Finish</Text>
          {FINISH_OPTIONS.filter((o) => (byFinish[o.value] ?? 0) > 0).map((o) => (
            <BarRow
              key={o.value}
              label={`${o.icon} ${o.label}`}
              value={byFinish[o.value] ?? 0}
              total={active.length}
              color={theme.colors.primary}
            />
          ))}
        </View>

        {/* By status */}
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Nach Status</Text>
          {STATUS_OPTIONS.filter((o) => (byStatus[o.value] ?? 0) > 0).map((o) => (
            <BarRow
              key={o.value}
              label={o.label}
              value={byStatus[o.value] ?? 0}
              total={active.length}
              color={theme.colors.secondary}
            />
          ))}
        </View>

        {/* Top brands */}
        {byBrand.length > 0 && (
          <View style={styles.section}>
            <Text variant="titleMedium" style={styles.sectionTitle}>Top-Marken</Text>
            {byBrand.map(([label, value]) => (
              <BarRow key={label} label={label} value={value} total={active.length} color={theme.colors.tertiary} />
            ))}
          </View>
        )}

        {/* Top rated */}
        {topRated.length > 0 && (
          <View style={styles.section}>
            <Text variant="titleMedium" style={styles.sectionTitle}>Bestbewertet</Text>
            {topRated.map((p) => (
              <Surface key={p.id} style={[styles.topItem, { backgroundColor: theme.colors.surfaceVariant }]} elevation={0}>
                <View style={[styles.topSwatch, { backgroundColor: p.color }]} />
                <View style={styles.topInfo}>
                  <Text style={styles.topName}>{p.name}</Text>
                  <Text style={[styles.topBrand, { color: theme.colors.outline }]}>{p.brand}</Text>
                </View>
                <Text style={styles.topRating}>{'★'.repeat(p.rating ?? 0)}</Text>
              </Surface>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function KpiCard({ num, label, color }: { num: number; label: string; color: string }) {
  return (
    <View style={[styles.kpi, { borderColor: color + '40', borderWidth: 1 }]}>
      <Text style={[styles.kpiNum, { color }]}>{num}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function BarRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const { width: screenWidth } = useWindowDimensions();
  // Track width = screen - horizontal padding (32) - label (110) - gap (16) - count (24) - gap (8)
  const trackWidth = screenWidth - 32 - 110 - 48;
  const fillWidth = total > 0 ? Math.max(2, (value / total) * trackWidth) : 0;
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: fillWidth, backgroundColor: color }]} />
      </View>
      <Text style={styles.barCount}>{value}</Text>
    </View>
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, fontWeight: '600' },
  kpiRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 20 },
  kpi: { flex: 1, alignItems: 'center', padding: 14, borderRadius: 16 },
  kpiNum: { fontSize: 28, fontWeight: '700' },
  kpiLabel: { fontSize: 11, marginTop: 4 },
  section: { paddingHorizontal: 16, marginBottom: 20 },
  sectionTitle: { fontWeight: '600', marginBottom: 12 },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  paletteDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  barLabel: { width: 110, fontSize: 12 },
  barTrack: { flex: 1, height: 10, backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5 },
  barCount: { width: 24, fontSize: 12, textAlign: 'right' },
  topItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, marginBottom: 8 },
  topSwatch: { width: 36, height: 36, borderRadius: 18 },
  topInfo: { flex: 1 },
  topName: { fontSize: 14, fontWeight: '500' },
  topBrand: { fontSize: 12 },
  topRating: { color: '#f59e0b', fontSize: 14 },
});
