import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluateReviewReadiness, fetchAllPages, policyFromEnvironment } from "./review-readiness.mjs";

const SHA = "a".repeat(40);
const POLICY = { maintainerUserIds: [42], requiredLanes: ["semantic", "authority-security"], evidenceHosts: ["app.notion.com"], maxApiPages: 3 };
const machine = (marker, value) => `<!-- ${marker}\n${JSON.stringify(value)}\n-->`;

function authorBody(commentId = 7, overrides = {}) {
  const handoff = { headSha: SHA, branchCurrent: true, validationEvidenceAttached: true, singleFaultFixturesCovered: true, notionUpdated: true, independentReviewRequested: true, noAuthorityClaim: true };
  return `${machine("skratsch-author-handoff:v1", { ...handoff, ...overrides })}\n${machine("skratsch-review-selection:v1", { headSha: SHA, attestationCommentId: commentId })}`;
}

function attestation(semantic = "ACCEPT", security = "ACCEPT", overrides = {}) {
  return machine("skratsch-solo-review-attestation:v1", {
    headSha: SHA,
    semantic: { disposition: semantic, reviewRunId: "codex:semantic:run-001", evidenceUrl: "https://app.notion.com/p/semantic" },
    authoritySecurity: { disposition: security, reviewRunId: "codex:security:run-002", evidenceUrl: "https://app.notion.com/p/security" },
    limitationsAccepted: true,
    ...overrides,
  });
}

const comment = (id, body, userId = 42) => ({ id, body, user: { id: userId } });
function scenario({ body = authorBody(), comments = [comment(7, attestation())], labels = ["independent-review-complete"], comparison = "ahead" } = {}) {
  return { pr: { body, head: { sha: SHA }, base: { ref: "main" }, labels: labels.map((name) => ({ name })) }, comments, comparison: { status: comparison }, policy: POLICY };
}

assert.equal(evaluateReviewReadiness(scenario()).ok, true, "accepted packet should pass");
assert.equal(evaluateReviewReadiness(scenario({ comments: [] })).ok, false, "deleted selection must fail");
assert.equal(evaluateReviewReadiness(scenario({ comments: [comment(7, "<!-- skratsch-solo-review-attestation:v1\nnot-json\n-->")] })).ok, false, "malformed JSON must fail");
assert.equal(evaluateReviewReadiness(scenario({ comments: [comment(7, `${attestation()}\n${attestation()}`)] })).ok, false, "duplicate blocks must fail");
assert.equal(evaluateReviewReadiness(scenario({ labels: ["needs-independent-review", "independent-review-complete"] })).ok, false, "pending and outcome labels cannot coexist");
assert.equal(evaluateReviewReadiness(scenario({ comments: [comment(7, attestation("RETURN INCOMPLETE", "ACCEPT"))], labels: ["review-return-incomplete"] })).ok, false, "return-incomplete is not ready");
assert.equal(evaluateReviewReadiness(scenario({ comments: [comment(7, attestation("BLOCKED", "ACCEPT"))], labels: ["review-blocked"] })).ok, false, "blocked is not ready");
assert.equal(evaluateReviewReadiness(scenario({ comments: [comment(7, attestation(), 99)] })).ok, false, "unauthorized attestor must fail");
assert.equal(evaluateReviewReadiness(scenario({ comparison: "diverged" })).ok, false, "diverged branch must fail");
assert.equal(evaluateReviewReadiness(scenario({ comments: [comment(7, attestation("ACCEPT", "ACCEPT", { authoritySecurity: null }))] })).ok, false, "missing lane must fail");
assert.equal(evaluateReviewReadiness(scenario({ comments: [comment(7, attestation("ACCEPT", "ACCEPT", { headSha: "b".repeat(40) }))] })).ok, false, "stale SHA must fail");
assert.equal(evaluateReviewReadiness(scenario({ comments: [comment(7, attestation("ACCEPT", "ACCEPT", { semantic: { disposition: "ACCEPTED", reviewRunId: "codex:semantic:run-001", evidenceUrl: "https://app.notion.com/p/semantic" } }))] })).ok, false, "substring dispositions must fail");
assert.equal(evaluateReviewReadiness(scenario({ comments: [comment(7, attestation("ACCEPT", "ACCEPT", { semantic: { disposition: "ACCEPT", reviewRunId: "codex:semantic:run-001", evidenceUrl: "https://evil.example/p/semantic" } }))] })).ok, false, "unapproved evidence host must fail");
assert.equal(evaluateReviewReadiness(scenario({ comments: [comment(7, attestation("ACCEPT", "ACCEPT", { authoritySecurity: { disposition: "ACCEPT", reviewRunId: "codex:semantic:run-001", evidenceUrl: "https://app.notion.com/p/security" } }))] })).ok, false, "duplicate run IDs must fail");
assert.throws(() => policyFromEnvironment({ SKRATSCH_MAINTAINER_USER_IDS: "[]" }), /nonempty/);
assert.throws(() => policyFromEnvironment({ SKRATSCH_MAINTAINER_USER_IDS: '["owner"]' }), /integer/);
assert.throws(() => policyFromEnvironment({ SKRATSCH_MAINTAINER_USER_IDS: "[42]", SKRATSCH_MAX_API_PAGES: "20junk" }), /base-10 integer/);
assert.throws(() => policyFromEnvironment({ SKRATSCH_MAINTAINER_USER_IDS: "[42]", SKRATSCH_MAX_API_PAGES: "01" }), /base-10 integer/);

const customPolicy = policyFromEnvironment({ SKRATSCH_MAINTAINER_USER_IDS: "[42]", SKRATSCH_EVIDENCE_HOSTS: '["evidence.example.com"]', SKRATSCH_MAX_API_PAGES: "100" });
assert.deepEqual(customPolicy, { maintainerUserIds: [42], evidenceHosts: ["evidence.example.com"], maxApiPages: 100, requiredLanes: ["semantic", "authority-security"] });
const customEvidence = scenario();
customEvidence.policy = customPolicy;
customEvidence.comments = [comment(7, attestation("ACCEPT", "ACCEPT", {
  semantic: { disposition: "ACCEPT", reviewRunId: "codex:semantic:run-001", evidenceUrl: "https://evidence.example.com/reviews/semantic" },
  authoritySecurity: { disposition: "ACCEPT", reviewRunId: "codex:security:run-002", evidenceUrl: "https://evidence.example.com/reviews/security" },
}))];
assert.equal(evaluateReviewReadiness(customEvidence).ok, true, "custom evidence host and non-root paths should pass");
customEvidence.comments = [comment(7, attestation("ACCEPT", "ACCEPT", {
  semantic: { disposition: "ACCEPT", reviewRunId: "codex:semantic:run-001", evidenceUrl: "https://evidence.example.com/" },
  authoritySecurity: { disposition: "ACCEPT", reviewRunId: "codex:security:run-002", evidenceUrl: "https://evidence.example.com/reviews/security" },
}))];
assert.equal(evaluateReviewReadiness(customEvidence).ok, false, "root evidence URL must fail");

const actionMetadata = fs.readFileSync(new URL("./action.yml", import.meta.url), "utf8");
assert.match(actionMetadata, /SKRATSCH_MAINTAINER_USER_IDS:\s*\$\{\{ inputs\.maintainer-user-ids \}\}/);
assert.match(actionMetadata, /SKRATSCH_EVIDENCE_HOSTS:\s*\$\{\{ inputs\.evidence-hosts \}\}/);
assert.match(actionMetadata, /SKRATSCH_MAX_API_PAGES:\s*\$\{\{ inputs\.max-api-pages \}\}/);
assert.match(actionMetadata, /node "\$GITHUB_ACTION_PATH\/review-readiness\.mjs"/);

const pages = { "/page/1": { data: [{ id: 1 }], link: '<https://api.github.com/page/2>; rel="next"' }, "/page/2": { data: [{ id: 2 }], link: null } };
assert.deepEqual(await fetchAllPages("/page/1", "token", 3, async (url) => pages[url]), [{ id: 1 }, { id: 2 }]);
await assert.rejects(() => fetchAllPages("/page/1", "token", 1, async (url) => pages[url]), /fail-closed limit/);

console.log("PASS review-readiness 26 contract and adversarial scenarios");
