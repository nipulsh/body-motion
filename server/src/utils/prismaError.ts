import { Prisma } from '@prisma/client';
import { AppError } from './AppError';

function messageLooksLikeAuthFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('authentication failed') ||
    lower.includes('credentials are not valid') ||
    lower.includes('credentials for')
  );
}

function messageLooksLikeUnreachable(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("can't reach database") ||
    lower.includes('cannot reach database') ||
    lower.includes('timed out') ||
    lower.includes("can't connect")
  );
}

function messageLooksLikeSchemaMismatch(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('invalid input value for enum') ||
    lower.includes('does not exist in the current database')
  );
}

function redactDbSecrets(message: string): string {
  return message
    .replace(/postgresql:\/\/[^@\s]+@/gi, 'postgresql://***@')
    .replace(/postgres:\/\/[^@\s]+@/gi, 'postgres://***@');
}

function prismaInitErrorCode(err: unknown): string | undefined {
  if (err instanceof Prisma.PrismaClientInitializationError) return err.errorCode;
  if (typeof err === 'object' && err !== null && 'errorCode' in err) {
    const code = (err as { errorCode?: unknown }).errorCode;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function isPrismaInitializationError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientInitializationError ||
    (err instanceof Error && err.name === 'PrismaClientInitializationError')
  );
}

export function mapPrismaError(err: unknown): AppError | null {
  const message = err instanceof Error ? err.message : String(err);

  if (isPrismaInitializationError(err)) {
    const errorCode = prismaInitErrorCode(err);
    if (errorCode === 'P1000' || messageLooksLikeAuthFailure(message)) {
      return AppError.databaseUnavailable('Database authentication failed.');
    }
    if (errorCode === 'P1001' || errorCode === 'P1017' || messageLooksLikeUnreachable(message)) {
      return AppError.databaseUnavailable('Cannot reach the database.');
    }
    return AppError.databaseUnavailable('Cannot reach the database.');
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P1000' || err.code === 'P1010') {
      return AppError.databaseUnavailable('Database authentication failed.');
    }
    if (err.code === 'P1001' || err.code === 'P1002' || err.code === 'P1017') {
      return AppError.databaseUnavailable('Cannot reach the database.');
    }
    if (err.code === 'P2022') {
      return AppError.databaseUnavailable('Database schema is out of date. Apply pending migrations.');
    }
  }

  if (messageLooksLikeSchemaMismatch(message)) {
    return AppError.databaseUnavailable('Database schema is out of date. Apply pending migrations.');
  }

  if (messageLooksLikeAuthFailure(message)) {
    return AppError.databaseUnavailable('Database authentication failed.');
  }

  return null;
}

export function prismaErrorLogFields(err: unknown): { name?: string; code?: string; message?: string } {
  if (err instanceof Prisma.PrismaClientInitializationError || isPrismaInitializationError(err)) {
    return {
      name: err instanceof Error ? err.name : 'PrismaClientInitializationError',
      code: prismaInitErrorCode(err),
      message: redactDbSecrets(err instanceof Error ? err.message : String(err)),
    };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return { name: err.name, code: err.code, message: redactDbSecrets(err.message) };
  }
  if (err instanceof Error) {
    return { name: err.name, message: redactDbSecrets(err.message) };
  }
  return { message: redactDbSecrets(String(err)) };
}
