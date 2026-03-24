import * as vscode from "vscode";
import { FailureKind } from "./classifier";

export interface FaahHistoryEntry {
  id: string;
  timestamp: number;
  commandLine: string;
  kind: FailureKind;
  exitCode?: number;
  message: string;
  suggestion?: string;
}

const HISTORY_KEY = "faah.history.entries";
const MAX_HISTORY_ITEMS = 30;

export class FaahHistoryStore {
  constructor(private readonly state: vscode.Memento) {}

  async add(entry: FaahHistoryEntry): Promise<void> {
    const entries = this.getEntries();
    entries.unshift(entry);
    await this.state.update(HISTORY_KEY, entries.slice(0, MAX_HISTORY_ITEMS));
  }

  getEntries(): FaahHistoryEntry[] {
    return this.state.get<FaahHistoryEntry[]>(HISTORY_KEY, []);
  }

  async clear(): Promise<void> {
    await this.state.update(HISTORY_KEY, []);
  }
}

export class FaahHistoryProvider implements vscode.TreeDataProvider<FaahHistoryItem> {
  private readonly emitter = new vscode.EventEmitter<void>();

  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly store: FaahHistoryStore) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: FaahHistoryItem): vscode.TreeItem {
    return element;
  }

  getChildren(): FaahHistoryItem[] {
    const entries = this.store.getEntries();
    if (entries.length === 0) {
      return [new FaahHistoryItem("No failures recorded yet", vscode.TreeItemCollapsibleState.None, {
        description: "Faah will populate this list after a terminal failure.",
        command: undefined
      })];
    }

    return entries.map((entry) => new FaahHistoryItem(formatLabel(entry), vscode.TreeItemCollapsibleState.None, {
      description: formatDescription(entry),
      tooltip: formatTooltip(entry),
      command: {
        command: "faah.inspectHistoryEntry",
        title: "Inspect Faah history entry",
        arguments: [entry]
      }
    }));
  }
}

export class FaahHistoryItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options: {
      description?: string;
      tooltip?: string | vscode.MarkdownString;
      command?: vscode.Command;
    }
  ) {
    super(label, collapsibleState);
    this.description = options.description;
    this.tooltip = options.tooltip;
    this.command = options.command;
  }
}

function formatLabel(entry: FaahHistoryEntry): string {
  const command = summarizeCommand(entry.commandLine);
  return command || "Unknown command";
}

function formatDescription(entry: FaahHistoryEntry): string {
  const timestamp = new Date(entry.timestamp).toLocaleString();
  const parts = [entry.kind, timestamp];
  if (entry.exitCode !== undefined) {
    parts.unshift(`exit ${entry.exitCode}`);
  }
  return parts.join(" | ");
}

function formatTooltip(entry: FaahHistoryEntry): string {
  const lines = [
    `Command: ${entry.commandLine}`,
    `Kind: ${entry.kind}`,
    entry.exitCode === undefined ? undefined : `Exit code: ${entry.exitCode}`,
    `Time: ${new Date(entry.timestamp).toLocaleString()}`,
    `Message: ${entry.message}`,
    entry.suggestion ? `Suggestion: ${entry.suggestion}` : undefined
  ].filter(Boolean);

  return lines.join("\n");
}

function summarizeCommand(commandLine: string): string {
  const trimmed = commandLine.trim();
  if (trimmed.length <= 48) {
    return trimmed;
  }

  return `${trimmed.slice(0, 45)}...`;
}
