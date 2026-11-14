export const FIXED_DT = 1 / 60;
export const MAX_TRIANGLES = 500_000;

export const QUALITY_PRESETS = {
  low: {
    shadowSize: 512,
    shadowInterval: 3,
    triTarget: 160_000,
    lodBias: 0.72,
    drawDist: 75,
  },
  medium: {
    shadowSize: 1024,
    shadowInterval: 2,
    triTarget: 260_000,
    lodBias: 1.0,
    drawDist: 92,
  },
  high: {
    shadowSize: 1024,
    shadowInterval: 1,
    triTarget: 380_000,
    lodBias: 1.22,
    drawDist: 130,
  },
};

export const DIFFICULTIES = {
  recruit: {
    label: 'Recruit',
    reactionDelay: 0.90,
    aimSpread: 0.19,
    damageMult: 0.45,
    sightRange: 22,
  },
  regular: {
    label: 'Regular',
    reactionDelay: 0.72,
    aimSpread: 0.155,
    damageMult: 0.50,
    sightRange: 25,
  },
  veteran: {
    label: 'Veteran',
    reactionDelay: 0.34,
    aimSpread: 0.068,
    damageMult: 1.0,
    sightRange: 40,
  },
};

export const DEFAULT_SETTINGS = {
  sensitivity: 1.6,
  gyroEnabled: true,
  gyroSensitivity: 1.0,
  adsHold: true,
  resolutionScale: 0.75,
  quality: 'medium',
  fpsCap: 60,
  volume: 0.8,
  buttonSize: 1.0,
  buttonOffset: 0,
  hudOpacity: 0.9,
  customLayout: {}, // { [controlId]: { leftPct, topPct, scale } }
  showDebug: true,
  difficulty: 'regular',
};

const STORAGE_KEY = 'ashes_of_vale_settings_v4';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Carry forward custom HUD button layout from v3 if present without keeping old harsh gyro/sens
      const prevRaw = localStorage.getItem('ashes_of_vale_settings_v3');
      if (prevRaw) {
        const prev = JSON.parse(prevRaw);
        return {
          ...DEFAULT_SETTINGS,
          customLayout: prev?.customLayout && typeof prev.customLayout === 'object' ? { ...prev.customLayout } : {},
        };
      }
      return { ...DEFAULT_SETTINGS, customLayout: {} };
    }
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      customLayout: parsed?.customLayout && typeof parsed.customLayout === 'object' ? { ...parsed.customLayout } : {},
    };
  } catch {
    return { ...DEFAULT_SETTINGS, customLayout: {} };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore private mode storage errors
  }
}
