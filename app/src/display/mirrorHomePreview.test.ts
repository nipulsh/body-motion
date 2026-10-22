import { describe, expect, it } from 'vitest';
import { isMirrorHomePreview } from './mirrorHomePreview';

describe('isMirrorHomePreview', () => {
  it('matches the mirror-home query string', () => {
    expect(isMirrorHomePreview('?screen=mirror-home')).toBe(true);
    expect(isMirrorHomePreview('screen=mirror-home')).toBe(true);
    expect(isMirrorHomePreview('?screen=smart-mirror')).toBe(false);
  });
});
