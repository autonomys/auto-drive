import { usePrices } from '../../../hooks/usePrices';
import { utcToLocalRelativeTime } from '../../../utils/time';

/**
 * The caveat that goes with a USD figure the market no longer vouches for.
 *
 * Every USD number on this screen is a conversion of the AI3 price at a rate
 * read from the WAI3/USDC pool. That rate can be old in two ways, and neither
 * is visible in the number itself: the backend's live read may have failed,
 * leaving it serving a last-good value for up to a day, or the read may have
 * succeeded against a pool that has not traded in weeks. The estimate's window
 * is 30 days deep and accepts a single fill, so the second case is the ordinary
 * one for a quiet market rather than an edge case.
 *
 * Rendering nothing in either case would be the same mistake the suspended
 * exchange ticker made — presenting a number as current because nothing in the
 * payload said otherwise. Renders null when the estimate is live, or absent
 * entirely; there is nothing to qualify then.
 */
export const UsdEstimateNote = ({ className }: { className?: string }) => {
  const { usdRateOutdated, usdRateStale, usdRateLastTradeAt } = usePrices();

  if (!usdRateOutdated) return null;

  // The trade time is what a reader can act on — "we last read it a minute ago"
  // is our problem, not information about the price. Named only when the
  // backend gave us one.
  const traded = usdRateLastTradeAt
    ? `last traded ${utcToLocalRelativeTime(usdRateLastTradeAt)}`
    : null;

  return (
    <div className={className}>
      <span className='text-xs text-muted-foreground'>
        USD figures are estimates from the AI3/USDC pool
        {traded ? `, which ${traded}` : ''}
        {usdRateStale ? ' (live rate unavailable)' : ''}. The AI3 amount is what
        you pay.
      </span>
    </div>
  );
};
