// Spreadsheet apps execute a cell that starts with one of these.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: string): string {
  const cell = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}
