/**
 * Per-tool recent-paths store, persisted via electron-store. Each
 * `key` (e.g. "converter.input", "deployer.output") gets its own MRU
 * list capped at 8 entries. Tool dialogs use this to remember the
 * last folder the user picked so successive operations stay close to
 * the previous output.
 */
import Store from "electron-store";

interface Schema {
  recents: Record<string, string[]>;
}

const store = new Store<Schema>({
  name: "gameforge-recents",
  defaults: { recents: {} },
});

const MAX_PER_KEY = 8;

export function recordRecent(key: string, value: string): void {
  if (!key || !value) return;
  const all = store.get("recents");
  const list = (all[key] ?? []).filter((v) => v !== value);
  list.unshift(value);
  all[key] = list.slice(0, MAX_PER_KEY);
  store.set("recents", all);
}

export function getRecents(key: string): string[] {
  return store.get("recents")[key] ?? [];
}

export function getLastRecent(key: string): string | undefined {
  return getRecents(key)[0];
}
