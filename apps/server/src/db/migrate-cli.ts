import { loadConfig } from '../config';
import { createLogger } from '../logger';
import { defaultMigrationsDir, migrate } from './migrate';
import { createPool } from './pool';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.LOG_PRETTY);
const db = createPool({ url: config.DATABASE_URL, max: 2, ssl: config.DATABASE_SSL, logger });

try {
  const applied = await migrate(db, defaultMigrationsDir(), logger);
  logger.info({ applied }, 'migrations complete');
} catch (err) {
  logger.fatal({ err }, 'migration failed');
  process.exitCode = 1;
} finally {
  await db.end();
}
