// PROTOTYPE ("Juice: Screen filters"): starting looks per ?variant=. Throwaway.
// B and C follow the user's reference: an old curved monitor (bulge, rounded frame, color fringes,
// dark edges, soft glow, grain).
import { SCREEN_FILTERS } from './ScreenFilters';

export const FILTER_VARIANTS = [
  { key: 'A', name: 'Off (today)' },
  { key: 'B', name: 'Old monitor (like the reference)' },
  { key: 'C', name: 'Old monitor, heavy (+ scanlines, flicker)' },
];

const LOOKS: Record<string, Partial<typeof SCREEN_FILTERS>> = {
  A: { scanlines: false, glow: false, vignette: 0, curvature: 0, aberration: 0, noise: 0, flicker: 0, glass: 0 },
  B: {
    scanlines: true, scanStrength: 0.12, scanPeriod: 3,
    glow: true, glowStrength: 0.7, glowRadius: 2, glowThreshold: 0.2,
    vignette: 0.6, curvature: 0.22, cornerRadius: 0.07, aberration: 2.5, noise: 0.04, flicker: 0, glass: 0.045,
  },
  C: {
    scanlines: true, scanStrength: 0.4, scanPeriod: 4,
    glow: true, glowStrength: 1.1, glowRadius: 2.5, glowThreshold: 0.15,
    vignette: 0.9, curvature: 0.35, cornerRadius: 0.09, aberration: 4, noise: 0.08, flicker: 0.04, glass: 0.06,
  },
};

export function applyFilterVariant(key: string) {
  Object.assign(SCREEN_FILTERS, LOOKS[key] ?? LOOKS.A);
}
