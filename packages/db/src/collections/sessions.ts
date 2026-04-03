import { createCollection, localOnlyCollectionOptions } from '@tanstack/db';
import { eq } from 'drizzle-orm';

import { getDb } from '../client';
import { sessions as table } from '../schema';

import type { Session } from '../types';

let _collection!: ReturnType<typeof makeCollection>;

function makeCollection(initialData: Session[]) {
  return createCollection(
    localOnlyCollectionOptions<Session, string>({
      getKey: (s) => s.id,
      initialData,
      onInsert: async ({ transaction }) => {
        const db = getDb();
        for (const m of transaction.mutations) {
          await db.insert(table).values(m.modified);
        }
      },
      onUpdate: async ({ transaction }) => {
        const db = getDb();
        for (const m of transaction.mutations) {
          await db
            .update(table)
            .set(m.modified)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .where(eq(table.id, (m.original as any).id));
        }
      },
      onDelete: async ({ transaction }) => {
        const db = getDb();
        for (const m of transaction.mutations) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await db.delete(table).where(eq(table.id, (m.original as any).id));
        }
      },
    }),
  );
}

export function getSessionCollection() {
  return _collection;
}

export async function hydrateSessionCollection(): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(table);
  _collection = makeCollection(rows);
}
