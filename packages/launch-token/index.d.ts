export interface LaunchClaims {
  sessionId: string;
  userId: string;
  kind: string;
  role: string | null;
  issuedAt: number;
  expiresAt: number;
  id: string;
}

export declare function sign(
  claims: { sessionId: string; userId: string; kind?: string; role?: string | null },
  secret: string,
  ttlSeconds?: number
): string;

export declare function verify(
  token: string,
  secret: string,
  nowSeconds?: number
): { ok: true; claims: LaunchClaims } | { ok: false; error: string };

export declare function peek(token: string): {
  sessionId: string | null;
  userId: string | null;
  kind: string | null;
};
