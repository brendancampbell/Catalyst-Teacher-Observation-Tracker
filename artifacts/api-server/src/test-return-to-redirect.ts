import assert from "node:assert/strict";
import { isSafeReturnTo } from "./routes/auth.js";

const SAFE: string[] = [
  "/",
  "/dashboard",
  "/catalyst-mobile",
  "/catalyst-mobile/access-denied",
  "/dashboard?rubric=Q1&schoolId=5",
  "/action-center?returnTo=%2Fdashboard",
];

const UNSAFE: unknown[] = [
  "//evil.example/phish",          // protocol-relative — the primary bug
  "//evil.example",
  "http://evil.example",
  "https://evil.example/phish",
  "javascript:alert(1)",
  "//",
  "/\\evil.example",               // backslash bypass attempt
  "/ /evil",                       // space in scheme position
  null,
  undefined,
  42,
  "",
];

let passed = 0;

for (const v of SAFE) {
  assert(isSafeReturnTo(v), `FAIL: expected SAFE to be accepted: ${v}`);
  console.log(`PASS [safe]   ${v}`);
  passed++;
}

for (const v of UNSAFE) {
  assert(!isSafeReturnTo(v), `FAIL: expected UNSAFE to be rejected: ${String(v)}`);
  console.log(`PASS [unsafe] ${String(v)}`);
  passed++;
}

console.log(`\nAll ${passed} returnTo tests passed.`);
