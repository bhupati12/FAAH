import * as vscode from "vscode";

export type ReactionMode = "smart" | "allFailures" | "off";

export type FailureKind = "commandNotFound" | "permissionDenied" | "missingFile" | "unknown";

export interface ClassifiedFailure {
  kind: FailureKind;
  commandName: string;
  exitCode?: number;
  outputSnippet: string;
  message: string;
  suggestion?: string;
}

const COMMAND_NOT_FOUND_PATTERNS: RegExp[] = [
  /command not found/i,
  /is not recognized as an internal or external command/i,
  /the term .* is not recognized/i,
  /could not be found/i,
  /\bnot found\b/i
];

const PERMISSION_DENIED_PATTERNS: RegExp[] = [/permission denied/i, /access is denied/i, /unauthorized/i];

const MISSING_FILE_PATTERNS: RegExp[] = [/no such file or directory/i, /cannot find the path/i, /cannot find path/i];

export function classifyTerminalFailure(input: {
  commandLine: string;
  exitCode?: number;
  output: string;
  mode: ReactionMode;
  confidence?: vscode.TerminalShellExecutionCommandLineConfidence;
}): ClassifiedFailure | undefined {
  if (input.mode === "off") {
    return undefined;
  }

  if (input.exitCode === 0) {
    return undefined;
  }

  const normalizedOutput = normalizeText(input.output);
  const commandName = extractCommandName(input.commandLine);
  const outputSnippet = trimSnippet(normalizedOutput);

  const kind = detectFailureKind(normalizedOutput, input.exitCode);

  if (
    input.mode === "smart" &&
    kind === "unknown" &&
    input.confidence === vscode.TerminalShellExecutionCommandLineConfidence.Low
  ) {
    return undefined;
  }

  const message = buildMessage(kind, commandName, input.exitCode);

  return {
    kind,
    commandName,
    exitCode: input.exitCode,
    outputSnippet,
    message
  };
}

function detectFailureKind(output: string, exitCode?: number): FailureKind {
  if (exitCode === 127 || exitCode === 9009) {
    return "commandNotFound";
  }

  if (COMMAND_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(output))) {
    return "commandNotFound";
  }

  if (PERMISSION_DENIED_PATTERNS.some((pattern) => pattern.test(output))) {
    return "permissionDenied";
  }

  if (MISSING_FILE_PATTERNS.some((pattern) => pattern.test(output))) {
    return "missingFile";
  }

  return "unknown";
}

function buildMessage(kind: FailureKind, commandName: string, exitCode?: number): string {
  switch (kind) {
    case "commandNotFound":
      return `Faah: ${commandName || "that command"} was not found.`;
    case "permissionDenied":
      return `Faah: ${commandName || "that command"} was blocked by permissions.`;
    case "missingFile":
      return `Faah: ${commandName || "that command"} could not find a file or path.`;
    case "unknown":
    default:
      return exitCode === undefined ? "Faah: the command failed." : `Faah: the command exited with code ${exitCode}.`;
  }
}

function extractCommandName(commandLine: string): string {
  const trimmed = commandLine.trim();
  if (!trimmed) {
    return "";
  }

  const parts = trimmed.split(/\s+/);
  const first = parts[0] ?? "";

  if (first === "&" && parts.length > 1) {
    return stripQuotes(parts[1]);
  }

  return stripQuotes(first);
}

function stripQuotes(value: string): string {
  return value.replace(/^['"`]+/, "").replace(/['"`]+$/, "");
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function trimSnippet(text: string, maxLength = 220): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}
