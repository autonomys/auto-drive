import { UsageDays } from '@/utils/usageReport';

const inputClass =
  'rounded border border-gray-300 bg-background px-2 py-1 text-sm';

/** Whole UTC days, `from` through `through`. */
export const UsageDaysPicker = ({
  days,
  onChange,
}: {
  days: UsageDays;
  onChange: (days: UsageDays) => void;
}) => (
  <div className='flex flex-wrap items-center gap-2 text-sm'>
    <label className='flex items-center gap-1'>
      From
      <input
        type='date'
        className={inputClass}
        value={days.from}
        max={days.through || undefined}
        onChange={(e) => onChange({ ...days, from: e.target.value })}
      />
    </label>
    <label className='flex items-center gap-1'>
      through
      <input
        type='date'
        className={inputClass}
        value={days.through}
        min={days.from || undefined}
        onChange={(e) => onChange({ ...days, through: e.target.value })}
      />
    </label>
    <span className='text-xs text-gray-500'>UTC</span>
  </div>
);
