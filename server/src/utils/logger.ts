import { env } from '../config/env';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold = LEVEL_WEIGHT[env.LOG_LEVEL];

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_WEIGHT[level] < threshold) return;

  const line = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ?? {}),
  };

  const serialised = JSON.stringify(line, (_key, value: unknown) =>
    value instanceof Error ? { name: value.name, message: value.message } : value,
  );

  if (level === 'error') {
    process.stderr.write(`${serialised}\n`);
    return;
  }
  process.stdout.write(`${serialised}\n`);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
