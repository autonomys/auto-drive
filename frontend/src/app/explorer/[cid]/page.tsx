import { ApiService } from "../../../services/api";
import { decode } from "@ipld/dag-pb";
import { NodeExplorer } from "../../../components/NodeExplorer";
import * as base32 from 'multiformats/bases/base32'

export default async function ExplorerPage({ params: { cid } }: { params: { cid: string } }) {
    const { IPLDNodeData } = await import("@autonomys/auto-drive/protobuf");
    const data = await ApiService.fetchData(cid);
    const { Links, Data } = decode(Buffer.from(data.toString(), 'base64'))
    const metadata = Data && IPLDNodeData.decode(Data)

    return (
        <NodeExplorer cid={cid} data={{ Links: Links.map(link => link.Hash.toString(base32.base32)), Data: metadata }} />
    );
}