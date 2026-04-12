import { router } from '../router';

/**
 * Update search params without changing the current path.
 * TanStack Router's navigate() can't infer the search schema for search-only navigation
 * (no `from`/`to`), so we escape the type here rather than at every call site.
 */
export function updateSearch(
  updater: (prev: Record<string, unknown>) => Record<string, unknown>,
): void {
  void router.navigate({ search: updater as never });
}
