// PROTOTYPE ("Juice: Screen filters"): starting looks per ?variant=. Throwaway.
import { SCREEN_FILTERS } from './ScreenFilters';

export const FILTER_VARIANTS = [
  { key: 'A', name: 'Off (today)' },
  { key: 'B', name: 'Scanlines' },
  { key: 'C', name: 'Glow' },
  { key: 'D', name: 'CRT: scanlines + glow + vignette' },
];

export function applyFilterVariant(key: string) {
  const f = SCREEN_FILTERS;
  f.scanlines = key === 'B' || key === 'D';
  f.glow = key === 'C' || key === 'D';
  f.scanStrength = key === 'D' ? 0.3 : 0.35;
  f.glowStrength = key === 'D' ? 0.7 : 0.9;
  f.vignette = key === 'D' ? 0.35 : 0;
}
