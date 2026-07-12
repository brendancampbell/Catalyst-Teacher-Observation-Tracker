import assert from "node:assert/strict";
import { buildHtmlEmail } from "./routes/email.js";

const PAYLOADS = [
  '<script>alert(1)</script>',
  '<a href="javascript:void(0)">xss</a>',
  '"><script>alert(1)</script>',
];

const baseParams = {
  teacherName:    "Test Teacher",
  teacherSubject: "Math",
  teacherGrade:   "5",
  date:           "2026-01-01",
  time:           "9:00 AM",
  course:         "Algebra",
  observer:       "Coach",
  scoreMap:       {},
  prevScoreMap:   {},
  categories:     [],
  logoUrl:        "https://example.com/logo.png",
};

let passed = 0;

for (const payload of PAYLOADS) {
  const html = buildHtmlEmail({
    ...baseParams,
    intro:      payload,
    glowsText:  payload,
    growsText:  payload,
  });

  assert(
    !html.includes("<script"),
    `FAIL: literal <script found in output for payload: ${payload}`
  );
  assert(
    !html.includes("javascript:"),
    `FAIL: javascript: scheme found in output for payload: ${payload}`
  );

  passed++;
  console.log(`PASS [${passed}/${PAYLOADS.length}] payload: ${payload.slice(0, 40)}`);
}

console.log(`\nAll ${passed} injection tests passed.`);
