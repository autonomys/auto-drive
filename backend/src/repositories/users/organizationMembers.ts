import { getDatabase } from "../../drivers/pg.js";

type DBOrganizationMember = {
  oauth_provider: string;
  oauth_user_id: string;
  organization_id: string;
};

const getOrganizationMemberships = async (
  organizationId: string
): Promise<DBOrganizationMember[]> => {
  const db = await getDatabase();
  return db
    .query<DBOrganizationMember>(
      `SELECT * FROM users_organizations WHERE organization_id = $1`,
      [organizationId]
    )
    .then((result) => result.rows);
};

const getOrganizationMembershipsByUser = async (
  oauthProvider: string,
  oauthUserId: string
): Promise<DBOrganizationMember[]> => {
  const db = await getDatabase();
  return db
    .query<DBOrganizationMember>(
      `SELECT * FROM users_organizations WHERE oauth_provider = $1 AND oauth_user_id = $2`,
      [oauthProvider, oauthUserId]
    )
    .then((result) => result.rows);
};

const addMemberToOrganization = async (
  organizationId: string,
  oauthProvider: string,
  oauthUserId: string
): Promise<DBOrganizationMember> => {
  const db = await getDatabase();
  return db
    .query<DBOrganizationMember>(
      `INSERT INTO users_organizations (oauth_provider, oauth_user_id, organization_id) VALUES ($1, $2, $3)`,
      [oauthProvider, oauthUserId, organizationId]
    )
    .then((result) => result.rows[0]);
};

const isMemberOfOrganization = async (
  organizationId: string,
  oauthProvider: string,
  oauthUserId: string
): Promise<boolean> => {
  const db = await getDatabase();

  const result = await db.query<DBOrganizationMember>(
    `SELECT * FROM users_organizations WHERE organization_id = $1 AND oauth_provider = $2 AND oauth_user_id = $3`,
    [organizationId, oauthProvider, oauthUserId]
  );

  return result.rows.length > 0;
};

export const organizationMembersRepository = {
  getOrganizationMemberships,
  getOrganizationMembershipsByUser,
  addMemberToOrganization,
  isMemberOfOrganization,
};
