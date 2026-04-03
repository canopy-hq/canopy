import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { asc, eq } from "drizzle-orm";

import { getDb } from "../client";
import { workspaces as table } from "../schema";

import type { Workspace } from "../types";

function deserialize(row: typeof table.$inferSelect): Workspace {
  return {
    ...row,
    branches: JSON.parse(row.branches) as Workspace["branches"],
    worktrees: JSON.parse(row.worktrees) as Workspace["worktrees"],
  };
}

function serialize(ws: Workspace) {
  return {
    ...ws,
    branches: JSON.stringify(ws.branches),
    worktrees: JSON.stringify(ws.worktrees),
  };
}

let _collection!: ReturnType<typeof makeCollection>;

function makeCollection(initialData: Workspace[]) {
  return createCollection(
    localOnlyCollectionOptions<Workspace, string>({
      getKey: (w) => w.id,
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

export function getWorkspaceCollection() {
  return _collection;
}

export async function hydrateWorkspaceCollection(): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(table).orderBy(asc(table.position));
  _collection = makeCollection(rows.map(deserialize));
}
