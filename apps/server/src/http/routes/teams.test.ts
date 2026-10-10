import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamService } from '../../game/teams';
import { registerTeamRoutes } from './teams';
import type { HttpDeps } from '../app';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
async function setup() {
  const app = Fastify(); apps.push(app);
  const service = new TeamService([], vi.fn(async () => {}));
  app.decorate('requireAuth', async (req, reply) => {
    const id = req.headers.authorization;
    if (!id) { await reply.code(401).send({ error: 'unauthorized' }); return; }
    req.claims = { sub: id, name: id, role: 'player', guest: true };
  });
  app.setErrorHandler((err, _req, reply) => reply.code(err instanceof ZodError ? 400 : 500).send({ error: 'invalid_request' }));
  registerTeamRoutes(app, { teams: service } as HttpDeps);
  return { app, service };
}
describe('authenticated team HTTP routes', () => {
  it('requires authentication and uses authenticated identity rather than body fields', async () => {
    const { app, service } = await setup();
    expect((await app.inject('/api/teams')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/teams', payload: { op: 'create', name: 'Squad', public: true } })).statusCode).toBe(401);
    const headers = { authorization: 'alpha' };
    expect((await app.inject({ method: 'POST', url: '/api/teams', headers, payload: { op: 'create', name: 'Squad', public: true, accountId: 'victim' } })).statusCode).toBe(400);
    const created = await app.inject({ method: 'POST', url: '/api/teams', headers, payload: { op: 'create', name: 'Squad', public: true } });
    expect(created.statusCode).toBe(200);
    expect(service.view('alpha')!.leaderId).toBe('alpha');
    const other = await app.inject({ url: '/api/teams', headers: { authorization: 'other' } });
    expect(other.json().team).toBeNull();
    expect(other.headers['cache-control']).toBe('no-store');
    expect(other.json().available[0]).not.toHaveProperty('code');
  });
  it('validates inputs and returns membership errors without internal failures', async () => {
    const { app } = await setup();
    const headers = { authorization: 'alpha' };
    for (const payload of [{ op: 'create', name: 'ab', public: true }, { op: 'join', code: 'bad' }, { op: 'chat', text: '\u0000' }, { op: 'kick', accountId: 'not-uuid' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/teams', headers, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'POST', url: '/api/teams', headers, payload: { op: 'join', code: '12345678' } })).statusCode).toBe(404);
  });
});
