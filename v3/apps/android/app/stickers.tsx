import { useState, useMemo } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Text, FAB, Searchbar, List, Chip, Portal, Modal, TextInput, Button, Divider, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Sticker } from '@nagellacke/core';
import { filterStickers, STICKER_TYPE_OPTIONS, STATUS_OPTIONS, DEFAULT_STICKER } from '@nagellacke/core';
import { useAppData } from '../src/AppDataContext';

export default function StickersScreen() {
  const theme = useTheme();
  const appData = useAppData();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Sticker | null>(null);
  const [form, setForm] = useState({ ...DEFAULT_STICKER });

  const visible = useMemo(() => filterStickers(appData.data.stickers, search), [appData.data.stickers, search]);

  const openNew = () => { setEditing(null); setForm({ ...DEFAULT_STICKER }); setShowForm(true); };
  const openEdit = (s: Sticker) => {
    setEditing(s);
    setForm({ name: s.name, brand: s.brand ?? '', style: s.style ?? '', type: s.type, colors: s.colors ?? ['#ff6699'], status: s.status, notes: s.notes ?? '', rating: s.rating ?? 0 });
    setShowForm(true);
  };

  const save = () => {
    if (!form.name.trim()) return;
    if (editing) appData.updateSticker(editing.id, form);
    else appData.addSticker(form as Omit<Sticker, 'id' | 'createdAt' | 'updatedAt'>);
    setShowForm(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.primary }]}>Sticker</Text>

      <Searchbar
        placeholder="Sticker suchen…"
        value={search}
        onChangeText={setSearch}
        style={[styles.search, { backgroundColor: theme.colors.surfaceVariant }]}
        elevation={0}
      />

      <Text style={[styles.count, { color: theme.colors.outline }]}>{visible.length} Sticker</Text>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 100 }}
        renderItem={({ item }) => (
          <List.Item
            title={item.name}
            description={[item.brand, STICKER_TYPE_OPTIONS.find((o) => o.value === item.type)?.label].filter(Boolean).join(' · ')}
            onPress={() => openEdit(item)}
            left={() => (
              <View style={styles.colorDots}>
                {(item.colors ?? ['#ccc']).slice(0, 3).map((c, i) => (
                  <View key={i} style={[styles.dot, { backgroundColor: c }]} />
                ))}
              </View>
            )}
            right={() => (
              item.rating ? <Text style={{ color: '#f59e0b', alignSelf: 'center' }}>{'★'.repeat(item.rating)}</Text> : null
            )}
          />
        )}
      />

      <FAB icon="plus" style={[styles.fab, { backgroundColor: theme.colors.primary }]} color={theme.colors.onPrimary} onPress={openNew} />

      <Portal>
        <Modal visible={showForm} onDismiss={() => setShowForm(false)}
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}>
          <Text variant="titleLarge" style={styles.modalTitle}>{editing ? 'Bearbeiten' : 'Neuer Sticker'}</Text>
          <Divider />
          <View style={styles.modalBody}>
            <TextInput label="Name *" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} mode="outlined" style={styles.input} />
            <TextInput label="Marke" value={form.brand} onChangeText={(v) => setForm((f) => ({ ...f, brand: v }))} mode="outlined" style={styles.input} />
            <Text variant="labelLarge" style={{ marginBottom: 8 }}>Typ</Text>
            <View style={styles.chipRow}>
              {STICKER_TYPE_OPTIONS.map((o) => (
                <Chip key={o.value} selected={form.type === o.value} onPress={() => setForm((f) => ({ ...f, type: o.value }))} compact style={styles.chip}>
                  {o.icon} {o.label}
                </Chip>
              ))}
            </View>
            <Text variant="labelLarge" style={{ marginBottom: 8 }}>Status</Text>
            <View style={styles.chipRow}>
              {STATUS_OPTIONS.map((o) => (
                <Chip key={o.value} selected={form.status === o.value} onPress={() => setForm((f) => ({ ...f, status: o.value as typeof form.status }))} compact style={styles.chip}>
                  {o.label}
                </Chip>
              ))}
            </View>
            <TextInput label="Notizen" value={form.notes} onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))} mode="outlined" multiline numberOfLines={2} style={styles.input} />
          </View>
          <Divider />
          <View style={styles.footer}>
            {editing && <Button mode="text" textColor={theme.colors.error} onPress={() => { appData.deleteSticker(editing.id); setShowForm(false); }}>Löschen</Button>}
            <Button mode="text" onPress={() => setShowForm(false)}>Abbrechen</Button>
            <Button mode="contained" onPress={save} disabled={!form.name.trim()}>Speichern</Button>
          </View>
        </Modal>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, fontWeight: '600' },
  search: { marginHorizontal: 16, marginBottom: 8, borderRadius: 28 },
  count: { paddingHorizontal: 16, marginBottom: 4, fontSize: 13 },
  colorDots: { flexDirection: 'row', gap: 4, alignSelf: 'center', paddingLeft: 12 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  fab: { position: 'absolute', bottom: 24, right: 16 },
  modal: { margin: 20, borderRadius: 28, overflow: 'hidden' },
  modalTitle: { padding: 20, paddingBottom: 16, fontWeight: '600' },
  modalBody: { padding: 20 },
  input: { marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  chip: {},
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 16, alignItems: 'center' },
});
