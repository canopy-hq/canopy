import { init, initFromBytes, initFromResponse } from 'ghostty-web';
import wasmUrl from 'ghostty-web/ghostty-vt.wasm?url';

// Injected at build time by vite.config.ts → define.__GHOSTTY_VERSION__
// Changing the ghostty-web version automatically invalidates the cache.
declare const __GHOSTTY_VERSION__: string;

const IDB_DB_NAME = 'canopy-wasm-cache';
const IDB_STORE = 'modules';
const CACHE_KEY = `ghostty-vt-${__GHOSTTY_VERSION__}`;

// ─── IndexedDB helpers ───────────────────────────────────────────────────────
// Every operation swallows errors — a broken IDB cache must never block init.

// Cached so getFromCache and setInCache share one IDBOpenRequest per session.
let _dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          (e.target as IDBOpenDBRequest).result.createObjectStore(IDB_STORE);
        };
        req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return _dbPromise;
}

async function getFromCache(): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(CACHE_KEY);
        req.onsuccess = () => resolve(req.result instanceof ArrayBuffer ? req.result : null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

// Delete all keys except the current CACHE_KEY so stale WASM blobs don't
// accumulate across ghostty-web version bumps.
function pruneStaleKeys(db: IDBDatabase): void {
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      for (const key of req.result) {
        if (key !== CACHE_KEY) store.delete(key);
      }
    };
  } catch {
    // best-effort — ignore failures
  }
}

function setInCache(bytes: ArrayBuffer): void {
  openDb()
    .then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(bytes, CACHE_KEY);
        // Prune after the write commits so the new key is not accidentally deleted.
        tx.oncomplete = () => pruneStaleKeys(db);
      } catch {
        // Cache write is best-effort — ignore failures
      }
    })
    .catch(() => {});
}

// ─── WASM loading ────────────────────────────────────────────────────────────

async function loadGhosttyModule(): Promise<void> {
  const abortController = new AbortController();

  try {
    const fetchPromise = fetch(wasmUrl, { signal: abortController.signal });

    // Race cache hit against the in-flight fetch.
    // Cache miss returns a never-resolving promise so fetch always wins on miss.
    const winner = await Promise.race([
      getFromCache().then((bytes): { kind: 'cache'; bytes: ArrayBuffer } | Promise<never> =>
        bytes ? { kind: 'cache', bytes } : new Promise(() => {}),
      ),
      fetchPromise.then((response) => ({ kind: 'fetch' as const, response })),
    ]);

    if (winner.kind === 'cache') {
      abortController.abort();
      fetchPromise.catch(() => {}); // suppress expected AbortError
      await initFromBytes(winner.bytes);
      return;
    }

    // winner.kind === 'fetch'
    const { response } = winner;
    if (!response.ok) {
      throw new Error(`WASM fetch failed: ${response.status} ${response.statusText}`);
    }
    // Clone before streaming so bytes are still available for the cache write.
    const responseForCache = response.clone();
    await initFromResponse(response);
    // Store bytes for next launch — fire-and-forget, never blocks init.
    responseForCache
      .arrayBuffer()
      .then(setInCache)
      .catch(() => {});
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return;
    console.warn('[canopy] ghostty fast-init failed, falling back to init()', err);
    await init();
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

let ready: Promise<void> | null = null;
let resolved = false;

/**
 * Initialise ghostty-web as early as possible.
 *
 * Call this at the app entry point (main.tsx), before mounting React, so
 * WASM loading runs in parallel with DB init. The returned Promise can be
 * awaited later when the first terminal opens. Calling it multiple times is
 * safe — the load is deduplicated.
 *
 * Load strategy (fastest to slowest):
 *  1. IndexedDB cache hit  → initFromBytes  (skip fetch, still compiles)
 *  2. Fetch + streaming    → initFromResponse (compile overlaps download)
 *  3. Fallback             → init()           (plain fetch + compile)
 */
export function ensureGhosttyInit(): Promise<void> {
  if (!ready) {
    ready = loadGhosttyModule().then(() => {
      resolved = true;
    });
  }
  return ready;
}

/** Synchronous check — true only after ensureGhosttyInit() has resolved. */
export function isGhosttyReady(): boolean {
  return resolved;
}
