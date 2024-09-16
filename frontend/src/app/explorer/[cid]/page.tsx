import { ApiService } from "../../../services/api";
import { NodeExplorer } from "../../../components/NodeExplorer";

export default async function ExplorerPage({ params: { cid } }: { params: { cid: string } }) {
    const data = await ApiService.fetchData(cid);

    return (
        <NodeExplorer cid={cid} links={data.links} metadata={data.metadata} />
    );
}