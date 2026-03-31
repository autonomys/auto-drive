'use client';

import { TouChangeType, TouVersion } from '@auto-drive/models';
import { useCallback, useState } from 'react';

export type TouVersionFormData = {
  versionLabel: string;
  effectiveDate: string;
  contentUrl: string;
  changeType: TouChangeType;
  adminNotes: string;
};

const defaultFormData: TouVersionFormData = {
  versionLabel: '',
  effectiveDate: '',
  contentUrl: '',
  changeType: TouChangeType.Material,
  adminNotes: '',
};

interface TouVersionFormProps {
  initialData?: TouVersion;
  onSubmit: (data: TouVersionFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}

export const TouVersionForm = ({
  initialData,
  onSubmit,
  onCancel,
  submitLabel,
}: TouVersionFormProps) => {
  const [form, setForm] = useState<TouVersionFormData>(
    initialData
      ? {
          versionLabel: initialData.versionLabel,
          effectiveDate: new Date(initialData.effectiveDate)
            .toISOString()
            .slice(0, 16),
          contentUrl: initialData.contentUrl,
          changeType: initialData.changeType,
          adminNotes: initialData.adminNotes || '',
        }
      : defaultFormData,
  );
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      try {
        await onSubmit(form);
      } finally {
        setSubmitting(false);
      }
    },
    [form, onSubmit],
  );

  return (
    <form onSubmit={handleSubmit} className='space-y-4'>
      <div>
        <label
          htmlFor='tou-version-label'
          className='mb-1 block text-sm font-medium'
        >
          Version Label
        </label>
        <input
          id='tou-version-label'
          type='text'
          value={form.versionLabel}
          onChange={(e) => setForm({ ...form, versionLabel: e.target.value })}
          placeholder='e.g. v2.0'
          className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
          required
        />
      </div>

      <div>
        <label
          htmlFor='tou-effective-date'
          className='mb-1 block text-sm font-medium'
        >
          Effective Date
        </label>
        <input
          id='tou-effective-date'
          type='datetime-local'
          value={form.effectiveDate}
          onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
          className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
          required
        />
      </div>

      <div>
        <label
          htmlFor='tou-content-url'
          className='mb-1 block text-sm font-medium'
        >
          Content URL
        </label>
        <input
          id='tou-content-url'
          type='url'
          value={form.contentUrl}
          onChange={(e) => setForm({ ...form, contentUrl: e.target.value })}
          placeholder='https://www.autonomys.xyz/terms-of-use'
          className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
          required
        />
      </div>

      <div>
        <label
          htmlFor='tou-change-type'
          className='mb-1 block text-sm font-medium'
        >
          Change Type
        </label>
        <select
          id='tou-change-type'
          value={form.changeType}
          onChange={(e) =>
            setForm({
              ...form,
              changeType: e.target.value as TouChangeType,
            })
          }
          className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
        >
          <option value={TouChangeType.Material}>
            Material (requires acceptance)
          </option>
          <option value={TouChangeType.NonMaterial}>
            Non-material (informational only)
          </option>
        </select>
      </div>

      <div>
        <label
          htmlFor='tou-admin-notes'
          className='mb-1 block text-sm font-medium'
        >
          Admin Notes (optional)
        </label>
        <textarea
          id='tou-admin-notes'
          value={form.adminNotes}
          onChange={(e) => setForm({ ...form, adminNotes: e.target.value })}
          className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
          rows={3}
          placeholder='Internal notes about this version change...'
        />
      </div>

      <div className='flex gap-2'>
        <button
          type='submit'
          disabled={submitting}
          className='rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
        >
          {submitting ? 'Saving...' : submitLabel}
        </button>
        <button
          type='button'
          onClick={onCancel}
          className='rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent'
        >
          Cancel
        </button>
      </div>
    </form>
  );
};
