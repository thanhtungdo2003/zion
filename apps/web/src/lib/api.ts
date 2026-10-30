import type { CareerView, LeaderboardView, RankConfig, StudioCurrencyGrant, StudioCurrencyPlayer, StudioCurrencyResult } from '@zion/shared';
import type { AtlasTile, CustomWeapon, GameContent, GameMode, InfectionMapDef, InfectionMaps, TeamAction, TeamLobby, WorldAtlas } from '@zion/shared';
import { serverMessage } from './i18n';
import { settingsStore } from './settings';
import type { HandbookEntry, NewsAction, NewsDraft, NewsPost } from '@zion/shared';
import type { WaveBoard, WaveLeaderboard } from '@zion/shared';
import { parseAppearance, type Appearance } from '@zion/shared';
/**
 * Thin client for the auth/game HTTP API. The access token lives only in memory; the refresh
 * token is an httpOnly SameSite=Strict cookie the browser manages (never readable by JS).
 */
/** 'same-origin' (the desktop app): the API is reached through the page's own origin (its local proxy). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL === 'same-origin' ? '' : process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
/** The desktop app (it signs in through the website in the system browser). */
export const IS_DESKTOP = process.env.NEXT_PUBLIC_API_URL === 'same-origin';

export function getLeaderboard(signal?: AbortSignal): Promise<LeaderboardView> {
  return request('/api/leaderboard', { signal });
}

/** The battle royale map of the match being played (from the play URL), if not the built-in island. */
export function playedBattleMap(): string | null {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('map');
  return id && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && id !== 'hac-son' ? id : null;
}
const atlasQuery = (mode?: GameMode) => {
  if (!mode || mode === 'survival') return '';
  const map = mode === 'battle-royale' || mode === 'infection' || mode === 'warfare' ? playedBattleMap() : null;
  return `?mode=${mode}${map ? `&map=${map}` : ''}`;
};

export async function getWorldAtlas(mode?: GameMode): Promise<WorldAtlas> {
  await ensureAccess();
  return request<WorldAtlas>(`/api/game/atlas${atlasQuery(mode)}`, { auth: true });
}

export async function getAtlasTile(x: number, z: number, mode?: GameMode): Promise<AtlasTile> {
  await ensureAccess();
  return request<AtlasTile>(`/api/game/atlas/${x}/${z}${atlasQuery(mode)}`, { auth: true });
}

export interface BattleMapInfo { id: string; name: string; thumbnail: string | null; players: number; matches: number; builtin?: boolean }
/** Battle royale maps (the island first) with their live player counts. */
/** Infection maps for the menu's picker (ids and names; no thumbnails). */
export async function listInfectionMaps(): Promise<BattleMapInfo[]> {
  return (await request<{ maps: Array<{ id: string; name: string; players: number; ready: boolean }> }>('/api/infection/maps')).maps.filter((m) => m.ready).map((m) => ({ id: m.id, name: m.name, thumbnail: null, players: m.players, matches: 0 }));
}
export async function listBattleMaps(): Promise<BattleMapInfo[]> {
  return (await request<{ maps: BattleMapInfo[] }>('/api/battle/maps')).maps;
}
/** Publishes a World Studio map to the server as a playable battle royale map. */
export function studioPublishBattleMap(body: { id: string; name: string; thumbnail?: string; seaLevel: number; map: unknown; source?: unknown; warfare?: unknown; modes?: string[] }): Promise<{ id: string; name: string }> {
  return studioRequest('/api/studio/battle-maps', { method: 'POST', body: JSON.stringify(body) });
}
/** Warfare on a published World Studio map: set (or clear with null) its battlefield. */
export function studioSetBattleMapWarfare(id: string, warfare: unknown): Promise<{ id: string; warfare: unknown }> {
  return studioRequest(`/api/studio/battle-maps/${encodeURIComponent(id)}/warfare`, { method: 'PUT', body: JSON.stringify({ warfare }) });
}
/** The game modes a published World Studio map is offered in (no rebuild). */
export function studioSetBattleMapModes(id: string, modes: string[]): Promise<{ id: string; modes: string[] }> {
  return studioRequest(`/api/studio/battle-maps/${encodeURIComponent(id)}/modes`, { method: 'PUT', body: JSON.stringify({ modes }) });
}
/** A battle map stored on the server, as the World Studio lists it. */
export interface PublishedBattleMap { id: string; name: string; thumbnail: string | null; updatedAt: string; live: boolean; error?: string; players: number; matches: number; editable: boolean; bytes: number; warfare?: boolean; modes?: string[] }
/** Every battle map stored on the server (also those published from other machines or not currently playable). */
export async function studioBattleMaps(): Promise<PublishedBattleMap[]> {
  return (await studioRequest<{ maps: PublishedBattleMap[] }>('/api/studio/battle-maps')).maps;
}
export function studioBattleMap(id: string): Promise<{ id: string; name: string; seaLevel: number; map: unknown; source: unknown }> {
  return studioRequest(`/api/studio/battle-maps/${encodeURIComponent(id)}`);
}
export function studioUnpublishBattleMap(id: string): Promise<{ ok: true }> {
  return studioRequest(`/api/studio/battle-maps/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
/** The server id a studio map is published under. */
export const publishedMapId = (localId: string) => localId.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 63);

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
    super(serverMessage(settingsStore.get().lang, message, code));
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
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (init.auth && accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  if (init.csrf) headers.set('x-zion-csrf', '1');
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include', cache: 'no-store' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network', 'Failed to fetch');
  }
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

export async function playAsGuest(username: string): Promise<AccountInfo> {
  return adopt(await request<SessionResponse>('/api/auth/guest', { method: 'POST', body: JSON.stringify({ username }) }));
}

/** Restores a session from the refresh cookie. Resolves false when there is none. */
export function refreshSession(force = false): Promise<boolean> {
  if (!force && !hasHint()) return Promise.resolve(false);
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

export type SocialProvider = 'google' | 'facebook';
export function authProviders(): Promise<{ providers: Record<SocialProvider, boolean>; guest: boolean }> {
  return request('/api/auth/providers');
}
export async function linkedProviders(): Promise<SocialProvider[]> {
  await ensureAccess();
  return (await request<{ providers: SocialProvider[] }>('/api/auth/identities', { auth: true })).providers;
}
export async function startSocialAuth(provider: SocialProvider, link: boolean): Promise<void> {
  if (link) await ensureAccess();
  const result = await request<{ authorizationUrl: string }>(`/api/auth/oauth/${provider}/${link ? 'link' : 'start'}`, { method: 'POST', auth: link, body: '{}' });
  window.location.assign(result.authorizationUrl);
}

/** Desktop: a sign-in request the player confirms on the website (opened in the system browser). */
export interface DesktopSignIn { id: string; secret: string; code: string; url: string; expiresIn: number }
export function startDesktopSignIn(): Promise<DesktopSignIn> {
  return request('/api/auth/desktop/start', { method: 'POST', body: '{}' });
}
/** The account once the website confirmed the request, null while it waits. */
export async function pollDesktopSignIn(req: DesktopSignIn): Promise<AccountInfo | null> {
  const res = await request<SessionResponse | { pending: true }>('/api/auth/desktop/poll', { method: 'POST', body: JSON.stringify({ id: req.id, secret: req.secret }) });
  return 'pending' in res ? null : adopt(res);
}
/** Website: hands the signed-in account to the desktop app that asked. */
export async function approveDesktopSignIn(id: string): Promise<void> {
  await ensureAccess();
  await request('/api/auth/desktop/approve', { method: 'POST', auth: true, body: JSON.stringify({ id }) });
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

/** Survival teams and battle royale squads are separate lobbies, picked by mode. */
const teamUrl = (mode: GameMode) => mode === 'battle-royale' ? '/api/teams?mode=battle-royale' : mode === 'waves' ? '/api/teams?mode=waves' : mode === 'warfare' ? '/api/teams?mode=warfare' : '/api/teams';

/** Warfare: the published maps the admin turned Warfare on for, with how many play there. */
export async function listWarfareMaps(): Promise<BattleMapInfo[]> {
  return (await request<{ maps: Array<{ id: string; name: string; thumbnail: string | null; players: number }> }>('/api/warfare/maps')).maps.map((m) => ({ ...m, matches: 0 }));
}

/** Zombie Wave Survival: playable maps and one leaderboard (map × board). */
export async function listWaveMaps(): Promise<BattleMapInfo[]> {
  return (await request<{ maps: Array<{ id: string; name: string; thumbnail: string | null; players: number }> }>('/api/waves/maps')).maps.map((m) => ({ ...m, matches: 0 }));
}
export async function getWaveLeaderboard(map: string, board: WaveBoard): Promise<WaveLeaderboard> {
  return request<WaveLeaderboard>(`/api/waves/leaderboard?map=${encodeURIComponent(map)}&board=${board}`);
}
export async function getTeamLobby(mode: GameMode = 'survival'): Promise<TeamLobby> {
  await ensureAccess();
  return request<TeamLobby>(teamUrl(mode), { auth: true });
}
export async function teamAction(action: TeamAction, mode: GameMode = 'survival'): Promise<TeamLobby> {
  await ensureAccess();
  return request<TeamLobby>(teamUrl(mode), { method: 'POST', auth: true, body: JSON.stringify(action) });
}

/** Renames the signed-in account; the new name is used from the next match on. */
export async function renameAccount(username: string): Promise<AccountInfo> {
  await ensureAccess();
  const s = await request<Omit<SessionResponse, 'refreshToken'>>('/api/account/name', { method: 'POST', auth: true, body: JSON.stringify({ username }) });
  accessToken = s.accessToken;
  accessExpiresAt = Date.now() + s.expiresIn * 1000;
  account = s.account;
  return s.account;
}

/** The account's character look (null until the player has made their character). */
export async function getAppearance(): Promise<Appearance | null> {
  await ensureAccess();
  const r = await request<{ appearance: unknown }>('/api/appearance', { auth: true });
  return parseAppearance(r.appearance);
}

export async function saveAppearance(appearance: Appearance): Promise<Appearance> {
  await ensureAccess();
  const r = await request<{ appearance: unknown }>('/api/appearance', { method: 'PUT', auth: true, body: JSON.stringify({ appearance }) });
  return parseAppearance(r.appearance) ?? appearance;
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

/** A Studio JSON request (Model Studio and other studio modules). */
export function studioJson<T>(path: string, init: RequestInit = {}): Promise<T> { return studioRequest<T>(path, init); }

/** A raw Studio request (binary uploads and downloads) with the same credentials. */
export async function studioFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = studioToken() ?? memoryStudioToken;
  const headers = new Headers(init.headers);
  if (token) headers.set('x-studio-token', token);
  else { await ensureAccess(); if (accessToken) headers.set('authorization', `Bearer ${accessToken}`); }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include', cache: 'no-store' });
  if (!res.ok) {
    let b: { error?: string; message?: string } = {};
    try { b = await res.json() as typeof b; } catch { /* not JSON */ }
    throw new ApiError(res.status, b.error ?? 'error', b.message ?? `request failed (${res.status})`);
  }
  return res;
}

export function studioLoad(): Promise<StudioLayout> {
  return studioRequest<StudioLayout>('/api/studio/layout');
}

/** Saves the Hand Studio (hand poses and animations) for every client. */
export function studioSaveHandStudio(studio: unknown): Promise<{ studio: unknown; version: number }> {
  return studioRequest('/api/studio/hand-studio', { method: 'POST', body: JSON.stringify(studio) });
}

/** Saves the gear fitting (adjustments, soft regions) for every client. */
export function studioSaveGearFit(fit: unknown): Promise<{ fit: unknown; version: number }> {
  return studioRequest('/api/studio/gear-fit', { method: 'POST', body: JSON.stringify(fit) });
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
/** Infection maps (Studio "Lây nhiễm"). */
export interface InfectionMapPreview {
  half: number; step: number; size: number; origin: number; heights: number[]; grass: number[];
  /** Models with their world height `y` (the Studio's 3D view of the whole map). */
  base: Array<{ asset: number; x: number; z: number; y: number; yaw: number; scale: number }>;
  wall: Array<{ asset: number; x: number; z: number; y: number; yaw: number; scale: number }>;
  nature: Array<{ asset: number; x: number; z: number; y: number; yaw: number; scale: number }>;
  spawns: Array<{ x: number; z: number; y?: number }>; zombieSpawns: Array<{ x: number; z: number; y?: number }>;
  /** The map's ground height. */
  ground?: number;
}
/** A map model uploaded for Infection maps: its asset id, name and full asset definition. */
export interface InfectionMapModel { asset: number; name: string; version: number; url: string; def: Record<string, unknown> }
export function studioInfectionModels(): Promise<{ models: InfectionMapModel[] }> { return studioRequest('/api/studio/infection-maps/models'); }
/**
 * A map model: its file sent as it is (binary, no base64), then registered with its name and
 * collision. Large maps (tens of MB) go up without the page or the request doubling them.
 */
export async function studioUploadInfectionModel(name: string, glb: ArrayBuffer, fit?: unknown): Promise<InfectionMapModel> {
  const { upload } = await studioRequest<{ upload: string }>('/api/studio/infection-maps/models/file', { method: 'POST', body: glb, headers: { 'content-type': 'application/octet-stream' } });
  return studioRequest('/api/studio/infection-maps/models', { method: 'POST', body: JSON.stringify({ name, upload, ...(fit ? { fit } : {}) }) });
}
export function studioInfectionMaps(): Promise<InfectionMaps> { return studioRequest('/api/studio/infection-maps'); }
export function studioSaveInfectionMap(map: InfectionMapDef): Promise<InfectionMaps> { return studioRequest('/api/studio/infection-maps', { method: 'PUT', body: JSON.stringify(map) }); }
export function studioActivateInfectionMap(id: string): Promise<InfectionMaps> { return studioRequest('/api/studio/infection-maps/active', { method: 'POST', body: JSON.stringify({ id }) }); }
export function studioDeleteInfectionMap(id: string): Promise<InfectionMaps> { return studioRequest(`/api/studio/infection-maps/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({}) }); }
export function studioPreviewInfectionMap(map: InfectionMapDef): Promise<InfectionMapPreview> { return studioRequest('/api/studio/infection-maps/preview', { method: 'POST', body: JSON.stringify(map) }); }
export function studioVehiclePhysics(): Promise<{ jolt: boolean }> { return studioRequest('/api/studio/vehicle-physics'); }
export function studioSetVehiclePhysics(jolt: boolean): Promise<{ jolt: boolean }> { return studioRequest('/api/studio/vehicle-physics', { method: 'POST', body: JSON.stringify({ jolt }) }); }
export function studioSetCharacterStyle(style: 'survivor' | 'mixamo' | 'blocky'): Promise<{ style: 'survivor' | 'mixamo' | 'blocky'; blocky: boolean }> { return studioRequest('/api/studio/character-style', { method: 'POST', body: JSON.stringify({ style }) }); }
export type StudioWeapon = CustomWeapon & { modelUrl: string | null };
export function studioWeapons(): Promise<{ weapons: StudioWeapon[] }> { return studioRequest('/api/studio/weapons'); }
/** Saves a Studio weapon; `model` is the file as base64 (required when creating). */
export function studioSaveWeapon(def: Omit<CustomWeapon, 'weaponId'> & { weaponId?: number }, model?: string): Promise<StudioWeapon> {
  return studioRequest('/api/studio/weapons', { method: 'POST', body: JSON.stringify({ def, ...(model ? { model } : {}) }) });
}
export function studioResetWeapons(password: string, id?: string): Promise<{ ok: true; reset: string[] }> { return studioRequest('/api/studio/weapons/reset', { method: 'POST', body: JSON.stringify({ password, ...(id ? { id } : {}) }) }); }
export function studioDeleteWeapon(id: string): Promise<{ ok: true }> { return studioRequest(`/api/studio/weapons/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({}) }); }
export function studioPlayers(): Promise<PlayerProgress[]> { return studioRequest('/api/studio/players'); }
export function studioPlayerCounts(): Promise<{ online: number; total: number }> { return studioRequest('/api/studio/player-counts'); }
export function studioCurrencyPlayers(search = ''): Promise<StudioCurrencyPlayer[]> { return studioRequest(`/api/studio/currency/players?search=${encodeURIComponent(search)}`); }
export function studioGrantCurrency(grant: StudioCurrencyGrant): Promise<StudioCurrencyResult> { return studioRequest('/api/studio/currency/grant', { method: 'POST', body: JSON.stringify(grant) }); }
export function getCareer(): Promise<CareerView> { return request('/api/career', { auth: true }); }
export function deployRequisition(key: string): Promise<CareerView> { return request('/api/career/deploy', { auth: true, method: 'POST', body: JSON.stringify({ key }) }); }
export function studioRanks(): Promise<RankConfig> { return studioRequest('/api/studio/ranks'); }
export function studioSaveRanks(config: RankConfig): Promise<RankConfig> { return studioRequest('/api/studio/ranks', { method: 'POST', body: JSON.stringify(config) }); }
export function studioResetProgress(accountId?: string): Promise<{ ok: boolean }> { return studioRequest('/api/studio/players/reset', { method: 'POST', body: JSON.stringify(accountId ? { accountId } : { all: true }) }); }
export function getHandbook(): Promise<HandbookEntry[]> { return request('/api/handbook'); }
export function getNews(): Promise<NewsPost[]> { return request('/api/news'); }
export function studioNews(): Promise<NewsDraft[]> { return studioRequest('/api/studio/news'); }
export function studioNewsAction(action: NewsAction): Promise<NewsDraft | null> { return studioRequest('/api/studio/news', { method: 'POST', body: JSON.stringify(action) }); }

/** The world channel (main menu chat, every player on the server). */
export interface WorldChatLine { id: number; at: number; name: string; text: string }
export function worldChat(after: number): Promise<{ latest: number; lines: WorldChatLine[] }> {
  return request(`/api/chat?after=${after}`);
}
export async function sendWorldChat(text: string): Promise<WorldChatLine> {
  await ensureAccess();
  return request('/api/chat', { method: 'POST', auth: true, body: JSON.stringify({ text }) });
}
