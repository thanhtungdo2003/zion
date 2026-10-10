import type { GameContent } from '@zion/shared';
/**
 * Thin client for the auth/game HTTP API. The access token lives only in memory; the refresh
 * token is an httpOnly SameSite=Strict cookie the browser manages (never readable by JS).
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface AccountInfo {
  id: string;
  username: string;
  guest: boolean;
  role: string;
}

interface SessionResponse {
  accessToken: string;
  expiresIn: number;
  account: AccountInfo;
}

export interface TicketResponse {
  ticket: string;
  expiresIn: number;
  wsUrl: string;
  protocolVersion: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let accessExpiresAt = 0;
let account: AccountInfo | null = null;
let refreshing: Promise<boolean> | null = null;

/**
 * Non-sensitive hint that a refresh cookie probably exists (the cookie itself is httpOnly), so
 * first-time visitors don't fire a refresh request that is guaranteed to fail.
 */
const SESSION_HINT = 'zion_session_hint';
function setHint(on: boolean): void {
  try {
    if (on) localStorage.setItem(SESSION_HINT, '1');
    else localStorage.removeItem(SESSION_HINT);
  } catch {
    /* storage unavailable */
  }
}
function hasHint(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT) === '1';
  } catch {
    return true;
  }
}

async function request<T>(path: string, init: RequestInit & { auth?: boolean; csrf?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.auth && accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  if (init.csrf) headers.set('x-zion-csrf', '1');
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include', cache: 'no-store' });
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, b.error ?? 'error', b.message ?? `request failed (${res.status})`);
  }
  return body as T;
}

function adopt(s: SessionResponse): AccountInfo {
  accessToken = s.accessToken;
  accessExpiresAt = Date.now() + s.expiresIn * 1000;
  account = s.account;
  setHint(true);
  return s.account;
}

export async function register(username: string, password: string): Promise<AccountInfo> {
  return adopt(await request<SessionResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }));
}

export async function login(username: string, password: string): Promise<AccountInfo> {
  return adopt(await request<SessionResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }));
}

export async function playAsGuest(): Promise<AccountInfo> {
  return adopt(await request<SessionResponse>('/api/auth/guest', { method: 'POST', body: JSON.stringify({}) }));
}

/** Restores a session from the refresh cookie. Resolves false when there is none. */
export function refreshSession(): Promise<boolean> {
  if (!hasHint()) return Promise.resolve(false);
  refreshing ??= request<SessionResponse>('/api/auth/refresh', { method: 'POST', csrf: true, body: JSON.stringify({}) })
    .then((s) => {
      adopt(s);
      return true;
    })
    .catch(() => {
      accessToken = null;
      account = null;
      setHint(false);
      return false;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function logout(): Promise<void> {
  try {
    await request('/api/auth/logout', { method: 'POST', csrf: true, body: JSON.stringify({}) });
  } finally {
    accessToken = null;
    account = null;
    setHint(false);
  }
}

async function ensureAccess(): Promise<void> {
  if (accessToken && Date.now() < accessExpiresAt - 30_000) return;
  if (!(await refreshSession())) throw new ApiError(401, 'unauthorized', 'please sign in');
}

export async function getGameTicket(): Promise<TicketResponse> {
  await ensureAccess();
  return request<TicketResponse>('/api/game/ticket', { method: 'POST', auth: true, body: JSON.stringify({}) });
}

export function currentAccount(): AccountInfo | null {
  return account;
}

/* ------------------------------------------------------------------ Camp Studio */

export interface StudioPart {
  asset: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** Structure group: parts of one wall/building fade together in game (absent = auto/none). */
  group?: number;
}

export interface StudioLayout {
  parts: StudioPart[];
  customised: boolean;
  camp: { x: number; y: number; z: number; halfSize: number } | null;
  updatedAt: string | null;
  npcs: StudioNpcs;
}

/** Camp NPC spots (camp-local metres). */
export interface StudioNpcs {
  merchant: { x: number; z: number };
  nurse: { x: number; z: number };
  guards: Array<{ x: number; z: number }>;
}

export interface StudioTerrain {
  size: number;
  step: number;
  origin: number;
  heights: number[];
  water: number;
}

const STUDIO_TOKEN_KEY = 'zion.studio.token';

function studioToken(): string | null {
  try {
    const raw = sessionStorage.getItem(STUDIO_TOKEN_KEY);
    if (!raw) return null;
    const { token, expiresAt } = JSON.parse(raw) as { token: string; expiresAt: number };
    return Date.now() < expiresAt - 60_000 ? token : null;
  } catch {
    return null;
  }
}

/** True while a studio password session is active in this tab. */
export function hasStudioSession(): boolean {
  return studioToken() !== null;
}

/** Unlocks the studio with its password (no game account needed); kept for this browser tab. */
export async function studioLogin(password: string): Promise<void> {
  const s = await request<{ token: string; expiresAt: number }>('/api/studio/login', { method: 'POST', body: JSON.stringify({ password }) });
  try {
    sessionStorage.setItem(STUDIO_TOKEN_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the session lasts until reload */
  }
  memoryStudioToken = s.token;
}

export function studioLogout(): void {
  memoryStudioToken = null;
  try {
    sessionStorage.removeItem(STUDIO_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

let memoryStudioToken: string | null = null;

/** Studio requests use the password session when there is one, else the game account. */
async function studioRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = studioToken() ?? memoryStudioToken;
  if (token) return request<T>(path, { ...init, headers: { ...(init.headers as Record<string, string>), 'x-studio-token': token } });
  await ensureAccess();
  return request<T>(path, { ...init, auth: true });
}

export function studioLoad(): Promise<StudioLayout> {
  return studioRequest<StudioLayout>('/api/studio/layout');
}

export function studioSave(parts: StudioPart[], npcs: StudioNpcs): Promise<StudioLayout> {
  return studioRequest<StudioLayout>('/api/studio/layout', { method: 'POST', body: JSON.stringify({ parts, npcs }) });
}

export function studioTerrain(): Promise<StudioTerrain> {
  return studioRequest<StudioTerrain>('/api/studio/terrain');
}

export function studioReset(): Promise<StudioLayout> {
  return studioRequest<StudioLayout>('/api/studio/reset', { method: 'POST', body: JSON.stringify({}) });
}

export function studioContent(): Promise<GameContent> {
  return studioRequest('/api/studio/content');
}
export function studioSaveContent(content: GameContent): Promise<GameContent> {
  return studioRequest('/api/studio/content', { method: 'POST', body: JSON.stringify(content) });
}

export interface PlayerProgress { id: string; username: string; journal: Record<string, { status: string; stage: number; progress: number }> }
export function studioPlayers(): Promise<PlayerProgress[]> { return studioRequest('/api/studio/players'); }
export function studioResetProgress(accountId?: string): Promise<{ ok: boolean }> { return studioRequest('/api/studio/players/reset', { method: 'POST', body: JSON.stringify(accountId ? { accountId } : { all: true }) }); }
