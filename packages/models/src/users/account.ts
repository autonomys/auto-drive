import { User } from "./user.js";
import { OrganizationWithMembers } from "./organization.js";

export type Account = {
  id: string;
  organizationId: string;
  uploadLimit: number;
  downloadLimit: number;
  model: AccountModel;
  // A partner account is shared by the members of a partner organisation.
  isPartner: boolean;
  // Overrides of the global credit terms. Null means use the global default.
  maxPurchasedBytes: number | null;
  creditExpiryDays: number | null;
  // Free upload bytes issued to a partner account each UTC month. 0 = none.
  monthlyFreeUploadBytes: number;
  // The most any one of a partner's end users may upload in total, set by its
  // organisation admins. 0 until they set it, so end users can't upload.
  maxEndUserQuotaBytes: number;
  // The most the account may upload in a rolling 24 hours, set by a partner's
  // organisation admins. Null until they set it: its end users can't upload
  // until then, and everyone else uploads as before.
  dailyUploadLimitBytes: number | null;
  // The admins switched the daily upload limit off, which they acknowledged.
  dailyUploadLimitOff: boolean;
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
  // Free credit bytes left: the part of pendingUploadCredits that is free.
  freeUploadCredits: number;
};

/** Admin account page: an account and its members, which may be none. */
export type AdminAccountDetails = AccountInfo & {
  members: User[];
  // Null if the auth service has no such organization.
  organization: OrganizationWithMembers | null;
  // What a null override means.
  defaultCreditTerms: {
    maxPurchasedBytes: number;
    creditExpiryDays: number;
  };
};

/** One change to one account term, for the admin history. */
export type AccountTermsChange = {
  id: string;
  accountId: string;
  // E.g. max_purchased_bytes, credit_expiry_days, upload_limit, is_partner.
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  reason: string | null;
  createdAt: string;
};
