# Adopting shared review governance

Default community files from this public repository are inherited only when a
repository does not define its own equivalent file. Workflows are never
inherited automatically.

## Adoption steps

1. Create the four review labels listed below in the participating repository.
2. Add the workflow from the organization workflow template.
3. Replace `REVIEWED_ACTION_SHA` with the full commit SHA of a reviewed release
   of this repository. Do not use a mutable branch or tag in protected callers.
4. Set `maintainer-user-ids` to a JSON array of stable GitHub numeric user IDs.
5. Set `evidence-hosts` to the approved HTTPS evidence hosts.
6. Open a test pull request and exercise accepted, stale-SHA, unauthorized-user,
   malformed-disposition, missing-evidence, and deleted-comment cases.
7. Require the `review-packet` check in repository rules or branch protection.

Required labels:

- `needs-independent-review`
- `independent-review-complete`
- `review-return-incomplete`
- `review-blocked`

GitHub Free does not provide one organization ruleset covering private
repositories. Apply the caller and required check repository by repository until
the organization plan or platform capability changes.
