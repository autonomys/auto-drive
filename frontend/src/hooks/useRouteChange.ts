import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Hook to detect route changes and execute a callback
 * 
 * @param callback Function to execute when route changes
 * @param options Configuration options
 * @returns void
 */
export function useRouteChange(
  callback: () => void, 
  options: { 
    skipFirstRender?: boolean;
    enabled?: boolean;
  } = {}
) {
  const { skipFirstRender = true, enabled = true } = options;
  const pathname = usePathname();
  const previousPathRef = useRef<string | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip if disabled
    if (!enabled) return;
    
    // Skip the first render if requested
    if (skipFirstRender && isFirstRender.current) {
      isFirstRender.current = false;
      previousPathRef.current = pathname;
      return;
    }
    
    // Check if the route has changed
    if (previousPathRef.current !== pathname) {
      previousPathRef.current = pathname;
      callback();
    }
  }, [pathname, callback, skipFirstRender, enabled]);
} 