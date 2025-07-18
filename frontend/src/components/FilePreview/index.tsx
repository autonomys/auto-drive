import { useCallback, useEffect, useMemo, useState } from 'react';
import { FilePreview as AutoFilePreview } from '@autonomys/auto-design-system';
import {
  OffchainMetadata,
  canDisplayDirectly,
  needsContentParsing,
  processFileData,
  decryptFileData,
} from '@autonomys/auto-dag-data';
import { useNetwork } from '../../contexts/network';
import { NetworkId as AutoDriveNetworkId } from '../../constants/networks';
import { NetworkId as AutoUtilsNetworkId } from '@autonomys/auto-utils';
import { EXTERNAL_ROUTES } from '../../constants/routes';
import { sanitizeHTML } from '../../utils/sanitizeHTML';

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
      case AutoDriveNetworkId.TAURUS:
        return AutoUtilsNetworkId.TAURUS;
      default:
        return AutoUtilsNetworkId.MAINNET;
    }
  }, [network]);

  const gatewayUrl = EXTERNAL_ROUTES.gatewayObjectDownload(metadata.dataCid);

  const fetchFile = useCallback(
    async (password?: string) => {
      // If file is encrypted and no password provided, don't fetch
      if (metadata.uploadOptions?.encryption && !password && !isDecrypted) {
        setIsFilePreview(false);
        setLoading(false);
        return;
      }

      // For non-encrypted files that can be displayed directly,
      if (!metadata.uploadOptions?.encryption && canDisplayDirectly(metadata)) {
        setIsFilePreview(true);
        setFile(null);
        setLoading(false);
        return;
      }

      // Encrypted files always need to be fetched and decrypted
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
    [metadata, isDecrypted, gatewayUrl, safeSetTextContent],
  );

  useEffect(() => {
    fetchFile();
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
