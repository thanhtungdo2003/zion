export const PROTOCOL_VERSION = 19;

/** Fixed simulation rate shared by server and client prediction. */
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
/** Server sends a snapshot every N ticks (15 Hz). */
export const SNAPSHOT_INTERVAL_TICKS = 2;

/** Hard limits for client → server traffic. */
export const MAX_CLIENT_MESSAGE_BYTES = 1024;
export const MAX_CHAT_LENGTH = 200;
export const MAX_PITCH = 1.55;

/** How far back (ms) the server will rewind targets for lag-compensated hit tests. */
export const MAX_LAG_COMPENSATION_MS = 250;

/** Interpolation delay used by clients when rendering remote entities. */
export const INTERPOLATION_DELAY_MS = 100;

/** Streaming rings (Chebyshev distance in chunks) per terrain LOD. */
export const LOD_RINGS: readonly number[] = [3, 7, 14];
/** Props (trees, rocks…) are sent for chunks at or below this LOD. */
export const PROPS_MAX_LOD = 1;

/** Entity interest radius in chunks. */
export const ENTITY_INTEREST_RADIUS_CHUNKS = 5;

export const PLAYER_MAX_HEALTH = 100;
export const RESPAWN_DELAY_MS = 5000;
