/**
 * Token logo URLs for assets on Phoenix Perps.
 * Primary source: CoinGecko CDN (assets.coingecko.com) — verified URLs.
 * Secondary source: Solana token-list CDN for Solana-native tokens.
 *
 * For symbols not in this map, TokenLogo cascades through:
 *   1. This curated map
 *   2. cryptocurrency-icons SVG repo (spothq)
 *   3. Colored letter-avatar fallback
 */

const CG = 'https://assets.coingecko.com/coins/images';
const CG_CDN = 'https://coin-images.coingecko.com/coins/images';
const SOLANA_CDN = 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet';

export const TOKEN_LOGO_URLS: Record<string, string> = {
  // ── Major Layer-1s ──────────────────────────────────────────────────────
  SOL:  `${SOLANA_CDN}/So11111111111111111111111111111111111111112/logo.png`,
  BTC:  `${CG}/1/standard/bitcoin.png?1696501400`,
  ETH:  `${CG}/279/standard/ethereum.png?1696501628`,
  XRP:  `${CG}/44/standard/xrp-symbol-white-128.png?1696501442`,
  BNB:  `${CG}/825/standard/bnb-icon2_2x.png?1696501970`,
  DOGE: `${CG}/5/standard/dogecoin.png?1696501409`,
  NEAR: `${CG}/10365/standard/near.jpg?1696510367`,
  SUI:  `${CG}/26375/standard/sui-ocean-square.png?1727791290`,
  ZEC:  `${CG}/486/standard/circle-zcash-color.png?1696501740`,
  TON:  `${CG_CDN}/17980/large/photo_2024-09-10_17.09.00.jpeg?1725963446`,  // Toncoin

  // ── DeFi / AI / Infra ────────────────────────────────────────────────────
  AAVE: `${CG}/12645/standard/aave-token-round.png?1720472354`,
  TAO:  `${CG_CDN}/28452/large/ARUsPeNQ_400x400.jpeg?1696527447`,   // Bittensor (CG base was dead → CDN)
  WLD:  `${CG_CDN}/31069/large/worldcoin.jpeg?1696529903`,           // Worldcoin
  HYPE: `${CG}/50882/standard/hyperliquid.jpg?1729431300`,
  MON:  `${CG}/38927/standard/mon.png?1766029057`,
  LIT:  `${CG}/71121/standard/lighter.png?1765888098`,   // Lighter (LIT), not Litentry
  ENA:  `${CG_CDN}/36530/large/ethena.png?1711701436`,   // Ethena
  VVV:  `${CG_CDN}/54023/large/VVV_Token_Transparent.png?1741856877`,  // Venice Token
  MEGA: `${CG_CDN}/69995/large/9fcb2fa4-b240-46e2-9016-c4f6101a139d.jpeg?1778485816`, // MegaETH
  MET:  `${CG_CDN}/69110/large/meteora.png?1757517561`,  // Meteora
  MORPHO: `${CG_CDN}/29837/large/Morpho-token-icon.png?1726771230`,  // Morpho (verified CoinGecko CDN)
  CHIP: `https://assets.coingecko.com/coins/images/102171777/standard/CHIP_Token_Logo_Large.png?1776777444`, // USD.AI

  // ── Solana ecosystem ────────────────────────────────────────────────────
  SKR:  `https://gateway.irys.xyz/uP1dFvCofZQT26m3SKOCttXrir3ORBR1B8wPhP6tv7M?ext=png`,  // Seeker (SKR) — on-chain metadata logo (assets.coingecko path was dead)
  JTO:  `${CG}/33228/standard/jto.png?1701137022`,           // Jito governance token

  // ── Meme / misc ─────────────────────────────────────────────────────────
  FARTCOIN: `${CG}/50891/standard/fart.jpg?1729503972`,
  PUMP: `${CG_CDN}/67164/large/pump.jpg?1751949376`,  // Pump.fun

  // ── Newer chains ────────────────────────────────────────────────────────
  XPL:  `${CG}/66489/standard/Plasma-symbol-green-1.png?1755142558`,

  // ── Recently added perps ────────────────────────────────────────────────
  ONDO:   `${CG}/26580/small/ONDO.png`,
  VIRTUAL: `${CG_CDN}/34057/large/LOGOMARK.png?1708356054`,  // Virtuals Protocol (verified CoinGecko CDN)
  RENDER: `${CG_CDN}/11636/large/rndr.png?1696511529`,       // Render token (verified CoinGecko CDN)
  FET:    `${CG}/5681/small/Fetch.jpg`,

  // ── Wrapped / bridge variants ─────────────────────────────────────────
  WBTC: `${SOLANA_CDN}/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh/logo.png`,
  WETH: `${SOLANA_CDN}/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png`,

  // ── Solana DeFi ──────────────────────────────────────────────────────────
  USDC:   `${SOLANA_CDN}/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png`,
  JLP:    'https://static.jup.ag/jlp/icon.png',
  JUP:    `${CG_CDN}/34188/large/jup.png?1704266489`,  // Jupiter (verified CoinGecko CDN)
  BONK:   `${SOLANA_CDN}/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263/logo.png`,
  PYTH:   'https://pyth.network/token.svg',
  WIF:    'https://bafkreibk3covs5ltyqxa272uodhculbgn2fo3cdbmxwhdirczkucqkiki4.ipfs.nftstorage.link',
  POPCAT: 'https://bafkreiapyfu3iibxfnsnlpqfr3kbzmbv4eqkgfekufqovhcwmjjqjklkh4.ipfs.nftstorage.link',

  // ── Commodity perps — SVG data URIs (no token contract, commodity icons) ─
  // Gold: stylized "Au" circle in gold
  GOLD: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23F5C518'/%3E%3Ctext x='50' y='62' text-anchor='middle' font-size='40' font-weight='700' font-family='Georgia%2Cserif' fill='%23000'%3EAu%3C/text%3E%3C/svg%3E`,
  // Silver: stylized "Ag" circle in silver
  SILVER: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23C0C0C0'/%3E%3Ctext x='50' y='62' text-anchor='middle' font-size='40' font-weight='700' font-family='Georgia%2Cserif' fill='%23000'%3EAg%3C/text%3E%3C/svg%3E`,
  // WTI Oil: oil drum icon in dark brown/orange
  WTIOIL: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23333'/%3E%3Ctext x='50' y='58' text-anchor='middle' font-size='28' font-weight='700' font-family='Arial%2Csans-serif' fill='%23F97316'%3EWTI%3C/text%3E%3C/svg%3E`,
  // Copper: stylized "Cu" circle in copper/orange
  COPPER: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23b87333'/%3E%3Ctext x='50' y='62' text-anchor='middle' font-size='40' font-weight='700' font-family='Georgia%2Cserif' fill='%23fff'%3ECu%3C/text%3E%3C/svg%3E`,

  // ── Equity perps — SVG data URIs (no token contract, brand icons) ────────
  // Apple: white apple glyph on black circle
  AAPL: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23000'/%3E%3Cpath transform='translate(26 24) scale(2)' fill='%23fff' d='M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z'/%3E%3C/svg%3E`,
  // NVIDIA: white "NVDA" wordmark on signature NVIDIA green
  NVDA: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%2376B900'/%3E%3Ctext x='50' y='59' text-anchor='middle' font-size='24' font-weight='800' font-family='Arial%2Csans-serif' fill='%23fff'%3ENVDA%3C/text%3E%3C/svg%3E`,
  // SpaceX: white "SPCX" wordmark on black circle
  SPCX: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23000'/%3E%3Ctext x='50' y='59' text-anchor='middle' font-size='24' font-weight='800' font-family='Arial%2Csans-serif' fill='%23fff'%3ESPCX%3C/text%3E%3C/svg%3E`,
  // Google: official 4-color "G" mark on white circle
  GOOGL: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23fff'/%3E%3Cg transform='translate(20 20) scale(1.25)'%3E%3Cpath fill='%23EA4335' d='M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'/%3E%3Cpath fill='%234285F4' d='M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'/%3E%3Cpath fill='%23FBBC05' d='M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'/%3E%3Cpath fill='%2334A853' d='M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'/%3E%3C/g%3E%3C/svg%3E`,
  // Tesla: white "T" wordmark on Tesla red circle
  TSLA: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23E82127'/%3E%3Cpath fill='%23fff' d='M50 28 c-8 0-16 1-22 3 1 3 3 5 6 6 4-1 8-2 16-2s12 1 16 2c3-1 5-3 6-6-6-2-14-3-22-3z M47 72 V37 h6 v35 z'/%3E%3C/svg%3E`,
  // Micron: real brand logo via Google's favicon service (stable, Google-hosted)
  MU: `https://www.google.com/s2/favicons?domain=micron.com&sz=128`,
  // Equity brand logos via Google's favicon service (stable, Google-hosted)
  META: `https://www.google.com/s2/favicons?domain=meta.com&sz=128`,        // Meta Platforms
  INTC: `https://www.google.com/s2/favicons?domain=intel.com&sz=128`,       // Intel
  CRWV: `https://www.google.com/s2/favicons?domain=coreweave.com&sz=128`,   // CoreWeave
  SNDK: `https://www.google.com/s2/favicons?domain=sandisk.com&sz=128`,     // SanDisk
  MSFT: `https://www.google.com/s2/favicons?domain=microsoft.com&sz=128`,   // Microsoft
  AMD:  `https://www.google.com/s2/favicons?domain=amd.com&sz=128`,         // AMD
  AMZN: `https://www.google.com/s2/favicons?domain=amazon.com&sz=128`,      // Amazon
};

/**
 * Get the primary (curated) logo URL for a symbol.
 * Strips "-PERP" suffix if present.
 * Returns null if not in the curated map — use getFallbackLogoUrl next.
 */
export function getTokenLogoUrl(symbol: string): string | null {
  const base = symbol.replace(/-PERP$/i, '').toUpperCase();
  return TOKEN_LOGO_URLS[base] ?? null;
}

/**
 * Generic fallback: spothq/cryptocurrency-icons SVG repo.
 * Returns a URL that may 404 for unknown tokens — use onError to handle.
 */
export function getFallbackLogoUrl(symbol: string): string {
  const base = symbol.replace(/-PERP$/i, '').toLowerCase();
  return `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color/${base}.svg`;
}

/**
 * Deterministic color for fallback letter avatar based on symbol string.
 */
export function getTokenColor(symbol: string): string {
  const base = symbol.replace(/-PERP$/i, '').toUpperCase();
  const palette = [
    '#FF7A1A', '#4ADE80', '#60A5FA', '#F472B6',
    '#A78BFA', '#34D399', '#FBBF24', '#F87171',
  ];
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash * 31 + base.charCodeAt(i)) & 0xffffffff;
  }
  return palette[Math.abs(hash) % palette.length];
}
