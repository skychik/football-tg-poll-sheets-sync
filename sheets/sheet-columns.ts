/**
 * Pure column letter helpers (no Google / env). Shared by Sheets client and tests.
 */

export function columnLetterToIndex(letter: string): number {
  const normalized = letter.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) {
    throw new Error(`Invalid column letter: "${letter}"`);
  }

  let index = 0;
  for (let i = 0; i < normalized.length; i++) {
    index = index * 26 + (normalized.charCodeAt(i) - 64);
  }
  return index - 1;
}

export function indexToColumnLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid column index: ${index}`);
  }

  let result = '';
  index++;
  while (index > 0) {
    index--;
    result = String.fromCharCode(65 + (index % 26)) + result;
    index = Math.floor(index / 26);
  }
  return result;
}

export function getNextColumnLetter(letter: string): string {
  const index = columnLetterToIndex(letter);
  return indexToColumnLetter(index + 1);
}
