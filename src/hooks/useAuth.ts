import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthStore {
  session: Session | null;
  /** False until the initial session lookup finishes, so we never flash the login screen. */
  initialized: boolean;
  init: () => void;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthStore>((set) => ({
  session: null,
  initialized: false,
  init: () => {
    supabase.auth.getSession().then(({ data }) => {
      set({ session: data.session, initialized: true });
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, initialized: true });
    });
  },
  signIn: async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  },
  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null });
  },
}));
