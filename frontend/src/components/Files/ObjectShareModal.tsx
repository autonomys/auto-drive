import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Fragment, useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { UploadedObjectMetadata } from '../../models/UploadedObjectMetadata';
import { useNetwork } from '../../contexts/network';
import { Button } from '../common/Button';
import { Download, Link } from 'lucide-react';
import { useGetMetadataByHeadCidQuery } from '../../../gql/graphql';
import { mapObjectInformationFromQueryResult } from '../../services/gql/utils';
import { ROUTES } from '../../constants/routes';
import { networks } from '../../constants/networks';

export const ObjectShareModal = ({
  cid,
  closeModal,
}: {
  cid: string | null;
  closeModal: () => void;
}) => {
  const network = useNetwork();
  const isOpen = cid !== null;
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

  const copyDownloadLink = useCallback(async () => {
    if (!metadata?.metadata.dataCid) {
      toast.error('Some error occurred');
      return;
    }
    const apiUrl = networks[network.network.id]?.http;
    if (!apiUrl) {
      toast.error('Some error occurred');
      return;
    }

    const toastId = toast.loading('Copying link to clipboard...');
    let link = metadata.publishedObjectId
      ? `${apiUrl}/objects/${metadata.publishedObjectId}/public`
      : null;
    if (!link) {
      link = await network.api.publishObject(metadata.metadata.dataCid);
    }

    navigator.clipboard.writeText(link);

    toast.success('Link copied to clipboard', {
      id: toastId,
    });
  }, [
    metadata?.metadata.dataCid,
    metadata?.publishedObjectId,
    network.api,
    network.network.id,
  ]);

  const copyDetailsLink = useCallback(() => {
    if (!metadata?.metadata.dataCid) {
      return;
    }

    navigator.clipboard.writeText(
      `${window.location.origin}/${ROUTES.objectDetails(
        network.network.id,
        metadata?.metadata.dataCid,
      )}`,
    );
    toast.success('Link copied to clipboard');
  }, [metadata?.metadata.dataCid, network.network]);

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
          <div className='dark:bg-darkBlack/25 fixed inset-0 bg-black/25' />
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
              <DialogPanel className='dark:bg-darkWhite w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all'>
                <DialogTitle
                  as='h3'
                  className='dark:text-darkBlack text-lg font-medium leading-6 text-gray-900'
                >
                  Share &quot;{metadata?.metadata.name}&quot;
                </DialogTitle>
                <div className='mt-4 flex flex-col gap-2'>
                  <p className='text-grey-100 rounded-md bg-amber-100 p-2 text-sm font-medium'>
                    Be careful, downloads from this link would be deducted from
                    your download credits.
                  </p>
                  <div className='mt-4 flex justify-center gap-2'>
                    <Button
                      variant='lightAccent'
                      className='flex items-center gap-2'
                      onClick={copyDownloadLink}
                    >
                      <Download className='h-4 w-4' />
                      Copy download link
                    </Button>
                    <Button
                      variant='lightAccent'
                      className='flex items-center gap-2'
                      onClick={copyDetailsLink}
                    >
                      <Link className='h-4 w-4' />
                      Copy details link
                    </Button>
                  </div>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
