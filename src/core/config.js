export const FIXED_DT = 1 / 60;
export const MAX_TRIANGLES = 500_000;

export const QUALITY_PRESETS = {
  low: {
    shadowSize: 512,
    shadowInterval: 4,
    triTarget: 105_000,
    lodBias: 0.65,
    drawDist: 75,
  },
  medium: {
    shadowSize: 1024,
    shadowInterval: 2,
    triTarget: 155_000,
    lodBias: 1.0,
    drawDist: 96,
  },
  high: {
    shadowSize: 1024,
    shadowInterval: 1,
    triTarget: 225_000,
    lodBias: 1.25,
    drawDist: 132,
  },
};

export const DIFFICULTIES = {
  recruit: {
    label: 'Recruit',
    reactionDelay: 0.90,
    aimSpread: 0.18,
    damageMult: 0.45,
    sightRange: 24,
  },
  regular: {
    label: 'Regular',
    reactionDelay: 0.68,
    aimSpread: 0.145,
    damageMult: 0.55,
    sightRange: 28,
  },
  veteran: {
    label: 'Veteran',
    reactionDelay: 0.34,
    aimSpread: 0.068,
    damageMult: 1.0,
    sightRange: 42,
  },
};

export const DEFAULT_SETTINGS = {
  sensitivity: 1.6,
  gyroEnabled: true,
  gyroSensitivity: 1.0,
  adsHold: true,
  resolutionScale: 0.8,
  quality: 'medium',
  fpsCap: 60,
  volume: 0.85,
  buttonSize: 1.0,
  buttonOffset: 0,
  hudOpacity: 0.9,
  customLayout: {}, // { [controlId]: { leftPct, topPct, scale } }
  showDebug: true,
  difficulty: 'regular',
};

const STORAGE_KEY = 'ashes_of_vale_settings_v6';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
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
