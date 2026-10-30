# DRAFT demo for rn-shipyard. Run from a prepared Expo project:
#   cd your-expo-project && vhs /path/to/demo.tape   (writes demo.gif in the current directory)
# Not run yet. Requires vhs (brew install vhs), ttyd and ffmpeg.

Output demo.gif

Set Shell "zsh"
Set FontSize 20
Set Width 1200
Set Height 640
Set Padding 20
Set Theme "Catppuccin Mocha"
Set Framerate 24
Set TypingSpeed 45ms

# Short prompt, hidden from the recording
Hide
Type "PS1='$ ' && clear"
Enter
Show

# 1. doctor
Type "npx rn-shipyard doctor"
Sleep 400ms
Enter
Wait+Screen@60s /Ready/
Sleep 2s

# 2. build: show the start, hide the wait, show the end
Type "clear"
Enter
Type "rn-shipyard build --platform android --profile production"
Sleep 400ms
Enter
Sleep 6s
Hide
Wait+Screen@30m /\.aab/
Show
Sleep 3s

# 3. dry-run submit
Type "clear"
Enter
Type "rn-shipyard submit --platform android --dry-run"
Sleep 400ms
Enter
Wait+Screen@120s /fastlane/
Sleep 3s

# 4. history
Type "clear"
Enter
Type "rn-shipyard history"
Sleep 400ms
Enter
Sleep 4s
