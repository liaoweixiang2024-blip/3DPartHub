## Summary

-

## Verification

- [ ] `bash scripts/scan-maintenance.sh`
- [ ] `bash scripts/verify-local.sh`
- [ ] `RUN_SERVER_TESTS=1 bash scripts/verify-local.sh` when backend behavior changed

## Risk Checklist

- [ ] No JWT/access token is placed in URLs, logs, or Referer-visible links.
- [ ] No new `execSync` shell-string command paths were added.
- [ ] Any `dangerouslySetInnerHTML` usage passes through `sanitizeHtml`.
- [ ] API response parsing uses `unwrapApiData` / `unwrapResponse`.
- [ ] Database, backup, migration, or file-storage changes include a rollback note.
