'use client';

import { useCallback, useEffect, useState } from 'react';
import { Banner, BannerCriticality } from '@auto-drive/models';
import { useNetwork } from 'contexts/network';
import { BannerForm, BannerFormData } from './BannerForm';

const criticalityBadge: Record<BannerCriticality, string> = {
  [BannerCriticality.Info]:
    'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  [BannerCriticality.Warning]:
    'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  [BannerCriticality.Critical]:
    'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

export const BannerAdmin = () => {
  const { api } = useNetwork();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);

  const fetchBanners = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getAllBanners();
      setBanners(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load banners');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchBanners();
  }, [fetchBanners]);

  const handleCreate = useCallback(
    async (data: BannerFormData) => {
      await api.createBanner({
        title: data.title,
        body: data.body,
        criticality: data.criticality,
        dismissable: data.dismissable,
        requiresAcknowledgement: data.requiresAcknowledgement,
        displayStart: new Date(data.displayStart).toISOString(),
        displayEnd: data.displayEnd
          ? new Date(data.displayEnd).toISOString()
          : null,
        active: data.active,
      });
      setShowForm(false);
      fetchBanners();
    },
    [api, fetchBanners],
  );

  const handleUpdate = useCallback(
    async (data: BannerFormData) => {
      if (!editingBanner) return;
      await api.updateBanner(editingBanner.id, {
        title: data.title,
        body: data.body,
        criticality: data.criticality,
        dismissable: data.dismissable,
        requiresAcknowledgement: data.requiresAcknowledgement,
        displayStart: new Date(data.displayStart).toISOString(),
        displayEnd: data.displayEnd
          ? new Date(data.displayEnd).toISOString()
          : null,
        active: data.active,
      });
      setEditingBanner(null);
      fetchBanners();
    },
    [api, editingBanner, fetchBanners],
  );

  const handleToggle = useCallback(
    async (bannerId: string, active: boolean) => {
      await api.toggleBanner(bannerId, active);
      fetchBanners();
    },
    [api, fetchBanners],
  );

  if (loading) {
    return <div className='p-6'>Loading banners...</div>;
  }

  return (
    <div className='space-y-6 py-6'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-semibold'>Banner Management</h1>
        {!showForm && !editingBanner && (
          <button
            onClick={() => setShowForm(true)}
            className='rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90'
          >
            Create Banner
          </button>
        )}
      </div>

      {error && (
        <div className='rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700'>
          {error}
        </div>
      )}

      {showForm && (
        <div className='rounded-lg border border-border p-4'>
          <h2 className='mb-4 text-lg font-medium'>Create New Banner</h2>
          <BannerForm
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
            submitLabel='Create Banner'
          />
        </div>
      )}

      {editingBanner && (
        <div className='rounded-lg border border-border p-4'>
          <h2 className='mb-4 text-lg font-medium'>Edit Banner</h2>
          <BannerForm
            initialData={editingBanner}
            onSubmit={handleUpdate}
            onCancel={() => setEditingBanner(null)}
            submitLabel='Save Changes'
          />
        </div>
      )}

      <div className='overflow-hidden rounded-lg border border-border'>
        <table className='w-full text-sm'>
          <thead className='border-b border-border bg-muted/50'>
            <tr>
              <th className='px-4 py-3 text-left font-medium'>Title</th>
              <th className='px-4 py-3 text-left font-medium'>Criticality</th>
              <th className='px-4 py-3 text-left font-medium'>Status</th>
              <th className='px-4 py-3 text-left font-medium'>Schedule</th>
              <th className='px-4 py-3 text-left font-medium'>Options</th>
              <th className='px-4 py-3 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {banners.length === 0 ? (
              <tr>
                <td colSpan={6} className='px-4 py-8 text-center text-muted-foreground'>
                  No banners created yet.
                </td>
              </tr>
            ) : (
              banners.map((banner) => (
                <tr key={banner.id} className='border-b border-border last:border-0'>
                  <td className='px-4 py-3 font-medium'>{banner.title}</td>
                  <td className='px-4 py-3'>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${criticalityBadge[banner.criticality]}`}
                    >
                      {banner.criticality}
                    </span>
                  </td>
                  <td className='px-4 py-3'>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        banner.active
                          ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                      }`}
                    >
                      {banner.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className='px-4 py-3 text-muted-foreground'>
                    {new Date(banner.displayStart).toLocaleDateString()}
                    {banner.displayEnd
                      ? ` — ${new Date(banner.displayEnd).toLocaleDateString()}`
                      : ' — No end'}
                  </td>
                  <td className='px-4 py-3 text-muted-foreground text-xs'>
                    {banner.dismissable && 'Dismissable'}
                    {banner.dismissable && banner.requiresAcknowledgement && ', '}
                    {banner.requiresAcknowledgement && 'Ack required'}
                  </td>
                  <td className='px-4 py-3 text-right'>
                    <div className='flex justify-end gap-2'>
                      <button
                        onClick={() => setEditingBanner(banner)}
                        className='rounded-md border border-border px-3 py-1 text-xs hover:bg-accent'
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggle(banner.id, !banner.active)}
                        className='rounded-md border border-border px-3 py-1 text-xs hover:bg-accent'
                      >
                        {banner.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
