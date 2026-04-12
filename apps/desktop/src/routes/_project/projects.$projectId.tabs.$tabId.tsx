import { useEffect } from 'react';

import { createFileRoute } from '@tanstack/react-router';

import { PaneContainer } from '../../components/PaneContainer';
import { useTabs } from '../../hooks/useCollections';
import { activateTabFromRoute } from '../../lib/tab-actions';

function TabRoute() {
  const { projectId, tabId } = Route.useParams();
  const allTabs = useTabs();
  const tab = allTabs.find((t) => t.id === tabId);

  // Sync store from URL — this is the single write path for activeTabId / activeContextId.
  useEffect(() => {
    activateTabFromRoute(projectId, tabId);
  }, [projectId, tabId]);

  if (!tab) return null;

  return (
    <div key={tab.id} className="absolute inset-0">
      <PaneContainer root={tab.paneRoot} />
    </div>
  );
}

export const Route = createFileRoute('/_project/projects/$projectId/tabs/$tabId')({
  component: TabRoute,
});
