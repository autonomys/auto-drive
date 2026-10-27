/**
 * Globals jsdom does not provide but the code under test assumes.
 *
 * jsdom predates TextEncoder/TextDecoder being part of the web platform it
 * models, and viem reaches for them at import time — so a spec that merely
 * imports viem under `@jest-environment jsdom` dies before its first assertion.
 *
 * A no-op under the default node environment, which has had both as globals
 * since Node 11.
 */
import { TextDecoder, TextEncoder } from 'util';

const globals = globalThis as unknown as Record<string, unknown>;

if (typeof globals.TextEncoder === 'undefined') {
  globals.TextEncoder = TextEncoder;
}
if (typeof globals.TextDecoder === 'undefined') {
  globals.TextDecoder = TextDecoder;
}
