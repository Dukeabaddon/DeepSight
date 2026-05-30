# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a vulnerability

Please **do not** open public GitHub issues for security problems.

Email or DM the maintainer via [GitHub](https://github.com/Dukeabaddon/DeepSight) with:

- Description and impact
- Steps to reproduce
- Affected version / commit

We aim to acknowledge within 72 hours.

## Secrets and local data

- DeepSight runs **locally**. It does not upload your source code to a DeepSight cloud.
- Optional LLM keys (`DEEPSIGHT_LLM_API_KEY`, etc.) are read from **your** environment only — never commit them.
- Test runs write artifacts under the **target project** (`deepsight_tests/`, `.deepsight/`). Add those paths to your app’s `.gitignore` (DeepSight can help via bootstrap).

## Before you commit or publish

```bash
npm run security:check
```

This scans tracked paths for common secret patterns and blocks accidental leaks.
