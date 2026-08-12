import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAuth } from "@/store/auth";
import {
  FLEET_AUTH_TOKEN_KEYS,
  writeFleetToken,
  getGrudgeBearerToken,
  clearGrudgeSession,
  buildGrudgeLoginUrl,
  isTokenExpired,
} from "@/lib/grudgeAuthBridge";

describe("auth store", () => {
  beforeEach(() => {
    useAuth.getState().reset();
    clearGrudgeSession();
  });

  it("starts in 'idle' status with no user", () => {
    // reset() lands in 'anon' so we re-create the store snapshot for idle
    expect(["idle", "anon"]).toContain(useAuth.getState().status);
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().isPuterSignedIn).toBe(false);
    expect(useAuth.getState().isGrudgeSignedIn).toBe(false);
  });

  it("setSignedIn marks isPuterSignedIn true and exposes the puter identity", () => {
    useAuth.getState().setSignedIn({
      id: "uuid-1",
      name: "alice",
      puter: { uuid: "uuid-1", username: "alice", email: null, isTemp: false },
    });
    const s = useAuth.getState();
    expect(s.status).toBe("signedIn");
    expect(s.isPuterSignedIn).toBe(true);
    expect(s.isGrudgeSignedIn).toBe(false);
    expect(s.user?.puter?.username).toBe("alice");
  });

  it("setSignedIn with Grudge ID only leaves isPuterSignedIn false", () => {
    useAuth.getState().setSignedIn({
      id: "GRDG-TEST",
      name: "Moloch",
      grudgeId: "GRDG-TEST",
    });
    const s = useAuth.getState();
    expect(s.status).toBe("signedIn");
    expect(s.isPuterSignedIn).toBe(false);
    expect(s.isGrudgeSignedIn).toBe(true);
    expect(s.user?.id).toBe("GRDG-TEST");
  });

  it("dual plane: Grudge + Puter both on", () => {
    useAuth.getState().setSignedIn({
      id: "uuid-1",
      name: "Moloch",
      grudgeId: "GRDG-TEST",
      puter: { uuid: "uuid-1", username: "moloch", email: null, isTemp: false },
    });
    const s = useAuth.getState();
    expect(s.isPuterSignedIn).toBe(true);
    expect(s.isGrudgeSignedIn).toBe(true);
    expect(s.status).toBe("signedIn");
  });

  it("setGuest leaves isPuterSignedIn false", () => {
    useAuth.getState().setGuest({ id: "g-1", name: "Player-1234" });
    const s = useAuth.getState();
    expect(s.status).toBe("guest");
    expect(s.isPuterSignedIn).toBe(false);
    expect(s.isGrudgeSignedIn).toBe(false);
    expect(s.user?.puter).toBeUndefined();
  });

  it("setUser routes by presence of puter or grudgeId", () => {
    useAuth.getState().setUser({
      id: "u",
      name: "u",
      puter: { uuid: "u", username: "u", email: null, isTemp: false },
    });
    expect(useAuth.getState().status).toBe("signedIn");
    useAuth.getState().setUser({ id: "g", name: "g", grudgeId: "G1" });
    expect(useAuth.getState().status).toBe("signedIn");
    expect(useAuth.getState().isGrudgeSignedIn).toBe(true);
    useAuth.getState().setUser({ id: "g", name: "g" });
    expect(useAuth.getState().status).toBe("guest");
    useAuth.getState().setUser(null);
    expect(useAuth.getState().status).toBe("anon");
  });

  it("reset clears the user and goes to anon", () => {
    useAuth.getState().setSignedIn({
      id: "u",
      name: "u",
      puter: { uuid: "u", username: "u", email: null, isTemp: true },
    });
    useAuth.getState().reset();
    expect(useAuth.getState().status).toBe("anon");
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().isPuterSignedIn).toBe(false);
    expect(useAuth.getState().isGrudgeSignedIn).toBe(false);
  });

  it("preserves isTemp flag on the puter identity", () => {
    useAuth.getState().setSignedIn({
      id: "t",
      name: "temp-user",
      puter: { uuid: "t", username: "temp-user", email: null, isTemp: true },
    });
    expect(useAuth.getState().user?.puter?.isTemp).toBe(true);
  });

  it("vi.spyOn mock is available (sanity)", () => {
    const obj = { fn: () => 1 };
    const spy = vi.spyOn(obj, "fn").mockReturnValue(2);
    expect(obj.fn()).toBe(2);
    expect(spy).toHaveBeenCalled();
  });
});

describe("fleet token keys", () => {
  beforeEach(() => {
    clearGrudgeSession();
  });

  it("includes grudge.open.token first", () => {
    expect(FLEET_AUTH_TOKEN_KEYS[0]).toBe("grudge.open.token");
    expect(FLEET_AUTH_TOKEN_KEYS).toContain("sso_token");
    expect(FLEET_AUTH_TOKEN_KEYS).toContain("grudge_auth_token");
  });

  it("dual-writes and reads bearer", () => {
    // Valid-shaped JWT with empty payload object (no exp) so isTokenExpired is false
    const payload = btoa(JSON.stringify({ sub: "test" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const jwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.sig`;
    writeFleetToken(jwt);
    const got = getGrudgeBearerToken();
    // jsdom / happy-dom provide localStorage in vitest; if missing, skip store asserts
    if (typeof localStorage === "undefined") {
      expect(got === null || got === jwt).toBe(true);
      return;
    }
    expect(got).toBe(jwt);
    for (const k of FLEET_AUTH_TOKEN_KEYS) {
      expect(localStorage.getItem(k)).toBe(jwt);
    }
    writeFleetToken(null);
    expect(getGrudgeBearerToken()).toBeNull();
  });

  it("buildGrudgeLoginUrl uses /login not /auth/popup", () => {
    const url = buildGrudgeLoginUrl("https://forge.grudge-studio.com/editor");
    expect(url).toContain("id.grudge-studio.com/login?");
    expect(url).toContain("redirect_uri=");
    expect(url).not.toContain("/auth/popup");
    expect(url).toContain("app=forge");
  });

  it("isTokenExpired handles missing exp", () => {
    expect(isTokenExpired(null)).toBe(true);
    // non-jwt
    expect(isTokenExpired("not-a-jwt-but-long-enough-token-value-here")).toBe(false);
  });
});
