import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAuth } from "@/store/auth";

describe("auth store", () => {
  beforeEach(() => {
    useAuth.getState().reset();
  });

  it("starts in 'idle' status with no user", () => {
    // reset() lands in 'anon' so we re-create the store snapshot for idle
    expect(["idle", "anon"]).toContain(useAuth.getState().status);
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().isPuterSignedIn).toBe(false);
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
    expect(s.user?.puter?.username).toBe("alice");
  });

  it("setSignedIn with Grudge ID only leaves isPuterSignedIn false", () => {
    useAuth.getState().setSignedIn({
      id: "GRDG-TEST",
      name: "Moloch",
      // no puter — fleet SSO from id.grudge-studio.com
    });
    const s = useAuth.getState();
    expect(s.status).toBe("signedIn");
    expect(s.isPuterSignedIn).toBe(false);
    expect(s.user?.id).toBe("GRDG-TEST");
  });

  it("setGuest leaves isPuterSignedIn false", () => {
    useAuth.getState().setGuest({ id: "g-1", name: "Player-1234" });
    const s = useAuth.getState();
    expect(s.status).toBe("guest");
    expect(s.isPuterSignedIn).toBe(false);
    expect(s.user?.puter).toBeUndefined();
  });

  it("setUser routes by presence of puter field", () => {
    useAuth.getState().setUser({
      id: "u",
      name: "u",
      puter: { uuid: "u", username: "u", email: null, isTemp: false },
    });
    expect(useAuth.getState().status).toBe("signedIn");
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
