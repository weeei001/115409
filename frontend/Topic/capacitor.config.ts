import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.stocklighthouse.app',
  appName: '股海明燈',
  webDir: 'out',
  plugins: {
    SystemBars: {
      initialViewportFitValueHint: 'cover',
      insetsHandling: 'css',
    },
  },
};

export default config;
