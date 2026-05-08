// @vitest-environment jsdom
/**
 * Render coverage for BakeProgressToasts. Locks down: running spinner,
 * warning rows, success/error summary, dismiss button, and the
 * auto-dismiss after the 5s grace window.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { useBakeProgress } from "@/store/bakeProgress";
import { BakeProgressToasts } from "@/editor/BakeProgressToasts";

beforeEach(() => {
  useBakeProgress.setState({ entries: [] });
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BakeProgressToasts", () => {
  it("renders nothing when there are no entries", () => {
    const { container } = render(<BakeProgressToasts />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a running spinner with the entity name and live elapsed time", () => {
    render(<BakeProgressToasts />);
    act(() => {
      useBakeProgress.getState().begin("e1", "Crate");
    });
    const toast = screen.getByTestId("bake-progress-toast-e1");
    expect(toast.dataset.status).toBe("running");
    expect(within(toast).getByText("Baking colliders")).toBeTruthy();
    expect(within(toast).getByText("Crate")).toBeTruthy();
    // No dismiss button while running.
    expect(screen.queryByTestId("bake-progress-dismiss-e1")).toBeNull();
  });

  it("renders one warning row per warn() with optional detail", () => {
    render(<BakeProgressToasts />);
    act(() => {
      useBakeProgress.getState().begin("e1", "Crate");
      useBakeProgress
        .getState()
        .warn("e1", "vhacd unavailable", "wasm load failed");
      useBakeProgress.getState().warn("e1", "quickhull fallback");
    });
    const toast = screen.getByTestId("bake-progress-toast-e1");
    const items = within(toast).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("vhacd unavailable");
    expect(items[0].textContent).toContain("wasm load failed");
    expect(items[1].textContent).toContain("quickhull fallback");
  });

  it("shows the success summary, exposes a dismiss button, and auto-dismisses after the grace window", () => {
    render(<BakeProgressToasts />);
    act(() => {
      useBakeProgress.getState().begin("e1", "Crate");
      useBakeProgress.getState().finish("e1", "ok", "3 hulls · 42 verts");
    });

    const toast = screen.getByTestId("bake-progress-toast-e1");
    expect(toast.dataset.status).toBe("ok");
    expect(within(toast).getByText("Baked colliders")).toBeTruthy();
    expect(within(toast).getByText("3 hulls · 42 verts")).toBeTruthy();
    expect(screen.getByTestId("bake-progress-dismiss-e1")).toBeTruthy();

    // Just before the grace window expires the toast is still mounted.
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.queryByTestId("bake-progress-toast-e1")).not.toBeNull();

    // After the grace window the store entry — and therefore the
    // toast — is gone.
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.queryByTestId("bake-progress-toast-e1")).toBeNull();
    expect(useBakeProgress.getState().entries).toHaveLength(0);
  });

  it("clicking dismiss removes the entry immediately", () => {
    render(<BakeProgressToasts />);
    act(() => {
      useBakeProgress.getState().begin("e1", "Crate");
      useBakeProgress.getState().finish("e1", "error", "boom");
    });
    const toast = screen.getByTestId("bake-progress-toast-e1");
    expect(toast.dataset.status).toBe("error");
    expect(within(toast).getByText("Bake failed")).toBeTruthy();
    expect(within(toast).getByText("boom")).toBeTruthy();

    act(() => {
      screen.getByTestId("bake-progress-dismiss-e1").click();
    });
    expect(screen.queryByTestId("bake-progress-toast-e1")).toBeNull();
    expect(useBakeProgress.getState().entries).toHaveLength(0);
  });
});
