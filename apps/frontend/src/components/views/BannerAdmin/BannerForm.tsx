'use client';

import { Banner, BannerCriticality } from '@auto-drive/models';
import { useCallback, useState } from 'react';
import { BannerItem } from '../../organisms/BannerNotifications/BannerItem';

type BannerFormData = {
  title: string;
  body: string;
  criticality: BannerCriticality;
  dismissable: boolean;
  requiresAcknowledgement: boolean;
  displayStart: string;
  displayEnd: string;
  active: boolean;
};

const defaultFormData: BannerFormData = {
  title: '',
  body: '',
  criticality: BannerCriticality.Info,
  dismissable: true,
  requiresAcknowledgement: false,
  displayStart: new Date().toISOString().slice(0, 16),
  displayEnd: '',
  active: true,
};

interface BannerFormProps {
  initialData?: Banner;
  onSubmit: (data: BannerFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}

export const BannerForm = ({
  initialData,
  onSubmit,
  onCancel,
  submitLabel,
}: BannerFormProps) => {
  const [form, setForm] = useState<BannerFormData>(
    initialData
      ? {
          title: initialData.title,
          body: initialData.body,
          criticality: initialData.criticality,
          dismissable: initialData.dismissable,
          requiresAcknowledgement: initialData.requiresAcknowledgement,
          displayStart: new Date(initialData.displayStart)
            .toISOString()
            .slice(0, 16),
          displayEnd: initialData.displayEnd
            ? new Date(initialData.displayEnd).toISOString().slice(0, 16)
            : '',
          active: initialData.active,
        }
      : defaultFormData,
  );
  const [showPreview, setShowPreview] = useState(false);
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

  const previewBanner: Banner = {
    id: 'preview',
    title: form.title || 'Preview Title',
    body: form.body || 'Preview body text',
    criticality: form.criticality,
    dismissable: form.dismissable,
    requiresAcknowledgement: form.requiresAcknowledgement,
    displayStart: new Date(form.displayStart),
    displayEnd: form.displayEnd ? new Date(form.displayEnd) : null,
    active: form.active,
    createdBy: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return (
    <form onSubmit={handleSubmit} className='space-y-4'>
      <div>
        <label htmlFor='banner-title' className='block text-sm font-medium mb-1'>Title</label>
        <input
          id='banner-title'
          type='text'
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
          required
        />
      </div>

      <div>
        <label htmlFor='banner-body' className='block text-sm font-medium mb-1'>Body</label>
        <textarea
          id='banner-body'
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
          rows={4}
          required
        />
      </div>

      <div>
        <label htmlFor='banner-criticality' className='block text-sm font-medium mb-1'>Criticality</label>
        <select
          id='banner-criticality'
          value={form.criticality}
          onChange={(e) =>
            setForm({
              ...form,
              criticality: e.target.value as BannerCriticality,
            })
          }
          className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
        >
          <option value={BannerCriticality.Info}>Info</option>
          <option value={BannerCriticality.Warning}>Warning</option>
          <option value={BannerCriticality.Critical}>Critical</option>
        </select>
      </div>

      <div className='flex gap-6'>
        <label className='flex items-center gap-2 text-sm'>
          <input
            type='checkbox'
            checked={form.dismissable}
            onChange={(e) =>
              setForm({ ...form, dismissable: e.target.checked })
            }
          />
          Dismissable
        </label>
        <label className='flex items-center gap-2 text-sm'>
          <input
            type='checkbox'
            checked={form.requiresAcknowledgement}
            onChange={(e) =>
              setForm({ ...form, requiresAcknowledgement: e.target.checked })
            }
          />
          Requires Acknowledgement
        </label>
        <label className='flex items-center gap-2 text-sm'>
          <input
            type='checkbox'
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Active
        </label>
      </div>

      <div className='flex gap-4'>
        <div className='flex-1'>
          <label htmlFor='banner-display-start' className='block text-sm font-medium mb-1'>
            Display Start
          </label>
          <input
            id='banner-display-start'
            type='datetime-local'
            value={form.displayStart}
            onChange={(e) =>
              setForm({ ...form, displayStart: e.target.value })
            }
            className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
            required
          />
        </div>
        <div className='flex-1'>
          <label htmlFor='banner-display-end' className='block text-sm font-medium mb-1'>
            Display End (optional)
          </label>
          <input
            id='banner-display-end'
            type='datetime-local'
            value={form.displayEnd}
            onChange={(e) => setForm({ ...form, displayEnd: e.target.value })}
            className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
          />
        </div>
      </div>

      <div>
        <button
          type='button'
          onClick={() => setShowPreview(!showPreview)}
          className='text-sm text-muted-foreground underline'
        >
          {showPreview ? 'Hide Preview' : 'Show Preview'}
        </button>
        {showPreview && (
          <div className='mt-2'>
            <BannerItem banner={previewBanner} preview />
          </div>
        )}
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

export type { BannerFormData };
