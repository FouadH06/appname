import { createElement, useEffect } from 'react';
import { Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { ENV } from '@/lib/supabase';

// Turnstile for the app: the web app's /captcha page runs the widget on our own domain and posts the
// single-use token back (WebView on iOS/Android, iframe in the web build). Usually invisible.
export function Captcha({
  onToken,
  nonce = 0,
}: {
  onToken: (token: string) => void;
  nonce?: number;
}) {
  const src = `${ENV.webUrl}/captcha?n=${nonce}`;
  const parse = (data: unknown) => {
    try {
      const m = JSON.parse(String(data)) as { type?: string; token?: string };
      if (m.type === 'captcha' && m.token) onToken(m.token);
    } catch {
      /* not ours */
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: MessageEvent) => {
      if (e.origin === new URL(ENV.webUrl).origin) parse(e.data);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [nonce]);

  if (Platform.OS === 'web') {
    return (
      <View style={{ height: 70 }} testID="captcha">
        {createElement('iframe', {
          src,
          title: 'Verification',
          style: { border: 0, width: '100%', height: 70 },
        })}
      </View>
    );
  }
  return (
    <View style={{ height: 70 }} testID="captcha">
      <WebView
        key={nonce}
        source={{ uri: src }}
        onMessage={(e) => parse(e.nativeEvent.data)}
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}
