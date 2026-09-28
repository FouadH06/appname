'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@app/api';
import { supabase } from './supabase';

/** Current session; `signedIn` means a real (non-anonymous) account. */
export function useSession() {
  const [state, setState] = useState<{ loading: boolean; session: Session | null }>({
    loading: true,
    session: null,
  });
  useEffect(() => {
    const client = supabase();
    void client.auth
      .getSession()
      .then(({ data }) => setState({ loading: false, session: data.session }));
    const { data } = client.auth.onAuthStateChange((_e, session) =>
      setState({ loading: false, session }),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  const signedIn = !!state.session && !state.session.user.is_anonymous;
  return { ...state, signedIn };
}
