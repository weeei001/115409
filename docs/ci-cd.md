# GitHub Actions

[CI and Windows deployment](../.github/workflows/ci-cd.yml) runs on pull requests,
pushes to `main` or `wei`, and manual dispatches.

## CI

| Job | Runtime | Checks |
| --- | --- | --- |
| Backend checks | Python 3.12, Ubuntu 24.04 | Install requirements; run architecture, system, and streaming tests |
| Frontend checks | Node.js 22, Ubuntu 24.04 | `npm ci`; chat and comparison tests; production build; TypeScript check |

Both jobs use GitHub-hosted runners and need no production credentials or live
database. The frontend build uses a local API URL only to verify compilation.
Deployment rebuilds on Windows with the host's production settings.

These checks cover the documented baseline. The legacy backend tests and missing
frontend test scripts listed in [verification limits](README.md#已知驗證限制)
are not part of this gate.

## Windows deployment

Deployment runs after both checks pass, only for a push or manual run on `main`.
Pull requests and `wei` never run on the production runner. New runs do not cancel
an active deployment. Deployment remains skipped until explicitly enabled.

Configure the repository as follows:

1. Register a Windows x64 self-hosted runner with the custom label
   `stock-production`. Use a dedicated runner work directory outside the live
   application. Its service account must be able to manage the application
   services and execute Git, Python 3.12, Node.js, npm, and NSSM.
2. Create the `production` GitHub environment and restrict its deployment branches
   to `main`.
3. Set repository variable `WINDOWS_DEPLOY_SCRIPT` to the absolute path of the
   host's deployment script, outside the runner checkout. The workflow invokes
   it with `-SourcePath <checkout>` and `-Revision <tested commit SHA>`.
4. Validate the local script with `-WhatIf`, then set repository variable
   `WINDOWS_CD_ENABLED` to `true`. Push to `main` or run the workflow manually
   with `main` selected.

The host script stages a separate release, installs dependencies, builds using
the existing production environment files, and preserves runtime state. It must
restore the previous service configuration if activation or health checks fail.
The API health endpoint confirms the HTTP process; it does not prove database
or provider readiness.

Machine-specific paths, service configuration, environment files, deployment
scripts, and the setup runbook stay on the host under the ignored `deploy/`
directory. Application credentials do not need to be uploaded to GitHub.

Set `WINDOWS_CD_ENABLED` to `false` to stop future automatic deployments while
keeping CI enabled. This does not interrupt an active deployment.

GitHub references: [self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners),
[deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments),
and [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
