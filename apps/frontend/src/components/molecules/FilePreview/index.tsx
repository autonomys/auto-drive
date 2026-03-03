import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilePreview as AutoFilePreview } from '@autonomys/auto-design-system';
import {
  OffchainMetadata,
  canDisplayDirectly,
  needsContentParsing,
  processFileData,
  decryptFileData,
} from '@autonomys/auto-dag-data';
import { useNetwork } from '../../../contexts/network';
import { NetworkId as AutoUtilsNetworkId } from '@autonomys/auto-utils';
import {
  EXTERNAL_ROUTES,
  NetworkId as AutoDriveNetworkId,
} from '@auto-drive/ui';
import { sanitizeHTML } from '../../../utils/sanitizeHTML';

const MAX_PREVIEW_SIZE = BigInt(100 * 1024 * 1024); // 100 MB

export const FilePreview = ({ metadata }: { metadata: OffchainMetadata }) => {
  const { network } = useNetwork();
  const [isFilePreview, setIsFilePreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDecrypted, setIsDecrypted] = useState(false);
  const [decryptionError, setDecryptionError] = useState<string | null>(null);
  const [file, setFile] = useState<Blob | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const safeSetTextContent = useCallback((text: string) => {
    setTextContent(sanitizeHTML(text));
  }, []);

  const networkId = useMemo(() => {
    switch (network.id) {
      case AutoDriveNetworkId.LOCAL:
      case AutoDriveNetworkId.MAINNET:
        return AutoUtilsNetworkId.MAINNET;
      default:
        return AutoUtilsNetworkId.MAINNET;
    }
  }, [network]);

  const gatewayUrl = EXTERNAL_ROUTES.gatewayObjectDownload(metadata.dataCid);

  const isPreviewable = useMemo(() => {
    if (metadata.type !== 'file') return false;
    if (metadata.totalSize > MAX_PREVIEW_SIZE) return false;
    return canDisplayDirectly(metadata) || needsContentParsing(metadata) || !!metadata.uploadOptions?.encryption;
  }, [metadata]);

  const fetchFile = useCallback(
    async (password?: string) => {
      // Reset error states on every attempt
      setError(null);
      setDecryptionError(null);

      if (!isPreviewable) {
        setIsFilePreview(false);
        setLoading(false);
        return;
      }

      // If file is encrypted and no password provided, don't fetch
      if (metadata.uploadOptions?.encryption && !password && !isDecrypted) {
        setIsFilePreview(false);
        setLoading(false);
        return;
      }

      // For non-encrypted files that can be displayed directly,
      // use gateway URL directly (no fetch needed)
      if (!metadata.uploadOptions?.encryption && canDisplayDirectly(metadata)) {
        setIsFilePreview(true);
        setFile(null);
        setLoading(false);
        return;
      }

      // Cancel any in-flight request
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsFilePreview(true);
      setLoading(true);

      try {
        const response = await fetch(gatewayUrl, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            `Failed to fetch file: ${response.status} ${response.statusText}`,
          );
        }
        const blob = await response.blob();
        setFile(blob);
        // For text-based files, also read the content
        if (needsContentParsing(metadata)) {
          const text = await blob.text();
          safeSetTextContent(text);
        }
        // Handle decryption if needed
        if (metadata.uploadOptions?.encryption && password) {
          try {
            const encryptedFileData = {
              dataArrayBuffer: await blob.arrayBuffer(),
              name: metadata.name ?? '',
              rawData: '',
              uploadOptions: metadata.uploadOptions,
              isEncrypted: true,
            };
            const decryptedFileData = await decryptFileData(
              password,
              encryptedFileData,
            );
            const decryptedBlob = await processFileData(decryptedFileData);
            setFile(decryptedBlob);
            setIsDecrypted(true);
            setLoading(false);
            return;
          } catch {
            setDecryptionError('Invalid password or decryption failed');
            setLoading(false);
            return;
          }
        }
        setLoading(false);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        console.error('Error fetching file:', error);
        setError(
          error instanceof Error ? error.message : 'Failed to fetch file',
        );
        setLoading(false);
      }
    },
    [metadata, isDecrypted, isPreviewable, gatewayUrl, safeSetTextContent],
  );

  useEffect(() => {
    fetchFile();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [fetchFile]);

  return (
    <AutoFilePreview
      metadata={metadata}
      network={networkId}
      loading={loading}
      file={file}
      error={error}
      decryptionError={decryptionError}
      isFilePreview={isFilePreview}
      textContent={textContent}
      gatewayUrl={gatewayUrl}
      handleDecrypt={fetchFile}
    />
  );
};
