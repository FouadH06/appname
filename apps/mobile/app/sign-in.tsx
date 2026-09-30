import { router } from 'expo-router';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { Screen } from '@/components/ui';

// Sign-in sheet (favorite ♡ while signed out, etc.). Phone + WhatsApp/SMS code; no passwords.
export default function SignIn() {
  return (
    <Screen>
      <PhoneSignIn
        onVerified={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        intro="Verify your phone to save places and manage your bookings."
      />
    </Screen>
  );
}
