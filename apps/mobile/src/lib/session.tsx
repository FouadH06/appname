import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@app/api';
import { supabase } from './supabase';

// One session for the whole app. "signedIn" = a phone-verified account (anonymous sessions only exist
// while holding a slot during booking).
interface SessionState {
  session: Session | null;
  loading: boolean;
  signedIn: boolean;
  userId: string | null;
}

const Ctx = createContext<SessionState>({
  session: null,
  loading: true,
  signedIn: false,
  userId: null,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void supabase()
      .auth.getSession()
      .then(({ data }) => {
        setSession(data.session);
        setLoading(false);
      });
    const { data } = supabase().auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const signedIn = !!session && !session.user.is_anonymous;
  return (
    <Ctx.Provider
      value={{ session, loading, signedIn, userId: signedIn ? session!.user.id : null }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useSession = () => useContext(Ctx);
