import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

export interface AccessClaims {
  sub: string;
  name: string;
  role: 'player' | 'moderator' | 'admin';
  guest: boolean;
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly issuer: string,
    private readonly audience: string,
    private readonly accessTtlSec: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  get accessTtl(): number {
    return this.accessTtlSec;
  }

  async signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({ name: claims.name, role: claims.role, guest: claims.guest })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlSec}s`)
      .sign(this.key);
  }

  /** Verifies signature, algorithm, issuer, audience and expiry. Returns null when invalid. */
  async verifyAccess(token: string): Promise<AccessClaims | null> {
    if (token.length > 4096) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['HS256'],
        clockTolerance: 5,
      });
      const role = payload.role;
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.name !== 'string' ||
        (role !== 'player' && role !== 'moderator' && role !== 'admin')
      ) {
        return null;
      }
      return { sub: payload.sub, name: payload.name, role, guest: payload.guest === true };
    } catch (err) {
      if (err instanceof joseErrors.JOSEError) return null;
      throw err;
    }
  }
}

/** 256-bit random opaque token, base64url (43 chars). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
