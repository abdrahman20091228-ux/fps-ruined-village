export const FIXED_DT = 1 / 60;
export const MAX_TRIANGLES = 500_000;

export const QUALITY_PRESETS = {
  low: {
    shadowSize: 1024,
    triTarget: 200_000,
    lodBias: 0.72,
    drawDist: 75,
  },
  medium: {
    shadowSize: 1536,
    triTarget: 320_000,
    lodBias: 1.0,
    drawDist: 105,
  },
  high: {
    shadowSize: 2048,
    triTarget: 430_000,
    lodBias: 1.25,
    drawDist: 135,
  },
};

export const DIFFICULTIES = {
  recruit: {
    label: 'Recruit',
    reactionDelay: 0.55,
    aimSpread: 0.14,
    damageMult: 0.65,
    sightRange: 26,
  },
  regular: {
    label: 'Regular',
    reactionDelay: 0.34,
    aimSpread: 0.085,
    damageMult: 1.0,
    sightRange: 34,
  },
  veteran: {
    label: 'Veteran',
    reactionDelay: 0.19,
    aimSpread: 0.048,
    damageMult: 1.35,
    sightRange: 42,
  },
};

export const DEFAULT_SETTINGS = {
  sensitivity: 1.0,
  resolutionScale: 0.85,
  quality: 'medium',
  fpsCap: 60,
  volume: 0.8,
  buttonSize: 1.0,
  buttonOffset: 0,
  showDebug: true,
  difficulty: 'regular',
};

const STORAGE_KEY = 'ashes_of_vale_settings_v1';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore private mode storage errors
  }
}
