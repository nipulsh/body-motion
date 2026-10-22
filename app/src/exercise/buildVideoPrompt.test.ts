import { describe, expect, it } from 'vitest';
import { buildExerciseVideoPrompt } from './buildVideoPrompt';

const shoulderAbduction = {
  id: 'shoulder_abduction_001',
  name: 'Shoulder Abduction',
  description: 'Raise one arm out to the side to shoulder height.',
  instructions: ['Stand tall with arms at your sides', 'Raise your arm slowly to the side'],
  safetyNotes: ['Stop if you feel sharp pain'],
  trackingRules: [
    {
      joint: 'right_shoulder',
      movement: 'abduction',
      startingPosition: 'Arm resting at side (~20°)',
      targetPosition: 'Arm at shoulder height (~90°)',
      startAngle: 20,
      requiredAngle: 90,
      holdDurationSeconds: 1,
    },
  ],
};

describe('buildExerciseVideoPrompt', () => {
  it('includes stable exercise id and tracking rules', () => {
    const prompt = buildExerciseVideoPrompt(shoulderAbduction);
    expect(prompt).toContain('Stable exercise id: shoulder_abduction_001');
    expect(prompt).toContain('Shoulder Abduction');
    expect(prompt).toContain('right_shoulder');
    expect(prompt).toContain('abduction');
  });

  it('requires static camera and transparent background', () => {
    const prompt = buildExerciseVideoPrompt(shoulderAbduction);
    expect(prompt).toContain('STATIC camera');
    expect(prompt).toContain('transparent');
    expect(prompt).toContain('NO audio');
  });

  it('describes loopable physiotherapy animation sequence', () => {
    const prompt = buildExerciseVideoPrompt(shoulderAbduction);
    expect(prompt).toContain('loops cleanly');
    expect(prompt).toContain('Return slowly to starting position');
    expect(prompt).toContain('Hold at target: 1 seconds');
  });

  it('uses recommended output filename based on exercise id', () => {
    const prompt = buildExerciseVideoPrompt(shoulderAbduction);
    expect(prompt).toContain('shoulder_abduction_001.webm');
  });

  it('states that video is not used for rep detection', () => {
    const prompt = buildExerciseVideoPrompt(shoulderAbduction);
    expect(prompt).toContain('NOT used for rep counting');
  });
});
