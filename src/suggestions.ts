import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { FailureKind } from "./classifier";

const COMMON_COMMANDS = [
  "git",
  "npm",
  "npx",
  "node",
  "pnpm",
  "yarn",
  "bun",
  "python",
  "python3",
  "pip",
  "dotnet",
  "cargo",
  "go",
  "make",
  "docker",
  "kubectl",
  "java",
  "javac"
];

export async function suggestCorrection(input: {
  kind: FailureKind;
  commandLine: string;
  output: string;
  workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;
}): Promise<string | undefined> {
  if (input.kind !== "commandNotFound") {
    return undefined;
  }

  const shellSuggestion = suggestShellCommand(input.commandLine);
  if (shellSuggestion) {
    return shellSuggestion;
  }

  const scriptSuggestion = await suggestWorkspaceScript(input.commandLine, input.output, input.workspaceFolders);
  if (scriptSuggestion) {
    return scriptSuggestion;
  }

  return undefined;
}

function suggestShellCommand(commandLine: string): string | undefined {
  const commandName = extractPrimaryToken(commandLine).toLowerCase();
  if (!commandName) {
    return undefined;
  }

  const closest = findClosestMatch(commandName, COMMON_COMMANDS);
  if (!closest) {
    return undefined;
  }

  return `Did you mean \`${closest}\`?`;
}

async function suggestWorkspaceScript(
  commandLine: string,
  output: string,
  workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined
): Promise<string | undefined> {
  const missingScript = output.match(/missing script:\s*["']?([^"'\n]+)["']?/i)?.[1]?.trim();
  const isPackageManagerRun = /\b(npm|pnpm|yarn|bun)\b.*\brun\b/i.test(commandLine);

  if (!missingScript && !isPackageManagerRun) {
    return undefined;
  }

  const scripts = await collectWorkspaceScripts(workspaceFolders);
  if (scripts.length === 0) {
    return undefined;
  }

  if (missingScript) {
    const closest = findClosestMatch(missingScript.toLowerCase(), scripts.map((script) => script.toLowerCase()));
    if (closest) {
      return `Faah thinks your script was close to \`${closest}\`.`;
    }
  }

  if (scripts.length === 1) {
    return `Try \`npm run ${scripts[0]}\`.`;
  }

  return `Available scripts: ${scripts.slice(0, 5).map((script) => `\`${script}\``).join(", ")}.`;
}

async function collectWorkspaceScripts(
  workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined
): Promise<string[]> {
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return [];
  }

  const scripts = new Set<string>();

  for (const folder of workspaceFolders) {
    const filePath = path.join(folder.uri.fsPath, "package.json");
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
      for (const scriptName of Object.keys(parsed.scripts ?? {})) {
        scripts.add(scriptName);
      }
    } catch {
      // Ignore missing package.json or parse errors.
    }
  }

  return [...scripts].sort((left, right) => left.localeCompare(right));
}

function extractPrimaryToken(commandLine: string): string {
  const trimmed = commandLine.trim();
  if (!trimmed) {
    return "";
  }

  const parts = trimmed.split(/\s+/);
  if (parts[0] === "&" && parts.length > 1) {
    return stripQuotes(parts[1]);
  }

  return stripQuotes(parts[0] ?? "");
}

function stripQuotes(value: string): string {
  return value.replace(/^['"`]+/, "").replace(/['"`]+$/, "");
}

function findClosestMatch(target: string, candidates: readonly string[]): string | undefined {
  let bestCandidate: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const score = levenshteinDistance(target, candidate.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate && bestScore <= Math.max(2, Math.floor(target.length / 3))) {
    return bestCandidate;
  }

  return undefined;
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }

  if (right.length === 0) {
    return left.length;
  }

  const matrix: number[][] = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));

  for (let i = 0; i <= left.length; i += 1) {
    matrix[i]![0] = i;
  }

  for (let j = 0; j <= right.length; j += 1) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j] + 1,
        matrix[i]![j - 1] + 1,
        matrix[i - 1]![j - 1] + substitutionCost
      );
    }
  }

  return matrix[left.length]![right.length]!;
}
