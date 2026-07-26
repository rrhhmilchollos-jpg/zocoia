/**
 * src/lib/simpleDiff.ts
 *
 * Diff de líneas minimalista (sin dependencias) para pintar la pestaña
 * "Diferencia" del panel del agente. Implementa una LCS clásica sobre
 * líneas, suficiente para archivos de código de tamaño normal.
 */

export type DiffLineType = 'equal' | 'added' | 'removed';

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = (oldText ?? '').split('\n');
  const newLines = (newText ?? '').split('\n');

  const m = oldLines.length;
  const n = newLines.length;

  // Tabla LCS (m+1 x n+1). Para archivos muy grandes esto es O(m*n); el
  // caller debería truncar archivos enormes antes de llamar a esto.
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] =
        oldLines[i] === newLines[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLineNo = 1;
  let newLineNo = 1;

  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'equal', text: oldLines[i], oldLineNumber: oldLineNo++, newLineNumber: newLineNo++ });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: 'removed', text: oldLines[i], oldLineNumber: oldLineNo++ });
      i++;
    } else {
      result.push({ type: 'added', text: newLines[j], newLineNumber: newLineNo++ });
      j++;
    }
  }
  while (i < m) {
    result.push({ type: 'removed', text: oldLines[i], oldLineNumber: oldLineNo++ });
    i++;
  }
  while (j < n) {
    result.push({ type: 'added', text: newLines[j], newLineNumber: newLineNo++ });
    j++;
  }

  return result;
}
