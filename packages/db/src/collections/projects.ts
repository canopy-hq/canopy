import { createCollection, localOnlyCollectionOptions } from '@tanstack/db';
import { asc, eq } from 'drizzle-orm';

import { getDb } from '../client';
import { projects as table } from '../schema';

import type { Project } from '../types';

function deserialize(row: typeof table.$inferSelect): Project {
  return {
    ...row,
    branches: JSON.parse(row.branches) as Project['branches'],
    worktrees: JSON.parse(row.worktrees) as Project['worktrees'],
  };
}

function serialize(proj: Project) {
  return {
    ...proj,
    branches: JSON.stringify(proj.branches),
    worktrees: JSON.stringify(proj.worktrees),
  };
}

let _collection!: ReturnType<typeof makeCollection>;

function makeCollection(initialData: Project[]) {
  return createCollection(
    localOnlyCollectionOptions<Project, string>({
      getKey: (p) => p.id,
      initialData,
      onInsert: async ({ transaction }) => {
        const db = getDb();
        for (const m of transaction.mutations) {
          await db.insert(table).values(serialize(m.modified));
        }
      },
      onUpdate: async ({ transaction }) => {
        const db = getDb();
        for (const m of transaction.mutations) {
          await db
            .update(table)
            .set(serialize(m.modified))
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

export function getProjectCollection() {
  return _collection;
}

export async function hydrateProjectCollection(): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(table).orderBy(asc(table.position));
  _collection = makeCollection(rows.map(deserialize));
}
