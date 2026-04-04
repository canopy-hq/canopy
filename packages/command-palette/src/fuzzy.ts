import type { CommandItem } from './types';

const WORD_BOUNDARY = new Set([' ', '-', '/', '_', '.', ':']);

/**
 * Scores how well `query` matches `target`.
 * Returns -1 if not all query chars are found.
 * Higher = better match.
 */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (t === q) return 200;
  if (t.startsWith(q)) return 150;
  if (t.includes(q)) return 100;

  // Sequential character matching
  let score = 0;
  let qi = 0;
  let lastMatchIndex = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;

    let charScore = 1;
    // Word boundary bonus
    if (ti === 0 || WORD_BOUNDARY.has(t[ti - 1]!)) charScore += 3;
    // Consecutive match bonus
    if (lastMatchIndex === ti - 1) charScore += 2;
    // Gap penalty (small)
    if (lastMatchIndex >= 0) charScore -= (ti - lastMatchIndex - 1) * 0.05;

    score += charScore;
    lastMatchIndex = ti;
    qi++;
  }

  if (qi < q.length) return -1; // Not all chars matched
  return score;
}

/** Filter and sort items by fuzzy match against query. */
export function fuzzyFilter(query: string, items: CommandItem[]): CommandItem[] {
  if (!query) return items;

  const scored = items
    .map((item) => {
      const labelScore = fuzzyScore(query, item.label);
      const keywordScore = item.keywords
        ? Math.max(...item.keywords.map((k) => fuzzyScore(query, k)))
        : -1;
      return { item, score: Math.max(labelScore, keywordScore) };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ item }) => item);
}
