import pino, { type Logger } from 'pino';

/** Structured JSON logger. Secrets are redacted by path wherever they may appear. */
export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    base: { service: 'zion-server' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.passwordHash',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        '*.ticket',
        'password',
        'ticket',
      ],
      censor: '[redacted]',
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } } } : {}),
  });
}

export type { Logger };
