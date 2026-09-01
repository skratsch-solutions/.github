## Purpose

Describe the bounded change and operational need.

## Governing context

- Notion handoff/spec:
- Related role contract:
- Review evidence:

## Validation evidence

- Commands and results:
- Fixtures added or changed:
- Risks and authority boundaries:

## Author handoff

- [ ] Branch is current with the base branch.
- [ ] Validation evidence is attached.
- [ ] Positive and single-fault negative fixtures cover the change.
- [ ] Notion is updated.
- [ ] `needs-independent-review` is applied.
- [ ] Passing checks are not treated as merge or operational authority.

<!-- skratsch-author-handoff:v1
{"headSha":"FULL_HEAD_SHA","branchCurrent":false,"validationEvidenceAttached":false,"singleFaultFixturesCovered":false,"notionUpdated":false,"independentReviewRequested":false,"noAuthorityClaim":false}
-->

## Selected review attestation

After posting the maintainer attestation comment, replace `0` with its numeric
GitHub comment ID. Only that comment is evaluated; deleted or stale selections
fail closed.

<!-- skratsch-review-selection:v1
{"headSha":"FULL_HEAD_SHA","attestationCommentId":0}
-->

## Maintainer attestation comment

```text
<!-- skratsch-solo-review-attestation:v1
{"headSha":"FULL_HEAD_SHA","semantic":{"disposition":"ACCEPT","reviewRunId":"codex:semantic:RUN_ID","evidenceUrl":"https://app.notion.com/p/..."},"authoritySecurity":{"disposition":"ACCEPT","reviewRunId":"codex:authority-security:RUN_ID","evidenceUrl":"https://app.notion.com/p/..."},"limitationsAccepted":true}
-->
```

Each disposition is exactly `ACCEPT`, `RETURN INCOMPLETE`, or `BLOCKED`.

After posting and selecting the attestation, remove `needs-independent-review`
and apply exactly one matching label:

- both lanes `ACCEPT` -> `independent-review-complete`;
- either lane `RETURN INCOMPLETE` -> `review-return-incomplete`;
- either lane `BLOCKED` -> `review-blocked` (highest precedence).
