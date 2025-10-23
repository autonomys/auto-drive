import { PublicId } from "./user";

export type Organization = {
  id: string;
  name: string;
};

export type OrganizationWithMembers = Organization & {
  members: PublicId[];
};
