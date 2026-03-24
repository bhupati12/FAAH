# Faah Command Coach

Cross-platform VS Code feedback for terminal mistakes: Faah reacts to command failures with a short sound, smart suggestions, and a local history view.

## What makes it different

- It does not just beep on every failure.
- It classifies likely mistakes such as `command not found`, permission errors, and missing paths.
- It suggests likely fixes for common typos and missing workspace scripts.
- It keeps a local history dashboard of recent failures.
- It only reacts to confident failures by default.
- It works across Windows, macOS, and Linux with native audio fallbacks.

## Install

- Search for `Faah Command Coach` in the VS Code Marketplace once published, or install the `.vsix` package locally with VS Code.

## Supported terminals

Faah uses VS Code terminal shell integration, so it works best in shells that VS Code supports on each platform:

- Windows: PowerShell, Git Bash
- macOS and Linux: bash, fish, pwsh, zsh

If shell integration is unavailable, Faah stays quiet instead of guessing.

## Features

- Play a custom "faah" sound on terminal mistakes
- Show a helpful message with the likely failure type
- Show a correction hint when the command looks like a typo
- Record a local failure history in the Explorer view
- Toggle the extension from the status bar
- Test the sound from the command palette
- Mute reactions for the current session
- Clear history from the command palette
- View and inspect recent failures from the Explorer sidebar

## Settings

- `faah.enabled`
- `faah.reactionMode`
- `faah.sound.enabled`
- `faah.sound.fallbackToNotification`
- `faah.cooldownMs`

## Build

```bash
npm install
npm run compile
```

## Package

```bash
npm run package
```

This creates a `.vsix` file that can be installed directly into VS Code.

## Marketplace

- Icon: custom Faah badge
- License: MIT
- Packaging: VSCE-ready

## Next step ideas

- Add command suggestions for common typos
- Add a mistake history panel
- Add per-workspace reaction profiles
