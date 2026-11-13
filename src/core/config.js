export const FIXED_DT = 1 / 60;
export const MAX_TRIANGLES = 500_000;

export const QUALITY_PRESETS = {
  low: {
    shadowSize: 1024,
    triTarget: 180_000,
    lodBias: 0.72,
    drawDist: 75,
  },
  medium: {
    shadowSize: 1024,
    triTarget: 280_000,
    lodBias: 1.0,
    drawDist: 92,
  },
  high: {
    shadowSize: 1536,
    triTarget: 400_000,
    lodBias: 1.22,
    drawDist: 130,
  },
};

export const DIFFICULTIES = {
  recruit: {
    label: 'Recruit',
    reactionDelay: 0.85,
    aimSpread: 0.165,
    damageMult: 0.55,
    sightRange: 25,
  },
  regular: {
    label: 'Regular',
    reactionDelay: 0.56,
    aimSpread: 0.115,
    damageMult: 0.72,
    sightRange: 32,
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
  sensitivity: 2.4,
  gyroEnabled: true,
  gyroSensitivity: 2.6,
  adsHold: true,
  resolutionScale: 0.8,
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

const STORAGE_KEY = 'ashes_of_vale_settings_v3';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('ashes_of_vale_settings_v2');
    if (!raw) return { ...DEFAULT_SETTINGS, customLayout: {} };
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
