import { createCollection, createTransaction, localOnlyCollectionOptions } from '@tanstack/db';
import { asc, eq } from 'drizzle-orm';

import { getDb } from '../client';
import { tabs as table } from '../schema';
import { uiCollection } from './ui';

import type { Tab, PaneNode } from '../types';

function deserialize(row: typeof table.$inferSelect): Tab {
  return {
    ...row,
    paneRoot: JSON.parse(row.paneRoot) as Tab['paneRoot'],
    focusedPaneId: row.focusedPaneId ?? null,
  };
}

function serialize(tab: Tab) {
  return {
    ...tab,
    paneRoot: JSON.stringify(tab.paneRoot),
    focusedPaneId: tab.focusedPaneId ?? null,
  };
}

let _collection!: ReturnType<typeof makeCollection>;

function makeCollection(initialData: Tab[]) {
  return createCollection(
    localOnlyCollectionOptions<Tab, string>({
      getKey: (t) => t.id,
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

export function getTabCollection() {
  return _collection;
}

function resetPtyIds(node: PaneNode): PaneNode {
  if (node.type === 'leaf') return { ...node, ptyId: node.ptyId === -2 ? -2 : -1 };
  return { ...node, children: node.children.map(resetPtyIds) };
}

export async function hydrateTabCollection(): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(table).orderBy(asc(table.position));
  _collection = makeCollection(
    rows.map(deserialize).map((t) => ({ ...t, paneRoot: resetPtyIds(t.paneRoot) })),
  );
}

function commitTabAndUi(dbFn: () => Promise<void>, mutateFn: () => void): void {
  const tabCol = getTabCollection();
  const tx = createTransaction({
    mutationFn: async ({ transaction }) => {
      await dbFn();
      tabCol.utils.acceptMutations(transaction);
      uiCollection.utils.acceptMutations(transaction);
    },
  });
  tx.mutate(mutateFn);
  tx.commit().catch(() => undefined);
}

export function insertTabAndActivate(tab: Tab): void {
  commitTabAndUi(
    () => getDb().insert(table).values(serialize(tab)),
    () => {
      getTabCollection().insert(tab);
      uiCollection.update('ui', (draft) => {
        draft.activeTabId = tab.id;
      });
    },
  );
}

export function deleteTabAndUpdateActive(tabId: string, newActiveTabId: string | null): void {
  commitTabAndUi(
    () => getDb().delete(table).where(eq(table.id, tabId)),
    () => {
      getTabCollection().delete(tabId);
      if (newActiveTabId !== null) {
        uiCollection.update('ui', (draft) => {
          draft.activeTabId = newActiveTabId;
        });
      }
    },
  );
}
