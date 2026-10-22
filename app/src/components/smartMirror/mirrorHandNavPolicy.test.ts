import { describe, expect, it } from 'vitest';
import { isMirrorHandNavEnabled } from './mirrorHandNavPolicy';

describe('isMirrorHandNavEnabled', () => {
  it('enables mirror kiosk stages by default', () => {
    expect(isMirrorHandNavEnabled('mirror_home', false)).toBe(true);
    expect(isMirrorHandNavEnabled('mirror_results', false)).toBe(true);
    expect(isMirrorHandNavEnabled('mirror_exercise_plan', false)).toBe(true);
    expect(isMirrorHandNavEnabled('mirror_exercise_session', false)).toBe(true);
  });

  it('disables during balance bird game', () => {
    expect(isMirrorHandNavEnabled('balance_bird_game', false)).toBe(false);
  });

  it('disables analyse while capture session is active', () => {
    expect(isMirrorHandNavEnabled('mirror_analysis', false)).toBe(true);
    expect(isMirrorHandNavEnabled('mirror_analysis', true)).toBe(false);
  });

  it('disables non-mirror clinical stages', () => {
    expect(isMirrorHandNavEnabled('dashboard', false)).toBe(false);
    expect(isMirrorHandNavEnabled('scanning', false)).toBe(false);
    expect(isMirrorHandNavEnabled('welcome', false)).toBe(false);
  });
});
