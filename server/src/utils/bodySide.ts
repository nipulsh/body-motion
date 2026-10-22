import type { BodySide } from '@prisma/client';
import type { MuscleSide } from '../schemas/analysis.schema';
import { assertNever } from './exhaustive';

export function apiSideToPrisma(side: MuscleSide): BodySide {
  switch (side) {
    case 'left':
      return 'LEFT';
    case 'right':
      return 'RIGHT';
    case 'bilateral':
      return 'BILATERAL';
    case 'midline':
      return 'MIDLINE';
    case 'unknown':
      return 'UNKNOWN';
    default:
      return assertNever(side);
  }
}

export function prismaSideToApi(side: BodySide): MuscleSide {
  switch (side) {
    case 'LEFT':
      return 'left';
    case 'RIGHT':
      return 'right';
    case 'BILATERAL':
      return 'bilateral';
    case 'MIDLINE':
      return 'midline';
    case 'UNKNOWN':
      return 'unknown';
    default:
      return assertNever(side);
  }
}
