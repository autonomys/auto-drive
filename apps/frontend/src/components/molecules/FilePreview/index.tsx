import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { ExternalLink } from 'lucide-react';

const VIDEO_MIME_PREFIXES = ['video/'];
const AUDIO_MIME_PREFIXES = ['audio/'];

// Media files need blob URLs to avoid ORB (Opaque Response Blocking) in browsers
const needsBlobUrl = (metadata: OffchainMetadata): boolean => {
  if (metadata.type !== 'file') return false;
  const mime = metadata.mimeType?.toLowerCase() ?? '';
  return (
    VIDEO_MIME_PREFIXES.some((p) => mime.startsWith(p)) ||
    AUDIO_MIME_PREFIXES.some((p) => mime.startsWith(p))
  );
};

export const FilePreview = ({ metadata }: { metadata: OffchainMetadata }) => {
  const { network } = useNetwork();
  const [isFilePreview, setIsFilePreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDecrypted, setIsDecrypted] = useState(false);
  const [decryptionError, setDecryptionError] = useState<string | null>(null);
  const [file, setFile] = useState<Blob | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);

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

  // For video/audio, we must fetch as blob to avoid ORB blocking
  const forceBlob = useMemo(() => needsBlobUrl(metadata), [metadata]);

  const fetchFile = useCallback(
    async (password?: string) => {
      // If file is encrypted and no password provided, don't fetch
      if (metadata.uploadOptions?.encryption && !password && !isDecrypted) {
        setIsFilePreview(false);
        setLoading(false);
        return;
      }

      // For non-encrypted files that can be displayed directly (and don't need blob URLs)
      if (
        !metadata.uploadOptions?.encryption &&
        canDisplayDirectly(metadata) &&
        !forceBlob
      ) {
        setIsFilePreview(true);
        setFile(null);
        setLoading(false);
        return;
      }

      // Files that require fetching (encrypted or media that needs blob URL)
      setIsFilePreview(true);
      setLoading(true);

      try {
        const response = await fetch(gatewayUrl);
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
          }
        }
        setLoading(false);
      } catch (error) {
        console.error('Error fetching file:', error);
        setError(
          error instanceof Error ? error.message : 'Failed to fetch file',
        );
        setLoading(false);
      }
    },
    [metadata, isDecrypted, gatewayUrl, safeSetTextContent, forceBlob],
  );

  useEffect(() => {
    fetchFile();
  }, [fetchFile]);

  return (
    <>
      <AutoFilePreview
        metadata={metadata}
        network={networkId}
        loading={loading}
        file={file}
        error={error}
        decryptionError={decryptionError}
        isFilePreview={isFilePreview}
        textContent={textContent}
        gatewayUrl={forceBlob ? null : gatewayUrl}
        handleDecrypt={fetchFile}
      />
      {forceBlob && !metadata.uploadOptions?.encryption && (
        <div className='mt-2 flex justify-end text-sm'>
          <a
            href={gatewayUrl}
            target='_blank'
            rel='noreferrer'
            className='dark:text-darkAccent flex items-center text-auto-drive-accent hover:underline'
          >
            <ExternalLink className='mr-1 h-4 w-4' />
            View on gateway
          </a>
        </div>
      )}
    </>
  );
};
