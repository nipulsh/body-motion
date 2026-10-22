import { describe, expect, it } from 'vitest';
import { formatMirrorHandUnavailableMessage } from './mirrorHandStatusCopy';

describe('formatMirrorHandUnavailableMessage', () => {
  it('avoids double periods in the footer copy', () => {
    expect(
      formatMirrorHandUnavailableMessage('The camera is already in use or could not be started.'),
    ).toBe(
      'Hand control unavailable: The camera is already in use or could not be started. Use touch or mouse.',
    );
  });
});
