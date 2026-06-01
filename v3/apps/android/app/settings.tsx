import { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, Button, TextInput, Chip, Divider, useTheme, Banner, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import type { SyncConfig, SyncProviderType } from '@nagellacke/sync';
import { useAppData } from '../src/AppDataContext';

WebBrowser.maybeCompleteAuthSession();

const PROVIDERS: { value: SyncProviderType | 'none'; label: string }[] = [
  { value: 'none', label: 'Kein Sync' },
  { value: 'server', label: 'Eigener Server' },
  { value: 'nextcloud', label: 'Nextcloud' },
  { value: 'googledrive', label: 'Google Drive' },
  { value: 'onedrive', label: 'OneDrive' },
  { value: 'dropbox', label: 'Dropbox' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const appData = useAppData();
  const [provider, setProvider] = useState<SyncProviderType | 'none'>(appData.syncConfig?.provider ?? 'none');
  const [serverUrl, setServerUrl] = useState(appData.syncConfig?.serverUrl ?? '');
  const [serverToken, setServerToken] = useState(appData.syncConfig?.serverToken ?? '');
  const [ncUrl, setNcUrl] = useState(appData.syncConfig?.nextcloudUrl ?? '');
  const [ncUser, setNcUser] = useState(appData.syncConfig?.nextcloudUser ?? '');
  const [ncPass, setNcPass] = useState(appData.syncConfig?.nextcloudPassword ?? '');
  const [saved, setSaved] = useState(false);

  const stats = {
    polishes: appData.data.polishes.filter((p) => !p.deletedAt).length,
    stickers: appData.data.stickers.filter((s) => !s.deletedAt).length,
    manicures: appData.data.manicures.filter((m) => !m.deletedAt).length,
  };

  const saveConfig = async () => {
    let config: SyncConfig | null = null;
    if (provider === 'server') config = { provider, serverUrl, serverToken };
    else if (provider === 'nextcloud') config = { provider, nextcloudUrl: ncUrl, nextcloudUser: ncUser, nextcloudPassword: ncPass };
    await appData.setSyncConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.primary }]}>Einstellungen</Text>

        {/* Stats */}
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Sammlung</Text>
          <View style={styles.statsRow}>
            <StatCard num={stats.polishes} label="Lacke" color={theme.colors.primary} />
            <StatCard num={stats.stickers} label="Sticker" color={theme.colors.secondary} />
            <StatCard num={stats.manicures} label="Maniküren" color={theme.colors.tertiary} />
          </View>
        </View>

        <Divider />

        {/* Sync */}
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Synchronisation</Text>

          {appData.syncError && (
            <Banner visible icon="alert-circle" style={{ marginBottom: 12 }}>
              Sync-Fehler: {appData.syncError}
            </Banner>
          )}

          {appData.lastSyncAt && (
            <Text style={[styles.hint, { color: theme.colors.outline }]}>
              Letzter Sync: {new Date(appData.lastSyncAt).toLocaleString('de-DE')}
            </Text>
          )}

          <Text variant="labelLarge" style={{ marginBottom: 8 }}>Anbieter</Text>
          <View style={styles.chipRow}>
            {PROVIDERS.map((p) => (
              <Chip
                key={p.value}
                selected={provider === p.value}
                onPress={() => setProvider(p.value)}
                compact
                style={styles.chip}
              >
                {p.label}
              </Chip>
            ))}
          </View>

          {provider === 'server' && (
            <>
              <TextInput label="Server-URL" value={serverUrl} onChangeText={setServerUrl} mode="outlined" style={styles.input} placeholder="http://192.168.1.100:3001" />
              <TextInput label="JWT-Token" value={serverToken} onChangeText={setServerToken} mode="outlined" secureTextEntry style={styles.input} />
            </>
          )}

          {provider === 'nextcloud' && (
            <>
              <TextInput label="Nextcloud-URL" value={ncUrl} onChangeText={setNcUrl} mode="outlined" style={styles.input} />
              <TextInput label="Benutzername" value={ncUser} onChangeText={setNcUser} mode="outlined" style={styles.input} />
              <TextInput label="Passwort / App-Token" value={ncPass} onChangeText={setNcPass} mode="outlined" secureTextEntry style={styles.input} />
            </>
          )}

          {(provider === 'googledrive' || provider === 'onedrive' || provider === 'dropbox') && (
            <Text style={[styles.hint, { color: theme.colors.outline }]}>
              OAuth2-Login für {provider === 'googledrive' ? 'Google Drive' : provider === 'onedrive' ? 'OneDrive' : 'Dropbox'} kommt in einem nächsten Update.
            </Text>
          )}

          <View style={styles.btnRow}>
            <Button mode="contained" onPress={saveConfig} style={{ flex: 1 }}>
              {saved ? '✓ Gespeichert' : 'Speichern'}
            </Button>
            {appData.syncConfig && (
              <Button
                mode="outlined"
                onPress={() => void appData.sync()}
                disabled={appData.syncing}
                style={{ flex: 1 }}
                icon={appData.syncing ? undefined : 'sync'}
              >
                {appData.syncing ? <ActivityIndicator size={16} /> : 'Jetzt syncen'}
              </Button>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ num, label, color }: { num: number; label: string; color: string }) {
  return (
    <View style={[styles.statCard, { borderColor: color + '30', borderWidth: 1 }]}>
      <Text style={[styles.statNum, { color }]}>{num}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, fontWeight: '600' },
  section: { padding: 16 },
  sectionTitle: { marginBottom: 14, fontWeight: '600' },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, alignItems: 'center', padding: 14, borderRadius: 16 },
  statNum: { fontSize: 28, fontWeight: '700' },
  statLabel: { fontSize: 12, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  chip: {},
  input: { marginBottom: 12 },
  hint: { fontSize: 13, marginBottom: 12 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
