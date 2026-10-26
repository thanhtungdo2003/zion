import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * Content updates for the desktop app. `DESKTOP_UPDATE_DIR` holds what `pnpm --filter
 * @zion/desktop build` writes to apps/desktop/release/update:
 *
 *   manifest.json   { version, builtAt, files: { "<path>": ["<sha256>", size] } }
 *   blobs/<sha256>  every file of the bundled web client (pages, scripts, models, sounds)
 *
 * The app fetches the manifest at start and every few minutes, then downloads only the blobs it
 * does not have. Blobs are addressed by their hash, so a URL can never name a path outside the
 * folder and every blob may be cached forever.
 */
export function registerDesktopRoutes(app: FastifyInstance, dir: string | undefined): void {
  const off = (reply: { code(n: number): { send(b: unknown): unknown } }) => reply.code(404).send({ error: 'not_found', message: 'desktop updates are not published on this server' });

  app.get('/api/desktop/manifest', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => {
    if (!dir) return off(reply);
    try {
      const body = await readFile(path.join(dir, 'manifest.json'));
      return reply.header('cache-control', 'no-cache').type('application/json').send(body);
    } catch { return off(reply); }
  });

  // A full update is hundreds of files: blobs are exempt from the global request limit.
  app.get<{ Params: { sha: string } }>('/api/desktop/blobs/:sha', { config: { rateLimit: false }, logLevel: 'warn' }, async (req, reply) => {
    if (!dir) return off(reply);
    const { sha } = req.params;
    if (!/^[0-9a-f]{64}$/.test(sha)) return reply.code(400).send({ error: 'bad_request', message: 'bad blob id' });
    const file = path.join(dir, 'blobs', sha);
    try {
      const s = await stat(file);
      return reply.header('cache-control', 'public, max-age=31536000, immutable').header('content-length', String(s.size))
        .type('application/octet-stream').send(createReadStream(file));
    } catch { return reply.code(404).send({ error: 'not_found', message: 'no such blob' }); }
  });
}
