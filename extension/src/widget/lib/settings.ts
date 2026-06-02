export interface Settings {
  model: string;
  voice: string;
  whisperDeployment?: string;
}

const DEFAULTS: Settings = {
  model: 'gpt-realtime-mini',
  voice: 'alloy',
};

export async function loadSettings(): Promise<Settings> {
  try {
    const result = await chrome.storage.local.get(['browselee_settings']);
    const stored = (result['browselee_settings'] ?? {}) as Partial<Settings>;
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  try {
    const current = await loadSettings();
    await chrome.storage.local.set({ browselee_settings: { ...current, ...settings } });
  } catch {
    // Storage not available; silently ignore.
  }
}
