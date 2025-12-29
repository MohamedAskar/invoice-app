import { create } from 'zustand';
import { BusinessSettings, defaultBusinessSettings } from '@/types/invoice';
import { getSettings, saveSettings } from '@/lib/storage';

interface SettingsStore {
  settings: BusinessSettings;
  loadSettings: () => void;
  updateSettings: (settings: BusinessSettings) => void;
  resetSettings: () => void;
}

export const useSettings = create<SettingsStore>((set) => ({
  settings: getSettings(),
  loadSettings: () => {
    set({ settings: getSettings() });
  },
  updateSettings: (settings: BusinessSettings) => {
    saveSettings(settings);
    set({ settings });
  },
  resetSettings: () => {
    saveSettings(defaultBusinessSettings);
    set({ settings: defaultBusinessSettings });
  },
}));

