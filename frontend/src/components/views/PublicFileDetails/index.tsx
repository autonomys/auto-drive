import { ObjectDetails } from '@/components/organisms/ObjectDetails';
import { ObjectInformation } from '@auto-drive/models';

export const PublicFileDetails = ({
  objectInformation,
}: {
  objectInformation: ObjectInformation;
}) => {
  return (
    <div className='px-20 py-10'>
      <ObjectDetails object={objectInformation} />
    </div>
  );
};
