/**
 * Truncate a wallet address for display purposes.
 * e.g. "ABC1...XYZ9"
 *
 * Do NOT use for copy/paste or any place the full address is needed.
 * Use the raw address string for those cases.
 */
export function truncateAddress(addr: string, prefix = 4, suffix = 4): string {
  if (!addr) return '';
  if (addr.length <= prefix + suffix + 3) return addr;
  return `${addr.slice(0, prefix)}...${addr.slice(-suffix)}`;
}
