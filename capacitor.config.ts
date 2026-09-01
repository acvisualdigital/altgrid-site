import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.altgrid.app',
  appName: 'AltGrid',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
    backgroundColor: '#080c11',
  },
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['sound', 'alert', 'banner', 'list'],
    },
  },
}

export default config
