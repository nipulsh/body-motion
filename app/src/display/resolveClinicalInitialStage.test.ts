import { describe, expect, it } from 'vitest';
import { resolveClinicalInitialStage } from './resolveClinicalInitialStage';

describe('resolveClinicalInitialStage', () => {
  it('always boots to mirror home for kiosk mode', () => {
    expect(resolveClinicalInitialStage('', null)).toBe('mirror_home');
    expect(resolveClinicalInitialStage('?screen=mirror-home', 'main')).toBe('mirror_home');
    expect(resolveClinicalInitialStage('', 'main')).toBe('mirror_home');
  });
});
