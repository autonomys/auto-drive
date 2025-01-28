import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { UploadedObjectMetadata } from '../../models/UploadedObjectMetadata';
import { useNetwork } from '../../contexts/network';
import { Button } from '../common/Button';
import { Link } from 'lucide-react';
import { isValidUUID } from '../../utils/misc';
import { useGetMetadataByHeadCidQuery } from '../../../gql/graphql';
import { mapObjectInformationFromQueryResult } from '../../services/gql/utils';
import { getObjectDetailsPath } from '../../views/ObjectDetails';

export const ObjectShareModal = ({
  cid,
  closeModal,
}: {
  cid: string | null;
  closeModal: () => void;
}) => {
  const network = useNetwork();
  const isOpen = cid !== null;
  const [publicId, setPublicId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<UploadedObjectMetadata | null>(null);

  useGetMetadataByHeadCidQuery({
    variables: {
      headCid: cid ?? '',
    },
    skip: !cid,
    onCompleted: (data) => {
      setMetadata(mapObjectInformationFromQueryResult(data));
    },
    onError: (error) => {
      console.error('error', error);
    },
  });

  const shareObject = useCallback(async () => {
    if (!publicId) {
      return;
    }

    if (!metadata?.metadata.dataCid) {
      return;
    }

    await network.api
      .shareObject(metadata?.metadata.dataCid, publicId)
      .then(async () => {
        toast.success('Object shared successfully');
        await new Promise((resolve) => setTimeout(resolve, 100));
        closeModal();
        window.location.reload();
      })
      .catch(() => {
        toast.error('Failed to share object');
      });
  }, [publicId, metadata?.metadata.dataCid, network.api, closeModal]);

  useEffect(() => {
    setPublicId(null);
  }, [metadata]);

  const copyLink = useCallback(() => {
    if (!metadata?.metadata.dataCid) {
      return;
    }

    navigator.clipboard.writeText(
      `${window.location.origin}/${getObjectDetailsPath(
        network.network.id,
        metadata?.metadata.dataCid,
      )}`,
    );
    toast.success('Link copied to clipboard');
  }, [metadata?.metadata.dataCid, network.network]);

  const invalidPublicId = useMemo(() => {
    return !isValidUUID(publicId);
  }, [publicId]);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as='div' className='relative z-10' onClose={closeModal}>
        <TransitionChild
          as={Fragment}
          enter='ease-out duration-300'
          enterFrom='opacity-0'
          enterTo='opacity-100'
          leave='ease-in duration-200'
          leaveFrom='opacity-100'
          leaveTo='opacity-0'
        >
          <div className='fixed inset-0 bg-black/25' />
        </TransitionChild>

        <div className='fixed inset-0 overflow-y-auto'>
          <div className='flex min-h-full items-center justify-center p-4 text-center'>
            <TransitionChild
              as={Fragment}
              enter='ease-out duration-300'
              enterFrom='opacity-0 scale-95'
              enterTo='opacity-100 scale-100'
              leave='ease-in duration-200'
              leaveFrom='opacity-100 scale-100'
              leaveTo='opacity-0 scale-95'
            >
              <DialogPanel className='w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all'>
                <DialogTitle
                  as='h3'
                  className='text-lg font-medium leading-6 text-gray-900'
                >
                  Share &quot;{metadata?.metadata.name}&quot;
                </DialogTitle>
                <div className='mt-2'>
                  <p className='text-sm text-gray-500'>
                    Enter the public ID of the user you want to share with.
                  </p>
                </div>
                <input
                  className='w-full rounded-md border border-gray-300 p-2'
                  value={publicId ?? ''}
                  onChange={(e) => setPublicId(e.target.value)}
                />
                <div className='mt-4 flex justify-center gap-2'>
                  <Button
                    variant='lightAccent'
                    className='flex items-center gap-2'
                    onClick={copyLink}
                  >
                    <Link className='h-4 w-4' />
                    Share link
                  </Button>
                  <Button
                    variant='lightAccent'
                    disabled={invalidPublicId}
                    onClick={shareObject}
                  >
                    Share with public ID
                  </Button>
                </div>
                {publicId && invalidPublicId && (
                  <p className='mt-4 text-center text-sm text-red-500'>
                    Invalid public ID.
                  </p>
                )}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
