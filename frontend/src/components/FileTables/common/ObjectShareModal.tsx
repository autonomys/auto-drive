import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Fragment, useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { ObjectInformation } from '@auto-drive/models';
import { useNetwork } from 'contexts/network';
import { Button } from 'components/common/Button';
import { Download, Link } from 'lucide-react';
import { useGetMetadataByHeadCidQuery } from 'gql/graphql';
import { mapObjectInformationFromQueryResult } from 'services/gql/utils';
import { EXTERNAL_ROUTES, ROUTES } from 'constants/routes';

export const ObjectShareModal = ({
  cid,
  closeModal,
}: {
  cid: string | null;
  closeModal: () => void;
}) => {
  const network = useNetwork();
  const isOpen = cid !== null;
  const [metadata, setMetadata] = useState<ObjectInformation | null>(null);

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
    if (!cid) {
      return;
    }

    navigator.clipboard.writeText(EXTERNAL_ROUTES.gatewayObjectDownload(cid));
    toast.success('Link copied to clipboard');
  }, [cid]);

  const copyDetailsLink = useCallback(() => {
    if (!metadata?.metadata.dataCid) {
      return;
    }

    navigator.clipboard.writeText(
      `${window.location.origin}${ROUTES.objectDetails(
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
          <div className='fixed inset-0 bg-black/25 dark:bg-darkBlack/25' />
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
              <DialogPanel className='w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all dark:bg-darkWhite'>
                <DialogTitle
                  as='h3'
                  className='text-lg font-medium leading-6 text-gray-900 dark:text-darkBlack'
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
