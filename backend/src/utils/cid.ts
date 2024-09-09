import { CID } from "multiformats/cid";
import { base32 } from "multiformats/bases/base32";

export const cidToString = (cid: CID): string => cid.toString(base32);

export const stringToCid = (str: string): CID => CID.parse(str, base32);
