import FileCard from '../../../components/common/FileCard';
import { ApiService } from '../../../services/api';

export default async function Page({ params }: { params: { cid: string } }) {
    const { cid } = params;

    const metadata = await ApiService.fetchMetadata(cid);

    if (metadata.type === 'file') {
        throw new Error('File type not supported');
    }

    const childrenMetadata = await Promise.all(metadata.children.map(e => ApiService.fetchMetadata(e.cid)));

    return (
        <div className='grid grid-cols-4 gap-4'>
            {
                childrenMetadata.map((metadata) => {
                    return <FileCard key={metadata.dataCid} name={metadata.name ?? ""} type={metadata.type} size={metadata.totalSize} />
                })
            }
        </div>
    );
}