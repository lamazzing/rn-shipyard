# Demo for rn-shipyard (renders .github/assets/demo.gif).
# Run from a prepared Expo project where `rn-shipyard init --platform android` has run and the
# keystore passwords are exported (ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_PASSWORD):
#   cd your-expo-project && vhs /path/to/demo.tape
# Requires vhs (brew install vhs). The prompt below is what WaitPattern matches: keep them in sync.

Output demo.gif
Set Shell "zsh"
Set FontSize 16
Set Width 1280
Set Height 860
Set Padding 24
Set Theme "Catppuccin Mocha"
Set Framerate 20
Set TypingSpeed 45ms
Set WaitPattern /my-expo-app \$ ?$/

Hide
Type "PS1='%F{cyan}my-expo-app%f $ '; clear"
Enter
Sleep 1s
Show

# 1. doctor
Type "npx rn-shipyard doctor --platform android"
Sleep 400ms
Enter
Wait@90s
Sleep 4s

# 2. build: show the start (prebuild), cut the Gradle wait
Type "clear"
Enter
Type "npx rn-shipyard build --platform android"
Sleep 400ms
Enter
Sleep 4s
Hide
Wait@20m
Type "clear"
Enter
Sleep 500ms
Show

# 3. the artifact and the history
Type "ls output"
Sleep 300ms
Enter
Sleep 2s
Type "npx rn-shipyard history"
Sleep 400ms
Enter
Sleep 6s
