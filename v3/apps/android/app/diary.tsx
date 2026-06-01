import { useState, useMemo } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Text, FAB, List, Portal, Modal, TextInput, Button, Chip, Divider, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Manicure } from '@nagellacke/core';
import { filterManicures } from '@nagellacke/core';
import { useAppData } from '../src/AppDataContext';

export default function DiaryScreen() {
  const theme = useTheme();
  const appData = useAppData();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Manicure | null>(null);
  const [form, setForm] = useState({ date: today(), polishes: [] as string[], notes: '' });

  const entries = useMemo(
    () => filterManicures(appData.data.manicures).sort((a, b) => b.date.localeCompare(a.date)),
    [appData.data.manicures],
  );

  const availablePolishes = useMemo(
    () => appData.data.polishes.filter((p) => !p.deletedAt && p.status !== 'wish'),
    [appData.data.polishes],
  );

  const openNew = () => { setEditing(null); setForm({ date: today(), polishes: [], notes: '' }); setShowForm(true); };
  const openEdit = (m: Manicure) => { setEditing(m); setForm({ date: m.date, polishes: [...m.polishes], notes: m.notes ?? '' }); setShowForm(true); };

  const save = () => {
    if (editing) appData.updateManicure(editing.id, form);
    else appData.addManicure(form);
    setShowForm(false);
  };

  const toggle = (name: string) => setForm((f) => ({
    ...f,
    polishes: f.polishes.includes(name) ? f.polishes.filter((x) => x !== name) : [...f.polishes, name],
  }));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.primary }]}>Tagebuch</Text>
      <Text style={[styles.count, { color: theme.colors.outline }]}>{entries.length} Einträge</Text>

      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 100 }}
        renderItem={({ item }) => {
          const polishes = appData.data.polishes.filter((p) => item.polishes.includes(p.name));
          return (
            <List.Item
              title={formatDate(item.date)}
              description={item.notes || item.polishes.slice(0, 3).join(', ')}
              titleStyle={{ color: theme.colors.primary }}
              onPress={() => openEdit(item)}
              left={() => (
                <View style={styles.swatches}>
                  {polishes.slice(0, 4).map((p) => (
                    <View key={p.id} style={[styles.swatch, { backgroundColor: p.color }]} />
                  ))}
                </View>
              )}
            />
          );
        }}
      />

      <FAB icon="plus" style={[styles.fab, { backgroundColor: theme.colors.primary }]} color={theme.colors.onPrimary} onPress={openNew} />

      <Portal>
        <Modal visible={showForm} onDismiss={() => setShowForm(false)}
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}>
          <Text variant="titleLarge" style={styles.modalTitle}>{editing ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</Text>
          <Divider />
          <View style={styles.modalBody}>
            <TextInput label="Datum" value={form.date} onChangeText={(v) => setForm((f) => ({ ...f, date: v }))} mode="outlined" style={styles.input} />
            <Text variant="labelLarge" style={{ marginBottom: 8 }}>Lacke</Text>
            <View style={styles.chipRow}>
              {availablePolishes.map((p) => (
                <Chip
                  key={p.id}
                  selected={form.polishes.includes(p.name)}
                  onPress={() => toggle(p.name)}
                  compact
                  style={styles.chip}
                  avatar={<View style={[styles.chipDot, { backgroundColor: p.color }]} />}
                >
                  {p.name}
                </Chip>
              ))}
            </View>
            <TextInput label="Notizen" value={form.notes} onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))} mode="outlined" multiline numberOfLines={3} style={styles.input} />
          </View>
          <Divider />
          <View style={styles.footer}>
            {editing && <Button mode="text" textColor={theme.colors.error} onPress={() => { appData.deleteManicure(editing.id); setShowForm(false); }}>Löschen</Button>}
            <Button mode="text" onPress={() => setShowForm(false)}>Abbrechen</Button>
            <Button mode="contained" onPress={save}>Speichern</Button>
          </View>
        </Modal>
      </Portal>
    </SafeAreaView>
  );
}

function today() { return new Date().toISOString().slice(0, 10); }
function formatDate(iso: string) { return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }); }

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, fontWeight: '600' },
  count: { paddingHorizontal: 16, marginBottom: 4, fontSize: 13 },
  swatches: { flexDirection: 'row', gap: 4, alignSelf: 'center', paddingLeft: 12 },
  swatch: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  fab: { position: 'absolute', bottom: 24, right: 16 },
  modal: { margin: 20, borderRadius: 28, overflow: 'hidden' },
  modalTitle: { padding: 20, paddingBottom: 16, fontWeight: '600' },
  modalBody: { padding: 20, maxHeight: 500 },
  input: { marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  chip: {},
  chipDot: { width: 12, height: 12, borderRadius: 6, margin: 2 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 16, alignItems: 'center' },
});
