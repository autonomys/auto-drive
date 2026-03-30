'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  TouChangeType,
  TouVersion,
  TouVersionStatus,
} from '@auto-drive/models';
import { useNetwork } from 'contexts/network';
import { useQueryClient } from '@tanstack/react-query';
import { TouVersionForm, TouVersionFormData } from './TouVersionForm';

const statusBadge: Record<TouVersionStatus, string> = {
  [TouVersionStatus.Draft]:
    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  [TouVersionStatus.Pending]:
    'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  [TouVersionStatus.Active]:
    'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  [TouVersionStatus.Archived]:
    'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
};

const changeTypeBadge: Record<TouChangeType, string> = {
  [TouChangeType.Material]:
    'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  [TouChangeType.NonMaterial]:
    'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
};

export const TouAdmin = () => {
  const { api } = useNetwork();
  const queryClient = useQueryClient();
  const [versions, setVersions] = useState<TouVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingVersion, setEditingVersion] = useState<TouVersion | null>(null);
  const [promoteOverride, setPromoteOverride] = useState<{
    id: string;
    reason: string;
  } | null>(null);

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getAllTouVersions();
      setVersions(result);
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Failed to load ToU versions',
      );
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const handleCreate = useCallback(
    async (data: TouVersionFormData) => {
      await api.createTouVersion({
        versionLabel: data.versionLabel,
        effectiveDate: new Date(data.effectiveDate).toISOString(),
        contentUrl: data.contentUrl,
        changeType: data.changeType,
        adminNotes: data.adminNotes || undefined,
      });
      setShowForm(false);
      fetchVersions();
    },
    [api, fetchVersions],
  );

  const handleUpdate = useCallback(
    async (data: TouVersionFormData) => {
      if (!editingVersion) return;
      await api.updateTouVersion(editingVersion.id, {
        versionLabel: data.versionLabel,
        effectiveDate: new Date(data.effectiveDate).toISOString(),
        contentUrl: data.contentUrl,
        changeType: data.changeType,
        adminNotes: data.adminNotes || null,
      });
      setEditingVersion(null);
      fetchVersions();
    },
    [api, editingVersion, fetchVersions],
  );

  const handlePromote = useCallback(
    async (id: string) => {
      try {
        await api.promoteTouVersion(id);
        queryClient.invalidateQueries({ queryKey: ['touStatus'] });
        fetchVersions();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to promote';
        if (msg.includes('30 days notice')) {
          setPromoteOverride({ id, reason: '' });
        } else {
          setError(msg);
        }
      }
    },
    [api, fetchVersions],
  );

  const handlePromoteOverride = useCallback(async () => {
    if (!promoteOverride) return;
    try {
      await api.promoteTouVersion(
        promoteOverride.id,
        true,
        promoteOverride.reason,
      );
      setPromoteOverride(null);
      queryClient.invalidateQueries({ queryKey: ['touStatus'] });
      fetchVersions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to promote');
    }
  }, [api, promoteOverride, fetchVersions]);

  const handleActivate = useCallback(
    async (id: string) => {
      try {
        await api.activateTouVersion(id);
        queryClient.invalidateQueries({ queryKey: ['touStatus'] });
        fetchVersions();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to activate');
      }
    },
    [api, fetchVersions],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      try {
        await api.archiveTouVersion(id);
        queryClient.invalidateQueries({ queryKey: ['touStatus'] });
        fetchVersions();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to archive');
      }
    },
    [api, fetchVersions],
  );

  if (loading) {
    return <div className='p-6'>Loading ToU versions...</div>;
  }

  return (
    <div className='space-y-6 py-6'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-semibold'>Terms of Use Management</h1>
        {!showForm && !editingVersion && (
          <button
            onClick={() => setShowForm(true)}
            className='rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90'
          >
            Create Version
          </button>
        )}
      </div>

      {error && (
        <div className='rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/40 dark:text-red-300'>
          {error}
          <button
            onClick={() => setError(null)}
            className='ml-2 underline'
          >
            dismiss
          </button>
        </div>
      )}

      {promoteOverride && (
        <div className='rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/40'>
          <h3 className='mb-2 font-medium text-amber-800 dark:text-amber-200'>
            Notice Period Override
          </h3>
          <p className='mb-3 text-sm text-amber-700 dark:text-amber-300'>
            Material changes require at least 30 days notice. Provide a reason
            for this emergency override.
          </p>
          <textarea
            value={promoteOverride.reason}
            onChange={(e) =>
              setPromoteOverride({ ...promoteOverride, reason: e.target.value })
            }
            placeholder='Reason for emergency override (required)...'
            className='mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
            rows={2}
          />
          <div className='flex gap-2'>
            <button
              onClick={handlePromoteOverride}
              disabled={!promoteOverride.reason.trim()}
              className='rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50'
            >
              Override and Promote
            </button>
            <button
              onClick={() => setPromoteOverride(null)}
              className='rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent'
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <div className='rounded-lg border border-border p-4'>
          <h2 className='mb-4 text-lg font-medium'>Create New ToU Version</h2>
          <TouVersionForm
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
            submitLabel='Create Version'
          />
        </div>
      )}

      {editingVersion && (
        <div className='rounded-lg border border-border p-4'>
          <h2 className='mb-4 text-lg font-medium'>Edit ToU Version</h2>
          <TouVersionForm
            initialData={editingVersion}
            onSubmit={handleUpdate}
            onCancel={() => setEditingVersion(null)}
            submitLabel='Save Changes'
          />
        </div>
      )}

      <div className='overflow-hidden rounded-lg border border-border'>
        <table className='w-full text-sm'>
          <thead className='border-b border-border bg-muted/50'>
            <tr>
              <th className='px-4 py-3 text-left font-medium'>Version</th>
              <th className='px-4 py-3 text-left font-medium'>Change Type</th>
              <th className='px-4 py-3 text-left font-medium'>Status</th>
              <th className='px-4 py-3 text-left font-medium'>
                Effective Date
              </th>
              <th className='px-4 py-3 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {versions.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className='px-4 py-8 text-center text-muted-foreground'
                >
                  No ToU versions created yet.
                </td>
              </tr>
            ) : (
              versions.map((version) => (
                <tr
                  key={version.id}
                  className='border-b border-border last:border-0'
                >
                  <td className='px-4 py-3 font-medium'>
                    {version.versionLabel}
                  </td>
                  <td className='px-4 py-3'>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${changeTypeBadge[version.changeType]}`}
                    >
                      {version.changeType}
                    </span>
                  </td>
                  <td className='px-4 py-3'>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge[version.status]}`}
                    >
                      {version.status}
                    </span>
                  </td>
                  <td className='px-4 py-3 text-muted-foreground'>
                    {new Date(version.effectiveDate).toLocaleDateString()}
                  </td>
                  <td className='px-4 py-3 text-right'>
                    <div className='flex justify-end gap-2'>
                      {version.status === TouVersionStatus.Draft && (
                        <>
                          <button
                            onClick={() => setEditingVersion(version)}
                            className='rounded-md border border-border px-3 py-1 text-xs hover:bg-accent'
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handlePromote(version.id)}
                            className='rounded-md border border-border px-3 py-1 text-xs hover:bg-accent'
                          >
                            Promote
                          </button>
                        </>
                      )}
                      {version.status === TouVersionStatus.Pending && (
                        <>
                          <button
                            onClick={() => handleActivate(version.id)}
                            className='rounded-md border border-border px-3 py-1 text-xs hover:bg-accent'
                          >
                            Activate Now
                          </button>
                          <button
                            onClick={() => handleArchive(version.id)}
                            className='rounded-md border border-border px-3 py-1 text-xs hover:bg-accent'
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {version.status === TouVersionStatus.Active && (
                        <button
                          onClick={() => handleArchive(version.id)}
                          className='rounded-md border border-border px-3 py-1 text-xs hover:bg-accent'
                        >
                          Archive
                        </button>
                      )}
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
