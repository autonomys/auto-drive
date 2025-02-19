import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Fragment, useCallback, useState } from 'react';
import { UploadedObjectMetadata } from '../../models/UploadedObjectMetadata';
import toast from 'react-hot-toast';
import { Button } from '../common/Button';
import { useGetMetadataByHeadCidQuery } from '../../../gql/graphql';
import { mapObjectInformationFromQueryResult } from '../../services/gql/utils';
import { useNetwork } from '../../contexts/network';

export const ObjectDeleteModal = ({
  cid,
  closeModal,
}: {
  cid: string | null;
  closeModal: () => void;
}) => {
  const isOpen = cid !== null;
  const [metadata, setMetadata] = useState<UploadedObjectMetadata | null>(null);

  const network = useNetwork();

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

  const deleteObject = useCallback(() => {
    if (!metadata) {
      return;
    }

    network?.api
      .markObjectAsDeleted(metadata.metadata.dataCid)
      .then(() => {
        toast.success('Object deleted successfully');
        closeModal();
      })
      .catch(() => {
        toast.error('Failed to delete object');
      });
  }, [metadata, closeModal, network?.api]);

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
          <div className='fixed inset-0 bg-black dark:bg-darkBlack/25' />
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
                  className='text-lg font-medium leading-6 text-gray-900'
                >
                  Remove &quot;{metadata?.metadata.name}&quot;
                </DialogTitle>
                <div className='mt-2'>
                  <p className='text-sm text-gray-500'>
                    This action doesn&apos;t delete the object, it just removes
                    it from your this view and moves it to the Trash.
                  </p>
                </div>
                <div className='mt-4 flex justify-center'>
                  <Button variant='danger' onClick={deleteObject}>
                    Remove
                  </Button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
