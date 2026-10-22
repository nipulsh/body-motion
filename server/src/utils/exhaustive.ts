export class UnreachableCaseError extends Error {
  constructor(value: never) {
    super(`Unhandled variant: ${JSON.stringify(value)}`);
    this.name = 'UnreachableCaseError';
  }
}

export function assertNever(value: never): never {
  throw new UnreachableCaseError(value);
}
