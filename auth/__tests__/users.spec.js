"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const users_1 = require("../src/useCases/users");
const models_1 = require("../src/models");
const organizations_1 = require("../src/useCases/organizations");
const pg_1 = require("../src/drivers/pg");
const dbMigrate_1 = require("./utils/dbMigrate");
const mocks_1 = require("./utils/mocks");
describe("UsersUseCases", () => {
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, pg_1.getDatabase)();
        yield dbMigrate_1.dbMigration.up();
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, pg_1.closeDatabase)();
        yield dbMigrate_1.dbMigration.down();
    }));
    it("should return unonboarded user info", () => __awaiter(void 0, void 0, void 0, function* () {
        const nonOnboardedUser = {
            oauthProvider: "google",
            oauthUserId: "non-onboarded-user",
            role: models_1.UserRole.User,
            publicId: null,
            onboarded: false,
        };
        yield expect(users_1.UsersUseCases.getUserWithOrganization(nonOnboardedUser)).resolves.toMatchObject(nonOnboardedUser);
    }));
    it("should get user info for an onboarded user", () => __awaiter(void 0, void 0, void 0, function* () {
        const user = (0, mocks_1.createUnonboardedUser)();
        const onboardedUser = yield users_1.UsersUseCases.onboardUser(user);
        if (!onboardedUser) {
            expect(onboardedUser).toBeTruthy();
            return;
        }
        const userInfo = yield users_1.UsersUseCases.getUserWithOrganization(onboardedUser);
        expect(userInfo).toMatchObject({
            onboarded: true,
            oauthProvider: user.oauthProvider,
            oauthUserId: user.oauthUserId,
            role: models_1.UserRole.User,
            organizationId: expect.any(String),
        });
    }));
    it("should onboard a user", () => __awaiter(void 0, void 0, void 0, function* () {
        const user = yield users_1.UsersUseCases.onboardUser(mocks_1.MOCK_UNONBOARDED_USER);
        if (!user) {
            expect(user).toBeTruthy();
            return;
        }
        expect(user.onboarded).toBe(true);
        expect(user.publicId).not.toBeNull();
        expect(user.role).toBe(models_1.UserRole.User);
        expect(user.oauthProvider).toBe(mocks_1.MOCK_UNONBOARDED_USER.oauthProvider);
        expect(user.oauthUserId).toBe(mocks_1.MOCK_UNONBOARDED_USER.oauthUserId);
        const userByPublicId = yield users_1.UsersUseCases.getUserByPublicId(user.publicId);
        expect(userByPublicId).toEqual(user);
    }));
    it("user should have an organization linked to a subscription", () => __awaiter(void 0, void 0, void 0, function* () {
        const user = yield users_1.UsersUseCases.getUserByOAuthUser({
            provider: mocks_1.MOCK_UNONBOARDED_USER.oauthProvider,
            id: mocks_1.MOCK_UNONBOARDED_USER.oauthUserId,
        });
        const promise = organizations_1.OrganizationsUseCases.getOrganizationByUser(user);
        yield expect(promise).resolves.toBeTruthy();
        const organization = yield promise;
        expect(organization).toEqual({
            id: expect.any(String),
            name: expect.any(String),
        });
    }));
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
