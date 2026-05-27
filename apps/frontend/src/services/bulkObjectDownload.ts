import { isInsecure, ObjectInformation } from '@auto-drive/models';
import { DownloadProgressInfo } from 'services/download';

export type BulkDownloadStatus =
  | 'pending'
  | 'skipped'
  | 'checking'
  | 'preparing'
  | 'downloading'
  | 'completed'
  | 'failed';

export type EncryptionChoice =
  | 'download-encrypted'
  | 'shared-password'
  | 'skip';

export interface BulkDownloadItem {
  cid: string;
  information?: ObjectInformation;
  status: BulkDownloadStatus;
  progress?: DownloadProgressInfo | null;
  error?: string;
  skippedReason?: string;
}

export interface EncryptionContext {
  defaultPassword?: string | null;
  encryptionChoice: EncryptionChoice | null;
  sharedPassword: string;
}

export interface ResolvedEncryptionOptions {
  password: string | undefined;
  skipDecryption: boolean;
}

export const hasEncryption = (item: BulkDownloadItem): boolean =>
  !!item.information?.metadata.uploadOptions?.encryption?.algorithm;

// Items that are eligible to run in the queue. Insecure items pass this
// predicate but are gated separately at runtime (see `shouldSkipInsecure`)
// so the user's confirmation toggle isn't bypassed.
export const itemIsRunnable = (
  item: BulkDownloadItem,
): item is BulkDownloadItem & { information: ObjectInformation } =>
  item.status === 'pending' && !!item.information;

export const shouldSkipInsecure = (
  item: BulkDownloadItem,
  hasConfirmedInsecure: boolean,
): boolean => {
  if (!item.information) return false;
  return isInsecure(item.information.tags) && !hasConfirmedInsecure;
};

export const shouldSkipEncrypted = (
  item: BulkDownloadItem,
  context: EncryptionContext,
): boolean =>
  hasEncryption(item) &&
  !context.defaultPassword &&
  context.encryptionChoice === 'skip';

export const resolveEncryptionOptions = (
  item: BulkDownloadItem,
  context: EncryptionContext,
): ResolvedEncryptionOptions => {
  if (!hasEncryption(item)) {
    return { password: undefined, skipDecryption: false };
  }

  if (context.defaultPassword) {
    return { password: context.defaultPassword, skipDecryption: false };
  }

  if (context.encryptionChoice === 'download-encrypted') {
    return { password: undefined, skipDecryption: true };
  }

  if (context.encryptionChoice === 'shared-password') {
    return { password: context.sharedPassword, skipDecryption: false };
  }

  return { password: undefined, skipDecryption: false };
};
