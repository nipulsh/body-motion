import { describe, expect, it } from 'vitest';
import {
  planPatientDeformityReferences,
  planSequencePatientReferences,
  selectPatientDeformityReferences,
  selectSequencePatientReferences,
} from './image-generation.service';

describe('patient reference selection', () => {
  it('picks two timed-burst frames and keeps labels from the full sequence', () => {
    const images = Array.from({ length: 80 }, (_, orderIndex) => ({
      buffer: Buffer.from(`frame-${orderIndex}`),
      mimeType: 'image/jpeg',
      orderIndex,
    }));

    const picks = planSequencePatientReferences(images, 2);
    expect(picks.map((pick) => pick.index)).toEqual([0, 79]);

    const references = selectSequencePatientReferences(images, 2);
    expect(references.map((reference) => reference.label)).toEqual(picks.map((pick) => pick.label));
    expect(references.map((reference) => reference.buffer.toString())).toEqual([
      'frame-0',
      'frame-79',
    ]);
    expect(references[0]?.label).toBe('Patient scan reference 1 (frame 1/80)');
    expect(references[1]?.label).toBe('Patient scan reference 2 (frame 80/80)');
  });

  it('samples two frames when body photos have no angles', () => {
    const images = Array.from({ length: 36 }, (_, orderIndex) => ({
      buffer: Buffer.from(`angle-${orderIndex}`),
      mimeType: 'image/jpeg',
      angle: null,
      orderIndex,
    }));

    const picks = planPatientDeformityReferences(images, 2);
    expect(picks.map((pick) => pick.index)).toEqual([0, 35]);
    const references = selectPatientDeformityReferences(images, 2);
    expect(references.map((reference) => reference.buffer.toString())).toEqual([
      'angle-0',
      'angle-35',
    ]);
    expect(references.map((reference) => reference.label)).toEqual([
      'Patient scan reference 1 (frame 1/36)',
      'Patient scan reference 2 (frame 36/36)',
    ]);
  });

  it('prefers distinct front and side angles over a second front view', () => {
    const images = [
      { buffer: Buffer.from('front'), mimeType: 'image/jpeg', angle: '0', orderIndex: 0 },
      { buffer: Buffer.from('front-again'), mimeType: 'image/jpeg', angle: '5', orderIndex: 1 },
      { buffer: Buffer.from('side'), mimeType: 'image/jpeg', angle: '90', orderIndex: 2 },
      { buffer: Buffer.from('back'), mimeType: 'image/jpeg', angle: '180', orderIndex: 3 },
    ];

    const picks = planPatientDeformityReferences(images, 2);
    expect(picks.map((pick) => pick.index)).toEqual([0, 2]);
    const references = selectPatientDeformityReferences(images, 2);
    expect(references.map((reference) => reference.label)).toEqual(picks.map((pick) => pick.label));
    expect(references.map((reference) => reference.buffer.toString())).toEqual(['front', 'side']);
  });
});
