/**
 * manus-agent/tools/github.js
 *
 * Integración real con GitHub: clona el repo destino, crea una rama de
 * trabajo, hace commit y push de los cambios, y opcionalmente abre un
 * Pull Request en vez de empujar directo a la rama base.
 *
 * Requiere:  npm install simple-git @octokit/rest
 */

import { simpleGit } from 'simple-git';
import { Octokit } from '@octokit/rest';
import { promises as fs } from 'fs';
import path from 'path';

export class GitHubToolError extends Error {}

/** Acepta https://github.com/owner/repo, con o sin .git, con o sin barra final. */
export function parseRepoUrl(repoUrl) {
  const match = repoUrl.trim().match(/github\.com[/:]([^/]+)\/([^/#?]+?)(\.git)?\/?$/i);
  if (!match) {
    throw new GitHubToolError(`URL de repositorio de GitHub no válida: ${repoUrl}`);
  }
  return { owner: match[1], name: match[2] };
}

/** Clona el repo en el workspace y crea/checkout de la rama de trabajo del agente. */
export async function cloneRepo({ repoUrl, workspaceDir, token, baseBranch }) {
  const { owner, name } = parseRepoUrl(repoUrl);
  await fs.mkdir(workspaceDir, { recursive: true });

  const authUrl = `https://x-access-token:${token}@github.com/${owner}/${name}.git`;

  const git = simpleGit();
  await git.clone(authUrl, workspaceDir, ['--depth', '50']);

  const repoGit = simpleGit(workspaceDir);
  await repoGit.remote(['set-url', 'origin', `https://github.com/${owner}/${name}.git`]);

  const resolvedBaseBranch =
    baseBranch || (await repoGit.revparse(['--abbrev-ref', 'HEAD'])).trim();

  const workBranch = `manus-agent/${Date.now()}`;
  await repoGit.checkoutLocalBranch(workBranch);

  return { workspaceDir, baseBranch: resolvedBaseBranch, workBranch };
}

/** Hace `git add -A`, commit (si hay cambios) y push de la rama de trabajo. */
export async function commitAndPush({
  workspaceDir,
  workBranch,
  token,
  repoUrl,
  commitMessage,
  authorName,
  authorEmail,
}) {
  const { owner, name } = parseRepoUrl(repoUrl);
  const git = simpleGit(workspaceDir);

  await git.addConfig('user.name', authorName || 'Zoco IA Agent');
  await git.addConfig('user.email', authorEmail || 'agent@zocoia.es');

  await git.add(['-A']);
  const status = await git.status();
  if (status.staged.length === 0 && status.files.length === 0) {
    return { commit_sha: null, branch: workBranch, had_changes: false };
  }

  const commitResult = await git.commit(commitMessage);

  const authUrl = `https://x-access-token:${token}@github.com/${owner}/${name}.git`;
  await git.push(authUrl, workBranch, ['--set-upstream']);

  return { commit_sha: commitResult.commit || null, branch: workBranch, had_changes: true };
}

/** Abre un PR de workBranch -> baseBranch usando la API REST de GitHub. */
export async function createPullRequest({ repoUrl, token, baseBranch, workBranch, title, body }) {
  const { owner, name } = parseRepoUrl(repoUrl);
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.pulls.create({
    owner,
    repo: name,
    title,
    body,
    head: workBranch,
    base: baseBranch,
  });

  return { pull_request_url: data.html_url, number: data.number };
}

/** Empuja directamente a la rama base (sin PR). Solo para flujos de confianza alta. */
export async function pushDirectlyToBase({ workspaceDir, baseBranch, workBranch, repoUrl, token }) {
  const { owner, name } = parseRepoUrl(repoUrl);
  const git = simpleGit(workspaceDir);
  const authUrl = `https://x-access-token:${token}@github.com/${owner}/${name}.git`;
  await git.push(authUrl, `${workBranch}:${baseBranch}`);
  return { pushed: true };
}

/** Limpieza: borra el workspace local del disco tras terminar (o fallar) la tarea. */
export async function cleanupWorkspace(workspaceDir) {
  await fs.rm(workspaceDir, { recursive: true, force: true });
}

export async function readFileIfExists(fullPath) {
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch {
    return undefined;
  }
}

export function guessLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.json': 'json',
    '.md': 'markdown',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.css': 'css',
    '.html': 'html',
    '.py': 'python',
    '.sql': 'sql',
  };
  return map[ext] || 'text';
}
