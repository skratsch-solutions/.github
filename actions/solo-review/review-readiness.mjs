import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const AUTHOR_MARKER = "skratsch-author-handoff:v1";
const SELECTION_MARKER = "skratsch-review-selection:v1";
const REVIEW_MARKER = "skratsch-solo-review-attestation:v1";
const DISPOSITIONS = new Set(["ACCEPT", "RETURN INCOMPLETE", "BLOCKED"]);
const OUTCOME_LABELS = ["independent-review-complete", "review-return-incomplete", "review-blocked"];
const REQUIRED_AUTHOR_ATTESTATIONS = [
  "branchCurrent",
  "validationEvidenceAttached",
  "singleFaultFixturesCovered",
  "notionUpdated",
  "independentReviewRequested",
  "noAuthorityClaim",
];

function parseUniqueBlock(text, marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<!--\\s*${escaped}\\s*\\r?\\n([\\s\\S]*?)\\r?\\n-->`, "g");
  const matches = [...(text ?? "").matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`expected exactly one ${marker} block; found ${matches.length}`);
  try {
    return JSON.parse(matches[0][1].trim());
  } catch (error) {
    throw new Error(`${marker} block is not valid JSON: ${error.message}`);
  }
}

function validEvidenceUrl(value, allowedHosts) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedHosts.includes(url.hostname) && url.pathname.startsWith("/p/");
  } catch {
    return false;
  }
}

function validRunId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{8,200}$/.test(value);
}

function deriveOutcome(lanes) {
  const dispositions = Object.values(lanes).map((value) => value?.disposition);
  if (dispositions.includes("BLOCKED")) return { name: "blocked", label: "review-blocked" };
  if (dispositions.includes("RETURN INCOMPLETE")) return { name: "return-incomplete", label: "review-return-incomplete" };
  if (dispositions.every((value) => value === "ACCEPT")) return { name: "accepted", label: "independent-review-complete" };
  return { name: "invalid", label: null };
}

export function evaluateReviewReadiness({ pr, comments, comparison, policy }) {
  const failures = [];
  let authorHandoff;
  let selection;
  try {
    authorHandoff = parseUniqueBlock(pr.body, AUTHOR_MARKER);
  } catch (error) {
    failures.push(error.message);
  }
  try {
    selection = parseUniqueBlock(pr.body, SELECTION_MARKER);
  } catch (error) {
    failures.push(error.message);
  }

  if (authorHandoff) {
    if (authorHandoff.headSha !== pr.head.sha) failures.push(`author handoff SHA is stale: expected ${pr.head.sha}`);
    for (const field of REQUIRED_AUTHOR_ATTESTATIONS) {
      if (authorHandoff[field] !== true) failures.push(`author attestation is not true: ${field}`);
    }
  }
  if (selection?.headSha !== pr.head.sha) failures.push(`review selection SHA is stale: expected ${pr.head.sha}`);
  if (!Number.isSafeInteger(selection?.attestationCommentId) || selection.attestationCommentId <= 0) {
    failures.push("review selection requires a positive integer attestationCommentId");
  }
  if (!["ahead", "identical"].includes(comparison.status)) {
    failures.push(`branch is not current with ${pr.base.ref}: compare status is ${comparison.status}`);
  }

  const labels = new Set((pr.labels ?? []).map((label) => label.name));
  const presentOutcomes = OUTCOME_LABELS.filter((label) => labels.has(label));
  if (presentOutcomes.length !== 1) failures.push(`expected exactly one outcome label; found ${presentOutcomes.length}`);
  if (labels.has("needs-independent-review")) failures.push("needs-independent-review must be removed before applying an outcome label");

  const maintainerIds = new Set(policy.maintainerUserIds);
  const selectedComment = comments.find(({ id }) => id === selection?.attestationCommentId);
  let attestation;
  if (!selectedComment) {
    failures.push("selected attestation comment is missing or was deleted");
  } else if (!maintainerIds.has(selectedComment.user?.id)) {
    failures.push("selected attestation was not posted by an authorized maintainer");
  } else {
    try {
      attestation = parseUniqueBlock(selectedComment.body, REVIEW_MARKER);
    } catch (error) {
      failures.push(`selected attestation is invalid: ${error.message}`);
    }
  }

  let outcome = { name: "invalid", label: null };
  if (attestation) {
    if (attestation.headSha !== pr.head.sha) failures.push(`selected attestation SHA is stale: expected ${pr.head.sha}`);
    const lanes = { semantic: attestation.semantic, "authority-security": attestation.authoritySecurity };
    const runIds = [];
    for (const lane of policy.requiredLanes) {
      const value = lanes[lane];
      if (!value || !DISPOSITIONS.has(value.disposition)) failures.push(`invalid disposition for lane: ${lane}`);
      if (!validRunId(value?.reviewRunId)) failures.push(`invalid reviewRunId for lane: ${lane}`);
      else runIds.push(value.reviewRunId);
      if (!validEvidenceUrl(value?.evidenceUrl, policy.evidenceHosts)) failures.push(`invalid durable evidence URL for lane: ${lane}`);
    }
    if (new Set(runIds).size !== runIds.length) failures.push("review lanes must use distinct reviewRunId values");
    if (attestation.limitationsAccepted !== true) failures.push("solo-maintainer limitationsAccepted must be true");
    outcome = deriveOutcome(lanes);
    if (!outcome.label || !labels.has(outcome.label)) failures.push(`outcome label does not match attestation: expected ${outcome.label ?? "none"}`);
  }

  if (outcome.name !== "accepted") failures.push(`review outcome is not accepted: ${outcome.name}`);
  return { ok: failures.length === 0, failures, selectedComment, attestation, outcome };
}

async function github(pathname, token) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "skratsch-review-readiness",
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${pathname}`);
  return { data: await response.json(), link: response.headers.get("link") };
}

function nextLink(link) {
  if (!link) return null;
  for (const entry of link.split(",")) {
    const match = entry.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return new URL(match[1]).pathname + new URL(match[1]).search;
  }
  return null;
}

export async function fetchAllPages(pathname, token, maxPages, request = github) {
  const items = [];
  let next = pathname;
  for (let page = 0; next && page < maxPages; page += 1) {
    const result = await request(next, token);
    if (!Array.isArray(result.data)) throw new Error(`paginated GitHub response is not an array: ${next}`);
    items.push(...result.data);
    next = nextLink(result.link);
  }
  if (next) throw new Error(`GitHub pagination exceeded fail-closed limit of ${maxPages} pages`);
  return items;
}

export function policyFromEnvironment(env = process.env) {
  const maintainerUserIds = JSON.parse(env.SKRATSCH_MAINTAINER_USER_IDS ?? "[]");
  const evidenceHosts = JSON.parse(env.SKRATSCH_EVIDENCE_HOSTS ?? '["app.notion.com"]');
  const maxApiPages = Number.parseInt(env.SKRATSCH_MAX_API_PAGES ?? "20", 10);
  if (!Array.isArray(maintainerUserIds) || maintainerUserIds.length === 0 || !maintainerUserIds.every(Number.isSafeInteger)) {
    throw new Error("maintainer-user-ids must be a nonempty JSON array of integer GitHub user IDs");
  }
  if (!Array.isArray(evidenceHosts) || evidenceHosts.length === 0 || !evidenceHosts.every((host) => typeof host === "string" && /^[A-Za-z0-9.-]+$/.test(host))) {
    throw new Error("evidence-hosts must be a nonempty JSON array of hostnames");
  }
  if (!Number.isSafeInteger(maxApiPages) || maxApiPages < 1 || maxApiPages > 100) {
    throw new Error("max-api-pages must be an integer from 1 to 100");
  }
  return { maintainerUserIds, evidenceHosts, maxApiPages, requiredLanes: ["semantic", "authority-security"] };
}

async function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const [owner, repo] = event.repository.full_name.split("/");
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const root = `/repos/${owner}/${repo}`;
  const prNumber = event.pull_request?.number ?? event.issue?.number;
  if (!prNumber) throw new Error("workflow event does not identify a pull request");
  const policy = policyFromEnvironment();
  const pr = event.pull_request ?? (await github(`${root}/pulls/${prNumber}`, token)).data;
  const [comments, comparison] = await Promise.all([
    fetchAllPages(`${root}/issues/${prNumber}/comments?per_page=100`, token, policy.maxApiPages),
    github(`${root}/compare/${encodeURIComponent(pr.base.ref)}...${pr.head.sha}`, token).then(({ data }) => data),
  ]);
  const result = evaluateReviewReadiness({ pr, comments, comparison, policy });
  if (!result.ok) {
    console.error("Solo-maintainer review packet is not complete for the current head:");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Authenticated maintainer attestation: comment ${result.selectedComment.id}`);
  console.log("SHA-bound semantic and authority/security review evidence is accepted.");
  console.log("Human merge authority remains separate.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exit(1);
  });
}
