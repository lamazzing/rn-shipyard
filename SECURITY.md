# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories:
<https://github.com/lamazzing/rn-shipyard/security/advisories/new>

Do not open a public issue for security problems, and do not include real credentials in a report. I aim to acknowledge reports within a week.

## Scope

rn-shipyard handles signing credentials on your machine, so the areas that matter most are:

- Credential handling: how Match passwords, keystore passwords, Apple credentials and Google Play service-account keys are read and passed to child processes.
- Redaction: secrets leaking into terminal output, `--json` output, logs or `.shipyard/history.json`.
- The generated Fastfile, Appfile and Matchfile (command injection, secrets written into generated files).
- Anything that causes files such as keystores or credentials to be written to a location that is likely to be committed.

Out of scope: vulnerabilities in Fastlane, Expo, Xcode, Gradle or other tools rn-shipyard invokes (report those upstream), and issues requiring an attacker who already controls your machine or shell environment.

## Supported versions

Only the latest published release receives security fixes.
