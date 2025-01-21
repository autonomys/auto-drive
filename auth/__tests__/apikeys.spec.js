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
const useCases_1 = require("../src/useCases");
const error_1 = require("./utils/error");
const pg_1 = require("../src/drivers/pg");
const repositories_1 = require("../src/repositories");
const apikey_1 = require("../src/services/authManager/providers/apikey");
const dbMigrate_1 = require("./utils/dbMigrate");
const mocks_1 = require("./utils/mocks");
describe("ApiKeyUseCases", () => {
    let user;
    let apiKey;
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, pg_1.getDatabase)();
        yield dbMigrate_1.dbMigration.up();
        const result = yield useCases_1.UsersUseCases.onboardUser(mocks_1.MOCK_UNONBOARDED_USER);
        if (!result) {
            throw new error_1.PreconditionError("User not initialized");
        }
        user = result;
    }));
    it("should create an api key", () => __awaiter(void 0, void 0, void 0, function* () {
        apiKey = yield useCases_1.ApiKeysUseCases.createApiKey(user);
        expect(apiKey).toMatchObject({
            id: expect.any(String),
            secret: expect.any(String),
            oauthProvider: user.oauthProvider,
            oauthUserId: user.oauthUserId,
        });
    }));
    it("should be able to be authenticated", () => __awaiter(void 0, void 0, void 0, function* () {
        const authenticatedUser = yield apikey_1.ApiKeyAuth.getUserFromApiKey(apiKey.secret);
        expect(authenticatedUser).toMatchObject({
            provider: user.oauthProvider,
            id: user.oauthUserId,
        });
    }));
    it("should be able to mark as deleted an api key", () => __awaiter(void 0, void 0, void 0, function* () {
        yield useCases_1.ApiKeysUseCases.deleteApiKey(user, apiKey.id);
        const deletedApiKey = yield repositories_1.apiKeysRepository.getApiKeyBySecret(apiKey.secret);
        expect(deletedApiKey === null || deletedApiKey === void 0 ? void 0 : deletedApiKey.deletedAt).not.toBeNull();
    }));
    it("should not be able to authenticate with a deleted api key", () => __awaiter(void 0, void 0, void 0, function* () {
        yield expect(apikey_1.ApiKeyAuth.getUserFromApiKey(apiKey.secret)).rejects.toThrow("Api key has been deleted");
    }));
    it("should not be able to authenticate with a non existent api key", () => __awaiter(void 0, void 0, void 0, function* () {
        yield expect(apikey_1.ApiKeyAuth.getUserFromApiKey("non-existent-api-key")).rejects.toThrow("Api key not found");
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, pg_1.closeDatabase)();
        yield dbMigrate_1.dbMigration.down();
    }));
});
