import { create } from 'zustand';
import { BusinessSettings, defaultBusinessSettings } from '@/types/invoice';
import { getSettings, saveSettings } from '@/lib/storage';

interface SettingsStore {
  settings: BusinessSettings;
  loading: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (settings: BusinessSettings) => Promise<void>;
  resetSettings: () => Promise<void>;
}

export const useSettings = create<SettingsStore>((set) => ({
  settings: defaultBusinessSettings,
  loading: false,
  loadSettings: async () => {
    set({ loading: true });
    const settings = await getSettings();
    set({ settings, loading: false });
  },
  updateSettings: async (settings: BusinessSettings) => {
    await saveSettings(settings);
    set({ settings });
  },
  resetSettings: async () => {
    await saveSettings(defaultBusinessSettings);
    set({ settings: defaultBusinessSettings });
  },
}));
