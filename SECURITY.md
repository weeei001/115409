# Security Policy

## Supported Versions

Stock Lighthouse provides security fixes for the latest code on the `main` branch.
Upgrade to the latest `main` revision to receive fixes.

| Version | Supported |
| --- | --- |
| Latest `main` revision | Yes |
| Earlier revisions and other branches | No |

## Reporting a Vulnerability

Please report vulnerabilities privately. Do not include vulnerability details,
exploit code, credentials, or personal data in public issues or pull requests.

If GitHub private vulnerability reporting is available, use **Report a
vulnerability** in the repository's [Security tab](https://github.com/weeei001/115409/security).
If that option is unavailable, open an [issue](https://github.com/weeei001/115409/issues)
requesting a private security contact, without disclosing the vulnerability.
Wait for a private channel before sharing details.

Include the following in your private report:

- Affected component, endpoint, and commit or revision.
- Steps to reproduce, with a minimal proof of concept if possible.
- Expected and actual behavior, potential impact, and any required access.
- Relevant logs or screenshots with secrets and personal data removed.

## Response and Disclosure

Maintainers review reports as availability permits; there is no guaranteed
response or resolution time. If you have not received a response after seven
days, please follow up through the same channel without adding sensitive details
to a public thread.

For accepted reports, maintainers will coordinate validation, remediation, and
disclosure through the private channel and share updates when the status changes.
For declined reports, maintainers will explain the decision when responding;
you may provide additional evidence for reconsideration.

Please coordinate public disclosure with maintainers so affected users have an
opportunity to apply a fix. Let maintainers know whether you would like credit
in any published advisory.

## Automated Checks

Dependabot checks Python, npm, and GitHub Actions dependencies weekly. Security
checks run on pull requests, pushes to `main` and `wei`, and a weekly schedule:

- `pip-audit` checks resolved backend dependencies against known vulnerabilities.
- Bandit checks backend Python source for medium or higher severity findings
  with medium or higher confidence.
- `npm audit` checks the frontend lockfile, including development dependencies,
  and fails on moderate or higher severity vulnerabilities.
- Gitleaks scans fetched Git history and redacts detected secrets in its output.

Do not dismiss a real secret finding by adding an exclusion. Revoke or rotate the
credential first, then coordinate any required history cleanup with maintainers.

CodeQL and dependency review workflows are also included. For this private
repository, they run only when the repository variable `CODE_SECURITY_ENABLED`
is `true`. Enable that variable only after GitHub Code Security is available and
enabled for the repository. These workflows do not enable the GitHub license or
native secret scanning and push protection themselves.
