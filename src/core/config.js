export const FIXED_DT = 1 / 60;
export const MAX_TRIANGLES = 500_000;

export const QUALITY_PRESETS = {
  low: {
    resFactor: 0.80,
    triTarget: 135_000,
    lodBias: 0.72,
    drawDist: 82,
    shadowBlobs: true,
    dynamicBlobs: false,
  },
  medium: {
    resFactor: 1.0,
    triTarget: 195_000,
    lodBias: 1.0,
    drawDist: 108,
    shadowBlobs: true,
    dynamicBlobs: true,
  },
  high: {
    resFactor: 1.15,
    triTarget: 260_000,
    lodBias: 1.3,
    drawDist: 145,
    shadowBlobs: true,
    dynamicBlobs: true,
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
  adsSensitivity: 0.75,
  gyroMode: 'always', // 'always' | 'ads' | 'off'
  gyroEnabled: true,
  gyroSensitivity: 1.0,
  gyroInvertX: false,
  gyroInvertY: false,
  gyroSwapAxes: false,
  preferredWeapon: 'm4',
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

const STORAGE_KEY = 'ashes_of_vale_settings_v7';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('ashes_of_vale_settings_v6');
    if (!raw) {
      return { ...DEFAULT_SETTINGS, customLayout: {} };
    }
    const parsed = JSON.parse(raw);
    const merged = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      customLayout: parsed?.customLayout && typeof parsed.customLayout === 'object' ? { ...parsed.customLayout } : {},
    };
    if (!parsed?.gyroMode) {
      merged.gyroMode = merged.gyroEnabled === false ? 'off' : 'always';
    }
    merged.gyroEnabled = merged.gyroMode !== 'off';
    return merged;
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
