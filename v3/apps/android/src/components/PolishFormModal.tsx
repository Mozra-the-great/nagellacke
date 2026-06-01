import { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Modal, Portal, Text, TextInput, Button, Chip, useTheme, Divider } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import type { Polish, Category } from '@nagellacke/core';
import { FINISH_OPTIONS, STATUS_OPTIONS, DEFAULT_POLISH } from '@nagellacke/core';

type FormData = Omit<Polish, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

export default function PolishFormModal({
  visible,
  polish,
  categories,
  onSave,
  onDismiss,
  onDelete,
}: {
  visible: boolean;
  polish: Polish | null;
  categories: Category[];
  onSave: (data: Partial<FormData>) => void;
  onDismiss: () => void;
  onDelete?: () => void;
}) {
  const theme = useTheme();
  const makeForm = (p: typeof polish): FormData => ({
    name: p?.name ?? DEFAULT_POLISH.name,
    brand: p?.brand ?? DEFAULT_POLISH.brand,
    num: p?.num ?? DEFAULT_POLISH.num,
    color: p?.color ?? DEFAULT_POLISH.color,
    finish: p?.finish ?? DEFAULT_POLISH.finish,
    status: p?.status ?? DEFAULT_POLISH.status,
    count: p?.count ?? DEFAULT_POLISH.count,
    categories: p?.categories ?? [],
    notes: p?.notes ?? '',
    rating: p?.rating ?? 0,
    photo: p?.photo,
  });

  const [form, setForm] = useState<FormData>(() => makeForm(polish));

  useEffect(() => {
    if (visible) setForm(makeForm(polish));
  }, [visible, polish]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0].base64) {
      set('photo', result.assets[0].uri);
    }
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}>
        <Text variant="titleLarge" style={styles.title}>{polish ? 'Bearbeiten' : 'Neuer Lack'}</Text>
        <Divider />

        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          <TextInput
            label="Name *"
            value={form.name}
            onChangeText={(v) => set('name', v)}
            mode="outlined"
            style={styles.input}
          />
          <TextInput
            label="Marke"
            value={form.brand}
            onChangeText={(v) => set('brand', v)}
            mode="outlined"
            style={styles.input}
          />
          <TextInput
            label="Nummer"
            value={form.num}
            onChangeText={(v) => set('num', v)}
            mode="outlined"
            style={styles.input}
          />

          <Text variant="labelLarge" style={styles.label}>Finish</Text>
          <View style={styles.chipRow}>
            {FINISH_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                selected={form.finish === o.value}
                onPress={() => set('finish', o.value)}
                compact
                style={styles.chip}
              >
                {o.icon} {o.label}
              </Chip>
            ))}
          </View>

          <Text variant="labelLarge" style={styles.label}>Status</Text>
          <View style={styles.chipRow}>
            {STATUS_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                selected={form.status === o.value}
                onPress={() => set('status', o.value)}
                compact
                style={styles.chip}
              >
                {o.label}
              </Chip>
            ))}
          </View>

          <Text variant="labelLarge" style={styles.label}>Bewertung</Text>
          <View style={styles.stars}>
            {[1,2,3,4,5].map((n) => (
              <Text
                key={n}
                style={[styles.star, { color: n <= (form.rating ?? 0) ? '#f59e0b' : theme.colors.outlineVariant }]}
                onPress={() => set('rating', n === form.rating ? 0 : n)}
              >★</Text>
            ))}
          </View>

          {categories.length > 0 && (
            <>
              <Text variant="labelLarge" style={styles.label}>Kategorien</Text>
              <View style={styles.chipRow}>
                {categories.map((c) => (
                  <Chip
                    key={c.id}
                    selected={(form.categories ?? []).includes(c.id)}
                    onPress={() => {
                      const curr = form.categories ?? [];
                      set('categories', curr.includes(c.id) ? curr.filter((x) => x !== c.id) : [...curr, c.id]);
                    }}
                    compact
                    style={styles.chip}
                  >
                    {c.label}
                  </Chip>
                ))}
              </View>
            </>
          )}

          <TextInput
            label="Notizen"
            value={form.notes}
            onChangeText={(v) => set('notes', v)}
            mode="outlined"
            multiline
            numberOfLines={3}
            style={styles.input}
          />

          <Button mode="outlined" onPress={pickImage} style={styles.input} icon="camera">
            Foto auswählen
          </Button>
        </ScrollView>

        <Divider />
        <View style={styles.footer}>
          {onDelete && (
            <Button mode="text" textColor={theme.colors.error} onPress={onDelete}>Löschen</Button>
          )}
          <Button mode="text" onPress={onDismiss}>Abbrechen</Button>
          <Button
            mode="contained"
            onPress={() => { if (form.name.trim()) onSave(form); }}
            disabled={!form.name.trim()}
          >
            Speichern
          </Button>
        </View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: {
    margin: 20,
    borderRadius: 28,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  title: { padding: 20, paddingBottom: 16, fontWeight: '600' },
  body: { maxHeight: 500, paddingHorizontal: 20, paddingTop: 12 },
  input: { marginBottom: 12 },
  label: { marginBottom: 8, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  chip: {},
  stars: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  star: { fontSize: 28 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 16, alignItems: 'center' },
});
