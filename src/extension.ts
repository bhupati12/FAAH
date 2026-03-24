import * as vscode from "vscode";
import { classifyTerminalFailure, ReactionMode } from "./classifier";
import { FaahHistoryEntry, FaahHistoryProvider, FaahHistoryStore } from "./history";
import { suggestCorrection } from "./suggestions";
import { playFaahSound } from "./sound";

type CapturedExecution = {
  outputPromise: Promise<string>;
  commandLine: string;
  confidence?: vscode.TerminalShellExecutionCommandLineConfidence;
};

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "faah.toggleEnabled";
  context.subscriptions.push(statusBar);

  const historyStore = new FaahHistoryStore(context.globalState);
  const historyProvider = new FaahHistoryProvider(historyStore);
  const executionCapture = new WeakMap<vscode.TerminalShellExecution, CapturedExecution>();

  let sessionMuted = false;
  let lastReactionAt = 0;

  context.subscriptions.push(vscode.window.registerTreeDataProvider("faah.historyView", historyProvider));

  const updateStatusBar = () => {
    const config = getConfig();
    const enabled = config.enabled && config.reactionMode !== "off";
    statusBar.text = enabled ? "$(bell) Faah" : "$(bell-slash) Faah";
    statusBar.tooltip = enabled ? "Faah Command Coach is active. Click to toggle." : "Faah Command Coach is disabled. Click to toggle.";
    statusBar.show();
  };

  const reactionAllowed = (now: number) => {
    const config = getConfig();
    return !sessionMuted && config.enabled && config.reactionMode !== "off" && now - lastReactionAt >= config.cooldownMs;
  };

  const reactToFailure = async (failure: NonNullable<ReturnType<typeof classifyTerminalFailure>>) => {
    const config = getConfig();
    const now = Date.now();
    if (!reactionAllowed(now)) {
      return;
    }

    lastReactionAt = now;
    updateStatusBar();

    let audioPlayed = false;
    if (config.soundEnabled) {
      const result = await playFaahSound(context);
      audioPlayed = result.played;
    }

    const responseLines = [failure.message];
    if (failure.suggestion) {
      responseLines.push(failure.suggestion);
    }
    if (failure.outputSnippet) {
      responseLines.push(failure.outputSnippet);
    }

    const action = await vscode.window.showWarningMessage(responseLines.join("\n"), "Open Settings", "Show History", "Mute for Session");

    if (action === "Open Settings") {
      await vscode.commands.executeCommand("workbench.action.openSettings", "faah");
    } else if (action === "Show History") {
      await vscode.commands.executeCommand("workbench.view.explorer");
      historyProvider.refresh();
    } else if (action === "Mute for Session") {
      sessionMuted = true;
      updateStatusBar();
    }

    if (!audioPlayed && config.soundEnabled && config.fallbackToNotification) {
      statusBar.text = "$(bell) Faah";
      statusBar.tooltip = `${failure.message} Audio player not found, so Faah used a visual fallback.`;
      statusBar.show();
    }

    historyProvider.refresh();
  };

  context.subscriptions.push(
    vscode.window.onDidStartTerminalShellExecution((event) => {
      const captured: CapturedExecution = {
        commandLine: event.execution.commandLine.value,
        confidence: event.execution.commandLine.confidence,
        outputPromise: captureOutput(event.execution)
      };
      executionCapture.set(event.execution, captured);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidEndTerminalShellExecution(async (event) => {
      const captured = executionCapture.get(event.execution);
      if (!captured) {
        return;
      }

      const output = await captured.outputPromise;
      const config = getConfig();
      const failure = classifyTerminalFailure({
        commandLine: captured.commandLine,
        exitCode: event.exitCode,
        output,
        mode: config.reactionMode as ReactionMode,
        confidence: captured.confidence
      });

      if (!failure) {
        return;
      }

      const suggestion = await suggestCorrection({
        kind: failure.kind,
        commandLine: captured.commandLine,
        output,
        workspaceFolders: vscode.workspace.workspaceFolders
      });

      const entry: FaahHistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: Date.now(),
        commandLine: captured.commandLine,
        kind: failure.kind,
        exitCode: event.exitCode,
        message: failure.message,
        suggestion
      };

      failure.suggestion = suggestion;

      await historyStore.add(entry);
      historyProvider.refresh();
      await reactToFailure(failure);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("faah.playTestSound", async () => {
      const result = await playFaahSound(context);
      if (!result.played) {
        vscode.window.showWarningMessage("Faah sound test could not find a native audio player.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("faah.toggleEnabled", async () => {
      const config = vscode.workspace.getConfiguration("faah");
      const enabled = config.get<boolean>("enabled", true);
      await config.update("enabled", !enabled, vscode.ConfigurationTarget.Global);
      updateStatusBar();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("faah.openSettings", async () => {
      await vscode.commands.executeCommand("workbench.action.openSettings", "faah");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("faah.showHistory", async () => {
      await vscode.commands.executeCommand("workbench.view.explorer");
      historyProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("faah.clearHistory", async () => {
      const choice = await vscode.window.showWarningMessage("Clear all Faah history entries?", "Clear", "Cancel");
      if (choice !== "Clear") {
        return;
      }

      await historyStore.clear();
      historyProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("faah.inspectHistoryEntry", async (entry: FaahHistoryEntry) => {
      const lines = [
        `Command: ${entry.commandLine}`,
        `Kind: ${entry.kind}`,
        entry.exitCode === undefined ? undefined : `Exit code: ${entry.exitCode}`,
        `Time: ${new Date(entry.timestamp).toLocaleString()}`,
        `Message: ${entry.message}`,
        entry.suggestion ? `Suggestion: ${entry.suggestion}` : undefined
      ].filter(Boolean);

      const action = await vscode.window.showInformationMessage(lines.join("\n"), "Copy Command", "Copy Suggestion");
      if (action === "Copy Command") {
        await vscode.env.clipboard.writeText(entry.commandLine);
      } else if (action === "Copy Suggestion" && entry.suggestion) {
        await vscode.env.clipboard.writeText(entry.suggestion);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("faah")) {
        updateStatusBar();
      }
    })
  );

  updateStatusBar();
}

export function deactivate(): void {
  // No teardown needed. Status bar and listeners are disposed with the extension context.
}

function getConfig() {
  const config = vscode.workspace.getConfiguration("faah");

  return {
    enabled: config.get<boolean>("enabled", true),
    reactionMode: config.get<ReactionMode>("reactionMode", "smart"),
    soundEnabled: config.get<boolean>("sound.enabled", true),
    fallbackToNotification: config.get<boolean>("sound.fallbackToNotification", true),
    cooldownMs: config.get<number>("cooldownMs", 1800)
  };
}

async function captureOutput(execution: vscode.TerminalShellExecution): Promise<string> {
  let output = "";

  try {
    for await (const chunk of execution.read()) {
      output += chunk;
      if (output.length > 4000) {
        output = output.slice(-4000);
      }
    }
  } catch {
    // Shell integration can end abruptly on terminal shutdown or sub-shell changes.
  }

  return output;
}
