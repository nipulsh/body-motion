/**
 * Ten-pin bowling scoring (USBC rules): 10 frames, strikes and spares carry bonus
 * balls, and frame 10 gives up to three balls.
 */

export const PINS_PER_RACK = 10;
export const FRAMES_PER_GAME = 10;

export interface BowlingFrameScore {
  /** Pins knocked down by each ball rolled in this frame. */
  rolls: number[];
  /** Running total through this frame, or null until its bonus balls are rolled. */
  cumulative: number | null;
  strike: boolean;
  spare: boolean;
}

export interface BowlingGameScore {
  frames: BowlingFrameScore[];
  total: number;
  complete: boolean;
}

export interface BowlingNextRoll {
  done: boolean;
  /** 1-based frame number for the next ball. 10 once the game is over. */
  frame: number;
  /** 1-based ball within the frame. */
  ball: number;
  /** True when the next ball is rolled at a full rack of 10 pins. */
  freshRack: boolean;
}

function clampRoll(pins: number): number {
  if (!Number.isFinite(pins)) return 0;
  return Math.min(PINS_PER_RACK, Math.max(0, Math.round(pins)));
}

/** Splits a flat list of rolls into frames. Frame 10 keeps its fill balls. */
function splitFrames(rolls: readonly number[]): number[][] {
  const frames: number[][] = [];
  let i = 0;
  while (i < rolls.length && frames.length < FRAMES_PER_GAME - 1) {
    const first = rolls[i];
    if (first === PINS_PER_RACK) {
      frames.push([first]);
      i += 1;
    } else if (i + 1 < rolls.length) {
      frames.push([first, rolls[i + 1]]);
      i += 2;
    } else {
      frames.push([first]);
      i += 1;
    }
  }
  if (i < rolls.length) frames.push(rolls.slice(i, i + 3));
  return frames;
}

function isTenthComplete(tenth: readonly number[]): boolean {
  if (tenth.length < 2) return false;
  const [a, b] = tenth;
  if (a === PINS_PER_RACK || a + b === PINS_PER_RACK) return tenth.length >= 3;
  return true;
}

/**
 * Scores a game from the pins knocked down by each ball, in order. Values are
 * clamped to 0..10; callers pass pins knocked by that ball only, not a running count.
 */
export function scoreBowlingGame(rawRolls: readonly number[]): BowlingGameScore {
  const rolls = rawRolls.map(clampRoll);
  const frameRolls = splitFrames(rolls);
  const frames: BowlingFrameScore[] = [];
  let running = 0;
  let pending = false;
  let cursor = 0;

  for (let f = 0; f < frameRolls.length; f += 1) {
    const fr = frameRolls[f];
    const isTenth = f === FRAMES_PER_GAME - 1;
    const strike = fr[0] === PINS_PER_RACK;
    const spare = !strike && fr.length >= 2 && fr[0] + fr[1] === PINS_PER_RACK;

    let frameScore: number | null = null;
    if (isTenth) {
      if (isTenthComplete(fr)) frameScore = fr.reduce((sum, r) => sum + r, 0);
    } else if (strike) {
      const bonus = rolls.slice(cursor + 1, cursor + 3);
      if (bonus.length === 2) frameScore = PINS_PER_RACK + bonus[0] + bonus[1];
    } else if (spare) {
      const bonus = rolls[cursor + 2];
      if (bonus !== undefined) frameScore = PINS_PER_RACK + bonus;
    } else if (fr.length === 2) {
      frameScore = fr[0] + fr[1];
    }

    if (frameScore === null) pending = true;
    if (!pending && frameScore !== null) running += frameScore;

    frames.push({
      rolls: [...fr],
      cumulative: pending ? null : running,
      strike,
      spare,
    });
    cursor += fr.length;
  }

  const complete =
    frames.length === FRAMES_PER_GAME && isTenthComplete(frameRolls[FRAMES_PER_GAME - 1]);

  return { frames, total: running, complete };
}

/** What the next ball is: which frame, which ball, and whether the pins are reset first. */
export function nextBowlingRoll(rawRolls: readonly number[]): BowlingNextRoll {
  const rolls = rawRolls.map(clampRoll);
  const frames = splitFrames(rolls);

  if (frames.length === 0) return { done: false, frame: 1, ball: 1, freshRack: true };

  const lastIndex = frames.length - 1;
  const last = frames[lastIndex];

  if (lastIndex < FRAMES_PER_GAME - 1) {
    const frameDone = last[0] === PINS_PER_RACK || last.length === 2;
    if (frameDone) return { done: false, frame: lastIndex + 2, ball: 1, freshRack: true };
    return { done: false, frame: lastIndex + 1, ball: 2, freshRack: false };
  }

  if (isTenthComplete(last)) return { done: true, frame: FRAMES_PER_GAME, ball: last.length, freshRack: true };

  if (last.length === 1) {
    return { done: false, frame: FRAMES_PER_GAME, ball: 2, freshRack: last[0] === PINS_PER_RACK };
  }

  // Third ball of frame 10: a fresh rack after a spare or a second strike.
  const [a, b] = last;
  const freshRack = a + b === PINS_PER_RACK || (a === PINS_PER_RACK && b === PINS_PER_RACK);
  return { done: false, frame: FRAMES_PER_GAME, ball: 3, freshRack };
}

/** Score-sheet marks for one frame: X strike, / spare, - miss. */
export function frameMarks(frame: BowlingFrameScore, frameIndex: number): string[] {
  const marks: string[] = [];
  const r = frame.rolls;
  const isTenth = frameIndex === FRAMES_PER_GAME - 1;
  for (let i = 0; i < r.length; i += 1) {
    const pins = r[i];
    const prev = i > 0 ? r[i - 1] : null;
    const prevMarkedFresh = i === 0 || (isTenth && (prev === PINS_PER_RACK || marks[i - 1] === '/'));
    if (pins === PINS_PER_RACK && prevMarkedFresh) marks.push('X');
    else if (!prevMarkedFresh && prev !== null && prev + pins === PINS_PER_RACK) marks.push('/');
    else if (pins === 0) marks.push('-');
    else marks.push(String(pins));
  }
  return marks;
}
