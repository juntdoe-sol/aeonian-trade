import { useState, useEffect } from 'react';

/**
 * Universal hook for subscribing to Poof real-time data.
 *
 * @param subscribeFn - The subscribe function from the generated SDK: must start with subscribe or subscribeMany
 * @param enabled - Whether to enable the subscription
 * @param args - All arguments to pass to the subscribe function from the param subscribeFn like the path params or query params
 * @returns Object containing data, loading state, and error state
 *
 * @example
 * // For a single entity
 * const { data, loading, error } = useRealtimeData<PostsData | null>(
 *   subscribePost,
 *   true,
 *   postId
 * );
 *
 * // For a collection
 * const { data, loading, error } = useRealtimeData<PostsData[]>(
 *   subscribeManyPosts,
 *   true,
 *   "where title contains 'React'"
 * );
 *
 * // For nested resources
 * const { data, loading, error } = useRealtimeData<CommentsData | null>(
 *   subscribeComment,
 *   true,
 *   postId,
 *   commentId
 * );
 */
export function useRealtimeData<T>(
  subscribeFn: (callback: (data: T) => void, ...args: any[]) => Promise<() => void>,
  enabled: boolean,
  ...args: any[]
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    let unsubscribe: (() => void) | undefined;

    // Create a callback function that sets the data
    const callback = (newData: T) => {
      setData(newData);
      setLoading(false);
    };

    // Call the subscribe function with all args plus our callback
    subscribeFn(callback, ...args)
      .then((unsub) => {
        unsubscribe = unsub;
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });

    // Return cleanup function
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [subscribeFn, enabled, ...args]); // Dependencies are all the args

  return { data, loading, error };
}
