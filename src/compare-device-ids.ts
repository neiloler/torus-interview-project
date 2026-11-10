/** Use JavaScript string ordering, independent of locale. */
export function compareDeviceIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
