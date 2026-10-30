> **DRAFT. Nothing recorded yet. vhs is not installed on this machine.**

# Demo script (30 to 45 seconds)

Goal: show that a build starts immediately and a store upload happens from the Mac. Keep it honest: do not speed up the build to look faster than it is, and cut the waiting with a clearly visible jump.

## Setup before recording

- Use a small real Expo project that has already been through `init` once, with a short iOS or Android build time. Android is easier to demo (no Match prompts).
- Use fake or test app data on screen; no real Apple ID, team ID, keystore path or bundle id of an unreleased app.
- Terminal: 100 columns by 28 rows, large font, dark theme, prompt shortened to `$`.
- For the submit step use `--dry-run`, so nothing is uploaded on camera.

## Shots

| Time | Command | Show | Cut |
|---|---|---|---|
| 0:00 to 0:06 | `npx rn-shipyard doctor` | Grouped checks, green ticks, "Ready" summary. | Hold 2 seconds on the Ready line. |
| 0:06 to 0:10 | `rn-shipyard build --platform android --profile production` | The build starts immediately; first lines of prebuild appear. | Type, hit enter, let the first lines scroll. |
| 0:10 to 0:25 | (same) | Gradle output streaming. Overlay text "build time cut" at the cut. | Jump cut to the final lines. Do not fake timing. |
| 0:25 to 0:30 | (same) | The line naming the artifact in `output/`. | Hold 2 seconds. |
| 0:30 to 0:38 | `rn-shipyard submit --platform android --dry-run` | The checks pass and the fastlane command is printed. | Hold 2 seconds. |
| 0:38 to 0:42 | `rn-shipyard history` | The table with the build you just made. | End. |

Closing frame (2 seconds): "rn-shipyard - npx rn-shipyard doctor" and the repo URL.

## Recording with vhs

vhs (charmbracelet) renders a GIF from a `.tape` script, so the recording is reproducible. Install it yourself when ready: `brew install vhs` (it also needs `ttyd` and `ffmpeg`, which the Homebrew formula pulls in).

1. Copy a prepared Expo project to a scratch directory and `cd` into it.
2. Run `vhs /path/to/rn-shipyard/docs/launch/demo.tape` from that directory.
3. The tape writes `demo.gif` in the current directory. Watch it, check there is nothing private on screen, and re-record if the timing feels rushed.
4. Keep the GIF under about 5 MB for GitHub and X (lower `Set Framerate` or the size if needed). Do not commit the GIF until you are happy with it.

The tape types the commands and then waits for the output instead of faking it. Because a real build is slow and varies, the tape uses `Wait` on the final output line with a generous timeout and `Hide`/`Show` around the build so the GIF jumps over the waiting. This is a cut, and the script says so on screen.
