---
title: JSON output and exit codes
description: The JSON envelope every command prints with --json, and what each exit code means.
---

With `--json`, every command prints exactly one JSON document on stdout. It is written synchronously, so large documents are not truncated when the process exits.

## Success

The top level always has `success: true` plus command-specific keys:

```json
{
  "success": true,
  "platforms": {
    "ios": {
      "status": "success",
      "version": "1.2.0",
      "artifactPath": "output/MyApp-1.2.0-12.ipa",
      "durationSeconds": 412,
      "error": null
    }
  }
}
```

## Errors

Always this shape:

```json
{
  "success": false,
  "error": {
    "code": "MISSING_CONFIG_SHIPYARD",
    "message": "Project not initialized. .shipyard/config.json not found.",
    "fix": "Run 'rn-shipyard init' to set up the project first"
  }
}
```

`code` is stable and safe to match on. `message` is for people. `fix` says what to do. See [Error codes](/reference/error-codes/).

Usage errors (unknown option, missing argument) also use this envelope, with `INVALID_USAGE`.

## Per-command keys

| Command | Keys |
|---|---|
| `build` | `success`, `platforms`, `prebuild`, `warnings`, and `submit` when `--submit` is used |
| `submit` | `success`, `platforms`. With `--dry-run`: `dryRun: true`, `cwd` and per platform `status`, `artifactPath`, `command`, `problems` |
| `init` | `success`, and `warnings` |
| `doctor` | `success`, `checks`, `readiness`, `summary`, `nextStep`, and `error` when a check failed |

`prebuild.<platform>.action` is `generated`, `skipped_tracked` or `refused`. `warnings` lists everything that would have been printed as a warning.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error. At least one platform or check failed |
| `2` | Missing configuration. Not initialized, or a required value is missing in `--non-interactive` mode. Any error code starting with `MISSING_CONFIG` exits `2` |
| `129` | Interrupted by SIGHUP (terminal closed) |
| `130` | Interrupted by SIGINT (Ctrl-C) |
| `143` | Interrupted by SIGTERM |

On interruption, a final `{"success":false,"error":{"code":"INTERRUPTED",...}}` is written to stdout if it is still open; the human notice goes to stderr.
