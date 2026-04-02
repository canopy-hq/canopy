import { createCollection, localOnlyCollectionOptions } from '@tanstack/db';
import { eq } from 'drizzle-orm';
import { getDb } from '../client';
import { settings as table } from '../schema';
import type { Setting } from '../types';

let _collection!: ReturnType<typeof makeCollection>;

function makeCollection(initialData: Setting[]) {
  return createCollection(
    localOnlyCollectionOptions<Setting, string>({
      getKey: (s) => s.key,
      initialData,
      onInsert: async ({ transaction }) => {
        const db = getDb();
        for (const m of transaction.mutations) {
          await db
            .insert(table)
            .values(m.modified)
            .onConflictDoUpdate({ target: table.key, set: { value: m.modified.value } });
        }
      },
      onUpdate: async ({ transaction }) => {
        const db = getDb();
        for (const m of transaction.mutations) {
          await db
            .update(table)
            .set({ value: m.modified.value })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .where(eq(table.key, (m.original as any).key));
        }
      },
      onDelete: async ({ transaction }) => {
        const db = getDb();
        for (const m of transaction.mutations) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await db.delete(table).where(eq(table.key, (m.original as any).key));
        }
      },
    }),
  );
}

export function getSettingCollection() {
  return _collection;
}

export async function hydrateSettingCollection(): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(table);
  _collection = makeCollection(rows);
}

// ── Typed setting helpers ────────────────────────────────────────────────────

export function getSetting<T>(settings: Setting[], key: string, fallback: T): T {
  const entry = settings.find((s) => s.key === key);
  if (!entry) return fallback;
  try {
    return JSON.parse(entry.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  const collection = getSettingCollection();
  const existing = collection.toArray.find((s) => s.key === key);
  const encoded = JSON.stringify(value);
  if (existing) {
    collection.update(key, (draft) => {
      draft.value = encoded;
    });
  } else {
    collection.insert({ key, value: encoded });
  }
}
