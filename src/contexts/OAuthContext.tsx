import { getPoofAPIUrl, POOF_OAUTH_URL } from '@/lib/config';
import { getIdToken, useAuth } from '@pooflabs/web';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

export type OAuthProvider = 'twitter' | 'google' | 'discord' | 'github';

/**
 * Check if an origin is allowed for postMessage communication.
 * Uses same-origin validation - only accepts messages from the current window's origin.
 * This is secure because:
 * 1. The OAuth popup redirects back to the same origin as the opener
 * 2. Both popup and parent window are on the user's app domain
 * 3. This works for both *.poof.new and custom user domains
 */
function isAllowedOrigin(origin: string): boolean {
  return origin === window.location.origin;
}

/**
 * Check if the app is running inside an iframe.
 * OAuth providers like Twitter/X don't allow being loaded in iframes (X-Frame-Options: deny),
 * so we need to use popup windows for OAuth when embedded.
 */
function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // If we can't access window.top due to cross-origin restrictions, we're in an iframe
    return true;
  }
}

interface SocialLinkProfile {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
  displayName?: string;
  metadata?: Record<string, any>;
}

interface SocialLink {
  provider: OAuthProvider;
  profile: SocialLinkProfile;
  linkedAt: number;
}

interface OAuthContextValue {
  links: Record<OAuthProvider, SocialLink | null>;
  loading: boolean;
  connect: (provider: OAuthProvider) => Promise<void>;
  disconnect: (provider: OAuthProvider) => Promise<void>;
  refreshLinks: () => Promise<void>;
  isVerified: (provider: OAuthProvider) => boolean;
  getLink: (provider: OAuthProvider) => SocialLink | null;
}

const OAuthContext = createContext<OAuthContextValue | null>(null);

export function OAuthProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [links, setLinks] = useState<Record<OAuthProvider, SocialLink | null>>({
    twitter: null,
    google: null,
    discord: null,
    github: null,
  });
  const [loading, setLoading] = useState(false);
  const popupRef = useRef<Window | null>(null);

  // Handle OAuth callback redirects (for direct page navigation)
  useEffect(() => {
    const oauthSuccess = searchParams.get('oauth_success');
    const oauthError = searchParams.get('oauth_error');
    const providerParam = searchParams.get('provider') as OAuthProvider | null;

    // If we're in a popup window, notify the opener and close
    if (window.opener && (oauthSuccess || oauthError)) {
      // Use the current origin as target since popup was redirected back to the same origin as opener
      const targetOrigin = window.location.origin;

      // Only send message if origin is allowed to prevent token theft
      if (isAllowedOrigin(targetOrigin)) {
        window.opener.postMessage(
          {
            type: 'oauth-callback',
            success: oauthSuccess === 'true',
            provider: providerParam,
            error: oauthError === 'true' ? searchParams.get('message') : null,
          },
          targetOrigin
        );
      }
      window.close();
      return;
    }

    if (oauthSuccess === 'true' && providerParam) {
      toast.success(`Successfully connected ${providerParam}`);
      refreshLinks();
      // Clean URL
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete('oauth_success');
      newSearchParams.delete('provider');
      navigate(`${location.pathname}${newSearchParams.toString() ? `?${newSearchParams.toString()}` : ''}`, { replace: true });
    } else if (oauthError === 'true') {
      const message = searchParams.get('message') || 'OAuth failed';
      toast.error(`OAuth error: ${message}`);
      // Clean URL
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete('oauth_error');
      newSearchParams.delete('message');
      newSearchParams.delete('provider');
      navigate(`${location.pathname}${newSearchParams.toString() ? `?${newSearchParams.toString()}` : ''}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, navigate, location.pathname]);

  // Listen for OAuth completion messages from popup windows
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate origin to prevent accepting messages from malicious sources
      if (!isAllowedOrigin(event.origin)) return;

      // Only process oauth-callback messages
      if (event.data?.type !== 'oauth-callback') return;

      const { success, provider, error } = event.data;

      if (success && provider) {
        toast.success(`Successfully connected ${provider}`);
        refreshLinks();
      } else if (error) {
        toast.error(`OAuth error: ${error}`);
      }

      // Clean up popup reference
      popupRef.current = null;
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch all social links
  const refreshLinks = useCallback(async () => {
    if (!user?.address) {
      setLinks({
        twitter: null,
        google: null,
        discord: null,
        github: null,
      });
      return;
    }

    setLoading(true);
    try {
      const token = await getIdToken();
      if (!token) {
        setLoading(false);
        return;
      }

      const providers: OAuthProvider[] = ['twitter', 'google', 'discord', 'github'];
      const linkPromises = providers.map(async (provider) => {
        try {
          const response = await fetch(getPoofAPIUrl(`/api/social-links/${provider}`), {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Wallet-Address': user.address,
            },
          });

          if (response.ok) {
            const data = await response.json();
            const profile = typeof data.profile === 'string' ? JSON.parse(data.profile) : data.profile;
            return {
              provider,
              link: {
                provider: data.provider,
                profile,
                linkedAt: data.linkedAt,
              } as SocialLink,
            };
          }
          return { provider, link: null };
        } catch (error) {
          return { provider, link: null };
        }
      });

      const results = await Promise.all(linkPromises);
      const newLinks: Record<OAuthProvider, SocialLink | null> = {
        twitter: null,
        google: null,
        discord: null,
        github: null,
      };

      results.forEach(({ provider, link }) => {
        newLinks[provider] = link;
      });

      setLinks(newLinks);
    } catch (error) {
      console.error('Error fetching social links:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.address]);

  // Connect to a provider
  const connect = useCallback(
    async (provider: OAuthProvider) => {
      if (!user?.address) {
        toast.error('Please connect your wallet first');
        return;
      }

      const callbackUrl = getPoofAPIUrl('/api/oauth/callback');
      // Pass current page URL (origin + path) so user returns to the same page after OAuth.
      // This is important for mobile full-page redirect — user lands back where they started.
      const returnUrl = window.location.origin + window.location.pathname;
      const params = new URLSearchParams({
        wallet: user.address,
        callback: `${callbackUrl}?redirect=${encodeURIComponent(returnUrl)}`,
        v: '2',
      });

      const oauthUrl = `${POOF_OAUTH_URL}/${provider}?${params}`;

      // If we're in an iframe (e.g., Poof preview), use a popup window for OAuth.
      // OAuth providers like Twitter/X set X-Frame-Options: deny, so they can't load in iframes.
      if (isInIframe()) {
        // Close any existing popup
        if (popupRef.current && !popupRef.current.closed) {
          popupRef.current.close();
        }

        // Open OAuth in a centered popup window
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        const features = `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`;

        popupRef.current = window.open(oauthUrl, 'oauth-popup', features);

        if (!popupRef.current) {
          toast.error('Please allow popups for OAuth authentication');
        }
      } else {
        // Not in an iframe - use standard redirect flow
        window.location.href = oauthUrl;
      }
    },
    [user?.address],
  );

  // Disconnect a provider
  const disconnect = useCallback(
    async (provider: OAuthProvider) => {
      if (!user?.address) {
        toast.error('Please connect your wallet first');
        return;
      }

      try {
        const token = await getIdToken();
        if (!token) {
          toast.error('Authentication required');
          return;
        }

        const response = await fetch(getPoofAPIUrl(`/api/social-links/${provider}`), {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Wallet-Address': user.address,
          },
        });

        if (response.ok) {
          toast.success(`Disconnected ${provider}`);
          await refreshLinks();
        } else {
          const error = await response.json();
          toast.error(error.message || `Failed to disconnect ${provider}`);
        }
      } catch (error) {
        console.error('Error disconnecting:', error);
        toast.error(`Failed to disconnect ${provider}`);
      }
    },
    [user?.address, refreshLinks],
  );

  // Check if a provider is verified
  // Note: This will return false if wallet is not connected, since refreshLinks()
  // clears all links when user?.address is not available
  const isVerified = useCallback(
    (provider: OAuthProvider) => {
      // Ensure wallet is connected before checking verification
      if (!user?.address) {
        return false;
      }
      return links[provider] !== null;
    },
    [links, user?.address],
  );

  // Get link for a provider
  const getLink = useCallback(
    (provider: OAuthProvider) => {
      return links[provider];
    },
    [links],
  );

  // Refresh links when user changes
  useEffect(() => {
    refreshLinks();
  }, [refreshLinks]);

  const value: OAuthContextValue = {
    links,
    loading,
    connect,
    disconnect,
    refreshLinks,
    isVerified,
    getLink,
  };

  return <OAuthContext.Provider value={value}>{children}</OAuthContext.Provider>;
}

export function useOAuth(): OAuthContextValue {
  const context = useContext(OAuthContext);
  if (!context) {
    throw new Error('useOAuth must be used within an OAuthProvider');
  }
  return context;
}

