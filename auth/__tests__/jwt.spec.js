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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const custom_1 = require("../src/services/authManager/providers/custom");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const authManager_1 = require("../src/services/authManager");
const pg_1 = require("../src/drivers/pg");
const dbMigrate_1 = require("./utils/dbMigrate");
const mocks_1 = require("./utils/mocks");
describe("JWT", () => {
    let user;
    let refreshTokenId;
    let accessTokenString;
    let refreshTokenString;
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, pg_1.getDatabase)();
        yield dbMigrate_1.dbMigration.up();
        user = yield (0, mocks_1.createMockUser)();
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, pg_1.closeDatabase)();
        yield dbMigrate_1.dbMigration.down();
    }));
    it("should generate a JWT token", () => __awaiter(void 0, void 0, void 0, function* () {
        const token = yield custom_1.CustomJWTAuth.createSessionTokens({
            id: user.oauthUserId,
            provider: user.oauthProvider,
        });
        const refreshTokenDecoded = jsonwebtoken_1.default.decode(token.refreshToken);
        if (typeof refreshTokenDecoded === "string" || !refreshTokenDecoded) {
            throw new Error("Invalid refresh token");
        }
        const refreshTokenPayload = refreshTokenDecoded;
        expect(refreshTokenPayload.oauthUserId).toBe(user.oauthUserId);
        expect(refreshTokenPayload.isRefreshToken).toBe(true);
        expect(refreshTokenPayload.id).toBeDefined();
        refreshTokenId = refreshTokenPayload.id;
        const decoded = jsonwebtoken_1.default.decode(token.accessToken);
        expect(decoded).toBeDefined();
        if (typeof decoded === "string" || !decoded) {
            throw new Error("Invalid access token");
        }
        const accessTokenPayload = decoded;
        expect(accessTokenPayload.oauthProvider).toBe(user.oauthProvider);
        expect(accessTokenPayload.oauthUserId).toBe(user.oauthUserId);
        expect(accessTokenPayload.isRefreshToken).toBe(false);
        expect(accessTokenPayload.refreshTokenId).toBe(refreshTokenId);
        accessTokenString = token.accessToken;
        refreshTokenString = token.refreshToken;
    }));
    it("should be able to authenticate with the access token", () => __awaiter(void 0, void 0, void 0, function* () {
        const user = yield authManager_1.AuthManager.getUserFromAccessToken("custom-jwt", accessTokenString);
        expect(user).toBeDefined();
        expect(user === null || user === void 0 ? void 0 : user.id).toBe(user.id);
        expect(user === null || user === void 0 ? void 0 : user.provider).toBe(user.provider);
    }));
    it("should be able to refresh with the refresh token", () => __awaiter(void 0, void 0, void 0, function* () {
        const newAccessToken = yield custom_1.CustomJWTAuth.refreshAccessToken(refreshTokenString);
        if (!newAccessToken) {
            expect(newAccessToken).not.toBeNull();
            return;
        }
        const decoded = jsonwebtoken_1.default.decode(newAccessToken);
        expect(decoded).toBeDefined();
        if (typeof decoded === "string" || !decoded) {
            throw new Error("Invalid access token");
        }
        const accessTokenPayload = decoded;
        expect(accessTokenPayload.refreshTokenId).toBe(refreshTokenId);
        expect(accessTokenPayload.isRefreshToken).toBe(false);
        expect(accessTokenPayload.oauthUserId).toBe(user.oauthUserId);
        expect(accessTokenPayload.oauthProvider).toBe(user.oauthProvider);
        accessTokenString = newAccessToken;
    }));
    it("should not be able to refresh with the access token", () => __awaiter(void 0, void 0, void 0, function* () {
        expect(custom_1.CustomJWTAuth.refreshAccessToken(accessTokenString)).rejects.toThrow("Invalid refresh token");
    }));
    it("should be able to invalidate the refresh token", () => __awaiter(void 0, void 0, void 0, function* () {
        expect(() => custom_1.CustomJWTAuth.invalidateRefreshToken(refreshTokenString)).not.toThrow();
    }));
    it("should not be able to generate an access token after invalidating the refresh token", () => __awaiter(void 0, void 0, void 0, function* () {
        yield custom_1.CustomJWTAuth.invalidateRefreshToken(refreshTokenString);
        yield expect(custom_1.CustomJWTAuth.refreshAccessToken(refreshTokenString)).rejects.toThrow("Invalid refresh token");
    }));
    it("should not be able to authenticate with the access token after invalidating the refresh token", () => __awaiter(void 0, void 0, void 0, function* () {
        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is not set");
        }
        yield custom_1.CustomJWTAuth.invalidateRefreshToken(refreshTokenString);
        yield expect(authManager_1.AuthManager.getUserFromAccessToken("custom-jwt", accessTokenString)).rejects.toThrow("Invalid access token");
    }));
});
