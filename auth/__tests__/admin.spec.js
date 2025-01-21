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
const uuid_1 = require("uuid");
const models_1 = require("../src/models");
const repositories_1 = require("../src/repositories");
const useCases_1 = require("../src/useCases");
const dbMigrate_1 = require("./utils/dbMigrate");
const mocks_1 = require("./utils/mocks");
describe("Admin management", () => {
    let admin;
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield dbMigrate_1.dbMigration.up();
        admin = (0, mocks_1.createMockAdmin)();
        yield useCases_1.UsersUseCases.initUser(admin.oauthProvider, admin.oauthUserId, (0, uuid_1.v4)(), models_1.UserRole.Admin);
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield dbMigrate_1.dbMigration.down();
    }));
    it("should fail role update for non-admin users", () => __awaiter(void 0, void 0, void 0, function* () {
        const user = (0, mocks_1.createMockUser)();
        const plainUser = yield useCases_1.UsersUseCases.initUser(user.oauthProvider, user.oauthUserId, (0, uuid_1.v4)(), user.role);
        yield expect(useCases_1.UsersUseCases.updateRole(plainUser, plainUser, models_1.UserRole.Admin)).rejects.toThrow("User does not have admin privileges");
    }));
    it("should successfully update role for admin users", () => __awaiter(void 0, void 0, void 0, function* () {
        const user = (0, mocks_1.createMockAdmin)();
        yield repositories_1.usersRepository.createUser(user.oauthProvider, user.oauthUserId, (0, uuid_1.v4)(), user.role);
        yield useCases_1.UsersUseCases.updateRole(admin, user, models_1.UserRole.User);
        const updatedUser = yield repositories_1.usersRepository.getUserByOAuthInformation(user.oauthProvider, user.oauthUserId);
        expect(updatedUser === null || updatedUser === void 0 ? void 0 : updatedUser.role).toBe(models_1.UserRole.User);
    }));
    it("should throw an error when trying to update role to an invalid role", () => __awaiter(void 0, void 0, void 0, function* () {
        const user = (0, mocks_1.createMockUser)();
        yield expect(useCases_1.UsersUseCases.updateRole(admin, user, "INVALID_ROLE")).rejects.toThrow("Invalid role");
    }));
});
