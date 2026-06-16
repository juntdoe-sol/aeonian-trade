/**
 * OAuth Hook
 *
 * Re-exports the useOAuth hook from OAuthContext for convenience.
 * This hook provides OAuth functionality including:
 * - Connecting to social providers (Twitter, Google, Discord, GitHub)
 * - Checking verification status
 * - Disconnecting providers
 * - Accessing linked account information
 *
 * @example
 * ```tsx
 * import { useOAuth } from '@/hooks/useOAuth';
 *
 * function MyComponent() {
 *   const { connect, isVerified, getLink } = useOAuth();
 *
 *   return (
 *     <button onClick={() => connect('twitter')}>
 *       {isVerified('twitter') ? 'Connected' : 'Connect Twitter'}
 *     </button>
 *   );
 * }
 * ```
 */

export { useOAuth } from '@/contexts/OAuthContext';
export type { OAuthProvider } from '@/contexts/OAuthContext';

