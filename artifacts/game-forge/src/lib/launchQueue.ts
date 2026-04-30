import { useEffect } from "react";
import { useViewportTabs } from "@/store/viewportTabs";
import { useEditor } from "@/store/editor";
import { openModelTabFromFile } from "@/lib/openModelTab";

/**
 * Browser File Handling API surface.
 *
 * Chromium installs apps with `file_handlers` in the manifest can be
 * launched with one or more files. The page receives them through
 * `window.launchQueue.setConsumer`, which fires once per launch. Each
 * launch params object exposes `files: FileSystemFileHandle[]` (subset
 * of the FS Access API).
 *
 * Spec: https://web.dev/file-handling/
 *
 * Safari / Firefox don't implement the queue yet — we simply skip
 * registration when `launchQueue` is missing, so installed PWAs on
 * those browsers degrade to "the file opens but nothing happens" rather
 * than throwing. Web shares (a different API) will be wired separately
 * if we ever ship a Share Target.
 */

interface LaunchParams {
  files?: FileSystemFileHandle[];
}

interface LaunchQueue {
  setConsumer: (consumer: (params: LaunchParams) => void) => void;
}

declare global {
  interface Window {
    launchQueue?: LaunchQueue;
  }
}

let consumerInstalled = false;

/**
 * Install a consumer that opens every launched file in its own viewport
 * tab. Safe to call from many components — only the first call wires
 * the queue, the rest are no-ops. We keep the global state because the
 * API itself is global and only fires once per launch; calling
 * `setConsumer` more than once would replace the prior handler and lose
 * any in-flight launch params.
 */
export function useViewportLaunchQueue() {
  const openTab = useViewportTabs((s) => s.openTab);
  const pushLog = useEditor((s) => s.pushLog);

  useEffect(() => {
    if (consumerInstalled) return;
    if (typeof window === "undefined" || !window.launchQueue) return;
    consumerInstalled = true;

    window.launchQueue.setConsumer(async (params) => {
      const handles = params.files ?? [];
      if (handles.length === 0) return;
      for (const handle of handles) {
        try {
          const file = await handle.getFile();
          openModelTabFromFile(file, openTab);
          pushLog(
            "info",
            `Opened "${file.name}" via OS file handler in a new tab.`,
          );
        } catch (err) {
          pushLog(
            "error",
            `File handler failed: ${(err as Error).message ?? String(err)}`,
          );
        }
      }
    });
    // We deliberately don't clean up — the queue is a singleton attached
    // to the window for the lifetime of the page; removing the consumer
    // would silently drop any subsequent launch params.
  }, [openTab, pushLog]);
}
