# Governance

Skratsch Solutions currently operates as a solo-maintainer organization. The
review process therefore separates functions rather than pretending that one
GitHub identity represents multiple independent people.

## Review contract

A pull request is ready only when all of these conditions hold:

- the author handoff and selected review attestation name the exact current head SHA;
- the selected attestation is an authenticated GitHub comment by an allowed maintainer;
- semantic and authority/security lanes use distinct review-run identifiers;
- both lane dispositions are exactly `ACCEPT`;
- each lane links a non-root durable evidence record on an allowed HTTPS host;
- all author attestations are true and the branch is current with its base;
- exactly one matching outcome label is present; and
- the maintainer explicitly accepts the limitations of solo-maintainer review.

Automated readiness is evidence, not authority. A human maintainer remains
responsible for deciding whether and when to merge.

## Trust boundaries

The caller workflow runs on trusted default-branch code with read-only GitHub
permissions. Participating repositories pin the shared action to a reviewed
commit SHA. Pull-request content is treated as untrusted data.

Changes to this repository use the same review packet before release or wider
adoption. Repository-specific exceptions must be documented in that repository.
