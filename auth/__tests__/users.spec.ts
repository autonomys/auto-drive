import { UsersUseCases } from "../src/useCases/users";
import { UnonboardedUser, UserRole } from "../src/models";
import { OrganizationsUseCases } from "../src/useCases/organizations";
import { closeDatabase, getDatabase } from "../src/drivers/pg";
import { dbMigration } from "./utils/dbMigrate";
import {
  createMockUser,
  createUnonboardedUser,
  MOCK_UNONBOARDED_USER,
} from "./utils/mocks";

describe("UsersUseCases", () => {
  beforeAll(async () => {
    await getDatabase();
    await dbMigration.up();
  });

  afterAll(async () => {
    await closeDatabase();
    await dbMigration.down();
  });

  it("should return unonboarded user info", async () => {
    const nonOnboardedUser: UnonboardedUser = {
      oauthProvider: "google",
      oauthUserId: "non-onboarded-user",
      role: UserRole.User,
      publicId: null,
      onboarded: false,
    };

    await expect(
      UsersUseCases.getUserWithOrganization(nonOnboardedUser)
    ).resolves.toMatchObject(nonOnboardedUser);
  });

  it("should get user info for an onboarded user", async () => {
    const user = createUnonboardedUser();

    const onboardedUser = await UsersUseCases.onboardUser(user);
    if (!onboardedUser) {
      expect(onboardedUser).toBeTruthy();
      return;
    }

    const userInfo = await UsersUseCases.getUserWithOrganization(onboardedUser);

    expect(userInfo).toMatchObject({
      onboarded: true,
      oauthProvider: user.oauthProvider,
      oauthUserId: user.oauthUserId,
      role: UserRole.User,
      organizationId: expect.any(String),
    });
  });

  it("should onboard a user", async () => {
    const user = await UsersUseCases.onboardUser(MOCK_UNONBOARDED_USER);

    if (!user) {
      expect(user).toBeTruthy();
      return;
    }

    expect(user.onboarded).toBe(true);
    expect(user.publicId).not.toBeNull();
    expect(user.role).toBe(UserRole.User);
    expect(user.oauthProvider).toBe(MOCK_UNONBOARDED_USER.oauthProvider);
    expect(user.oauthUserId).toBe(MOCK_UNONBOARDED_USER.oauthUserId);

    const userByPublicId = await UsersUseCases.getUserByPublicId(
      user.publicId!
    );

    expect(userByPublicId).toEqual(user);
  });

  it("user should have an organization linked to a subscription", async () => {
    const user = await UsersUseCases.getUserByOAuthUser({
      provider: MOCK_UNONBOARDED_USER.oauthProvider,
      id: MOCK_UNONBOARDED_USER.oauthUserId,
    });

    const promise = OrganizationsUseCases.getOrganizationByUser(user);
    await expect(promise).resolves.toBeTruthy();

    const organization = await promise;
    expect(organization).toEqual({
      id: expect.any(String),
      name: expect.any(String),
    });
  });

  // it("should be able to get user list", async () => {
  //   const user = await createMockUser();
  //   await usersRepository.updateRole(
  //     user.oauthProvider,
  //     user.oauthUserId,
  //     UserRole.Admin
  //   );

  //   const users = await UsersUseCases.getUserList(user);
  //   expect(users).toBeInstanceOf(Array);
  // });
});
