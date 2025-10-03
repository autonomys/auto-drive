import { User } from "./user";

export type Account = {
  id: string;
  organizationId: string;
  uploadLimit: number;
  downloadLimit: number;
  model: AccountModel;
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
