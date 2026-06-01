import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { PaperProvider, MD3LightTheme, MD3DarkTheme } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';
import { AppDataProvider } from '../src/AppDataContext';

const lightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#c2185b',
    primaryContainer: '#ffd8ec',
    secondary: '#9c27b0',
    secondaryContainer: '#f3e5f5',
    surface: '#fffbfe',
    background: '#fffbfe',
    tertiary: '#2e7d32',
  },
};

const darkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#f48fb1',
    primaryContainer: '#880e4f',
    secondary: '#ce93d8',
    secondaryContainer: '#4a148c',
    surface: '#141218',
    background: '#141218',
    tertiary: '#81c784',
  },
};

function TabIcon({ icon }: { icon: string }) {
  return <Text style={{ fontSize: 22 }}>{icon}</Text>;
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? darkTheme : lightTheme;

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <AppDataProvider>
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: theme.colors.primary,
              tabBarStyle: {
                backgroundColor: theme.colors.surface,
                borderTopColor: theme.colors.outline ?? '#ccc',
              },
            }}
          >
            <Tabs.Screen
              name="index"
              options={{
                title: 'Lacke',
                tabBarIcon: () => <TabIcon icon="💅" />,
              }}
            />
            <Tabs.Screen
              name="stickers"
              options={{
                title: 'Sticker',
                tabBarIcon: () => <TabIcon icon="✨" />,
              }}
            />
            <Tabs.Screen
              name="diary"
              options={{
                title: 'Tagebuch',
                tabBarIcon: () => <TabIcon icon="📖" />,
              }}
            />
            <Tabs.Screen
              name="stats"
              options={{
                title: 'Statistik',
                tabBarIcon: () => <TabIcon icon="📊" />,
              }}
            />
            <Tabs.Screen
              name="settings"
              options={{
                title: 'Mehr',
                tabBarIcon: () => <TabIcon icon="⚙️" />,
              }}
            />
          </Tabs>
        </AppDataProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
