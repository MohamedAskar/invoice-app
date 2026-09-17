import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthStore {
  session: Session | null;
  /** False until the initial session lookup finishes, so we never flash the login screen. */
  initialized: boolean;
  passwordRecovery: boolean;
  init: () => void;
  signIn: (email: string, password: string) => Promise<string | null>;
  requestPasswordRecovery: (email: string) => Promise<string | null>;
  updatePassword: (password: string) => Promise<string | null>;
  finishPasswordRecovery: () => void;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthStore>((set) => ({
  session: null,
  initialized: false,
  passwordRecovery: false,
  init: () => {
    const recoveryHash = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';
    supabase.auth.getSession().then(({ data }) => {
      set({ session: data.session, initialized: true, passwordRecovery: recoveryHash });
    });

    supabase.auth.onAuthStateChange((event, session) => {
      set({ session, initialized: true, passwordRecovery: event === 'PASSWORD_RECOVERY' });
    });
  },
  signIn: async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  },
  requestPasswordRecovery: async (email: string) => {
    const path = window.location.pathname.startsWith('/invoice-app') ? '/invoice-app/' : '/';
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${path}`,
    });
    return error ? error.message : null;
  },
  updatePassword: async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    return error ? error.message : null;
  },
  finishPasswordRecovery: () => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    set({ passwordRecovery: false });
  },
  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null });
  },
}));
