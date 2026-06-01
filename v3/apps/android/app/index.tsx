import { useState, useMemo } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, FAB, Searchbar, Chip, useTheme, Surface } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Polish, FilterState } from '@nagellacke/core';
import { filterPolishes, sortPolishes, FINISH_OPTIONS, STATUS_OPTIONS } from '@nagellacke/core';
import { useAppData } from '../src/AppDataContext';
import PolishFormModal from '../src/components/PolishFormModal';

export default function CollectionScreen() {
  const theme = useTheme();
  const appData = useAppData();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterState['status']>('');
  const [finishFilter, setFinishFilter] = useState<FilterState['finish']>('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Polish | null>(null);

  const filter: FilterState = { search, status: statusFilter, finish: finishFilter, category: '', brand: '', sort: 'newest' };

  const visible = useMemo(() => {
    return sortPolishes(filterPolishes(appData.data.polishes, filter), 'newest');
  }, [appData.data.polishes, search, statusFilter, finishFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.primary }]}>
          Nagellacke
        </Text>
        {appData.syncing && <Text style={{ color: theme.colors.outline, fontSize: 12 }}>↑↓ Sync…</Text>}
      </View>

      <Searchbar
        placeholder="Suchen…"
        value={search}
        onChangeText={setSearch}
        style={[styles.search, { backgroundColor: theme.colors.surfaceVariant }]}
        elevation={0}
      />

      <View style={styles.chips}>
        {STATUS_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            selected={statusFilter === o.value}
            onPress={() => setStatusFilter(statusFilter === o.value ? '' : o.value)}
            compact
            style={styles.chip}
          >
            {o.label}
          </Chip>
        ))}
      </View>

      <Text style={[styles.count, { color: theme.colors.outline }]}>{visible.length} Lacke</Text>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <PolishItem
            polish={item}
            onPress={() => { setEditing(item); setShowForm(true); }}
          />
        )}
      />

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        color={theme.colors.onPrimary}
        onPress={() => { setEditing(null); setShowForm(true); }}
      />

      <PolishFormModal
        visible={showForm}
        polish={editing}
        categories={appData.data.customCats.filter((c) => !c.deletedAt)}
        onSave={(p) => {
          if (editing) appData.updatePolish(editing.id, p);
          else appData.addPolish(p as Omit<Polish, 'id' | 'createdAt' | 'updatedAt'>);
          setShowForm(false);
        }}
        onDismiss={() => setShowForm(false)}
        onDelete={editing ? () => { appData.deletePolish(editing.id); setShowForm(false); } : undefined}
      />
    </SafeAreaView>
  );
}

function PolishItem({ polish, onPress }: { polish: Polish; onPress: () => void }) {
  const theme = useTheme();
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <Surface style={[styles.cardSurface, { backgroundColor: theme.colors.surfaceVariant }]} elevation={1}>
        <View style={[styles.swatch, { backgroundColor: polish.color }]} />
        <View style={styles.cardInfo}>
          <Text style={styles.cardName} numberOfLines={1}>{polish.name}</Text>
          <Text style={[styles.cardBrand, { color: theme.colors.outline }]} numberOfLines={1}>{polish.brand}</Text>
          <View style={styles.cardMeta}>
            <Chip compact style={[styles.finishChip, { backgroundColor: theme.colors.primaryContainer }]}
              textStyle={{ color: theme.colors.primary, fontSize: 10 }}>
              {polish.finish}
            </Chip>
          </View>
        </View>
      </Surface>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  title: { fontFamily: 'System', fontSize: 28, fontWeight: '600' },
  search: { marginHorizontal: 16, marginBottom: 8, borderRadius: 28 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, marginBottom: 8 },
  chip: { marginBottom: 0 },
  count: { paddingHorizontal: 16, marginBottom: 8, fontSize: 13 },
  grid: { paddingHorizontal: 12, paddingBottom: 100 },
  row: { gap: 10, marginBottom: 10 },
  card: { flex: 1 },
  cardSurface: { borderRadius: 16, overflow: 'hidden' },
  swatch: { height: 100 },
  cardInfo: { padding: 10 },
  cardName: { fontSize: 14, fontWeight: '600' },
  cardBrand: { fontSize: 12, marginTop: 2 },
  cardMeta: { flexDirection: 'row', marginTop: 6 },
  finishChip: { height: 22 },
  fab: { position: 'absolute', bottom: 24, right: 16 },
});
