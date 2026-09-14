import type { CapacitorConfig } from '@capacitor/cli';

type UnboundMobileEnvironment = 'store' | 'remote-dev';

const environment = String(process.env.UNBOUND_MOBILE_ENV || 'store') as UnboundMobileEnvironment;
if (environment !== 'store' && environment !== 'remote-dev') {
  throw new Error(`Unsupported UNBOUND_MOBILE_ENV: ${environment}`);
}

const baseConfig: CapacitorConfig = {
  appId: 'ai.unbound.app',
  appName: 'UNBOUND AI',
  webDir: 'www',
  plugins: {
    SplashScreen: {
      launchShowDuration: 1800,
      launchAutoHide: true,
      backgroundColor: '#000000',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true
    },
    StatusBar: {
      backgroundColor: '#000000',
      overlaysWebView: false
    }
  },
  android: {
    backgroundColor: '#000000',
    allowMixedContent: false,
    captureInput: true
  },
  ios: {
    backgroundColor: '#000000',
    contentInset: 'automatic',
    preferredContentMode: 'mobile'
  }
};

const remoteDevelopmentServer: NonNullable<CapacitorConfig['server']> = {
  url: 'https://unbound-ai-app.onrender.com',
  cleartext: false,
  allowNavigation: ['unbound-ai-app.onrender.com']
};

const config: CapacitorConfig = environment === 'remote-dev'
  ? { ...baseConfig, server: remoteDevelopmentServer }
  : baseConfig;

export default config;
