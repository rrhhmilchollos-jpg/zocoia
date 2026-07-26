/**
 * manus-agent/tools/github.ts
 *
 * Integración real con GitHub:
 *  - Clona el repo destino en el workspace local de la tarea.
 *  - Crea una rama de trabajo.
 *  - Hace commit y push de los cambios que el agente escribió en disco.
 *  - Opcionalmente abre un Pull Request en vez de empujar directo a main.
 *
 * Requiere:  npm install simple-git @octokit/rest
 */

import { simpleGit, SimpleGit } from "simple-git";
import { Octokit } from "@octokit/rest";
import { promises as fs } from "fs";
import path from "path";

export class GitHubToolError extends Error {}

export interface ParsedRepo {
  owner: string;
  name: string;
}

/** Acepta https://github.com/owner/repo, con o sin .git, con o sin barra final. */
export function parseRepoUrl(repoUrl: string): ParsedRepo {
  const match = repoUrl
    .trim()
    .match(/github\.com[/:]([^/]+)\/([^/#?]+?)(\.git)?\/?$/i);
  if (!match) {
    throw new GitHubToolError(`URL de repositorio de GitHub no válida: ${repoUrl}`);
  }
  return { owner: match[1], name: match[2] };
}

export interface CloneOptions {
  repoUrl: string;
  workspaceDir: string;
  token: string;
  baseBranch?: string; // si no se indica, usa la rama por defecto del repo
}

export interface CloneResult {
  workspaceDir: string;
  baseBranch: string;
  workBranch: string;
}

/** Clona el repo en el workspace y crea/checkout de la rama de trabajo del agente. */
export async function cloneRepo(opts: CloneOptions): Promise<CloneResult> {
  const { owner, name } = parseRepoUrl(opts.repoUrl);
  await fs.mkdir(opts.workspaceDir, { recursive: true });

  // Inserta el token en la URL de clonado (nunca se loguea ni se devuelve al cliente).
  const authUrl = `https://x-access-token:${opts.token}@github.com/${owner}/${name}.git`;

  const git: SimpleGit = simpleGit();
  await git.clone(authUrl, opts.workspaceDir, ["--depth", "50"]);

  const repoGit = simpleGit(opts.workspaceDir);
  // Oculta cualquier rastro del token en el remoto guardado localmente.
  await repoGit.remote(["set-url", "origin", `https://github.com/${owner}/${name}.git`]);

  const baseBranch =
    opts.baseBranch || (await repoGit.revparse(["--abbrev-ref", "HEAD"])).trim();

  const workBranch = `manus-agent/${Date.now()}`;
  await repoGit.checkoutLocalBranch(workBranch);

  return { workspaceDir: opts.workspaceDir, baseBranch, workBranch };
}

export interface CommitAndPushOptions {
  workspaceDir: string;
  workBranch: string;
  token: string;
  repoUrl: string;
  commitMessage: string;
  authorName?: string;
  authorEmail?: string;
}

export interface CommitAndPushResult {
  commit_sha: string | null;
  branch: string;
  had_changes: boolean;
}

/** Hace `git add -A`, commit (si hay cambios) y push de la rama de trabajo. */
export async function commitAndPush(
  opts: CommitAndPushOptions
): Promise<CommitAndPushResult> {
  const { owner, name } = parseRepoUrl(opts.repoUrl);
  const git = simpleGit(opts.workspaceDir);

  await git.addConfig("user.name", opts.authorName || "Zoco IA Agent");
  await git.addConfig("user.email", opts.authorEmail || "agent@zocoia.es");

  await git.add(["-A"]);
  const status = await git.status();
  if (status.staged.length === 0 && status.files.length === 0) {
    return { commit_sha: null, branch: opts.workBranch, had_changes: false };
  }

  const commitResult = await git.commit(opts.commitMessage);

  const authUrl = `https://x-access-token:${opts.token}@github.com/${owner}/${name}.git`;
  await git.push(authUrl, opts.workBranch, ["--set-upstream"]);

  return {
    commit_sha: commitResult.commit || null,
    branch: opts.workBranch,
    had_changes: true,
  };
}

export interface CreatePullRequestOptions {
  repoUrl: string;
  token: string;
  baseBranch: string;
  workBranch: string;
  title: string;
  body: string;
}

export interface CreatePullRequestResult {
  pull_request_url: string;
  number: number;
}

/** Abre un PR de workBranch -> baseBranch usando la API REST de GitHub. */
export async function createPullRequest(
  opts: CreatePullRequestOptions
): Promise<CreatePullRequestResult> {
  const { owner, name } = parseRepoUrl(opts.repoUrl);
  const octokit = new Octokit({ auth: opts.token });

  const { data } = await octokit.pulls.create({
    owner,
    repo: name,
    title: opts.title,
    body: opts.body,
    head: opts.workBranch,
    base: opts.baseBranch,
  });

  return { pull_request_url: data.html_url, number: data.number };
}

/** Empuja directamente a la rama base (sin PR). Útil en modo "auto" de confianza alta. */
export async function pushDirectlyToBase(opts: {
  workspaceDir: string;
  baseBranch: string;
  workBranch: string;
  repoUrl: string;
  token: string;
}): Promise<{ pushed: boolean }> {
  const { owner, name } = parseRepoUrl(opts.repoUrl);
  const git = simpleGit(opts.workspaceDir);
  const authUrl = `https://x-access-token:${opts.token}@github.com/${owner}/${name}.git`;
  await git.push(authUrl, `${opts.workBranch}:${opts.baseBranch}`);
  return { pushed: true };
}

/** Limpieza: borra el workspace local del disco tras terminar (o fallar) la tarea. */
export async function cleanupWorkspace(workspaceDir: string): Promise<void> {
  await fs.rm(workspaceDir, { recursive: true, force: true });
}

/** Utilidad para el resumen del diff, usada al construir el FileChange para el panel. */
export async function readFileIfExists(
  fullPath: string
): Promise<string | undefined> {
  try {
    return await fs.readFile(fullPath, "utf-8");
  } catch {
    return undefined;
  }
}

export function guessLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".json": "json",
    ".md": "markdown",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".css": "css",
    ".html": "html",
    ".py": "python",
    ".sql": "sql",
  };
  return map[ext] || "text";
}
