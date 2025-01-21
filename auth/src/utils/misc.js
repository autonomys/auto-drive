"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = exports.stringify = void 0;
const stringify = (value) => {
    return JSON.stringify(value, (key, value) => typeof value === "bigint" ? value.toString() : value);
};
exports.stringify = stringify;
const env = (key, defaultValue) => {
    const value = process.env[key];
    if (!value) {
        if (defaultValue) {
            return defaultValue;
        }
        throw new Error(`Environment variable ${key} is not set`);
    }
    return value;
};
exports.env = env;
