/**
 * Minimal line-based unified diff. Used by the mock API to produce realistic
 * DiffResponse payloads; the real diff is computed server-side.
 */
export function unifiedDiff(a: string, b: string, fromLabel: string, toLabel: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");

  // LCS table (files are small — the mock only diffs fixture-sized text).
  const m = al.length;
  const n = bl.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = al[i] === bl[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const body: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (al[i] === bl[j]) {
      body.push(` ${al[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      body.push(`-${al[i]}`);
      i++;
    } else {
      body.push(`+${bl[j]}`);
      j++;
    }
  }
  while (i < m) body.push(`-${al[i++]}`);
  while (j < n) body.push(`+${bl[j++]}`);

  return [`--- ${fromLabel}`, `+++ ${toLabel}`, `@@ -1,${m} +1,${n} @@`, ...body].join("\n");
}
