import { User } from "./user";
import { OrganizationWithMembers } from "./organization";

export type Account = {
  id: string;
  organizationId: string;
  uploadLimit: number;
  downloadLimit: number;
  model: AccountModel;
  // A partner account is shared by the members of a partner organisation.
  isPartner: boolean;
};

export type AccountWithTotalSize = Account & {
  totalSize: number;
};

export enum AccountModel {
  Monthly = "monthly",
  OneOff = "one_off",
}

export type AccountInfoWithUser = AccountInfo & {
  user: User;
};

export type AccountInfo = Account & {
  pendingUploadCredits: number;
  pendingDownloadCredits: number;
};

/** Admin account page: an account and its members, which may be none. */
export type AdminAccountDetails = AccountInfo & {
  members: User[];
  // Null if the auth service has no such organization.
  organization: OrganizationWithMembers | null;
};
