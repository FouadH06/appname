import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// M0 placeholder. The customer app (tabs: Home · Explore · Bookings · Favorites · Profile)
// is built in M13.
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>APP_NAME</Text>
      <Text style={styles.subtitle}>Foundation build (M0)</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7f6f3',
  },
  title: { fontSize: 22, fontWeight: '600', color: '#16181d' },
  subtitle: { marginTop: 4, color: '#3d3f45' },
});
