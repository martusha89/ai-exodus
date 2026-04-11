/**
 * Claude CLI wrapper
 * Uses `claude --print` — runs on Max subscription, zero extra cost
 * System prompts via temp files (avoids Windows arg length limits)
 * Conversation chunks via stdin
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

/**
 * Find the claude CLI path
 */
async function findClaude() {
  const { execSync } = await import('node:child_process');

  // First: just try running "claude" — let the shell resolve it
  // This works regardless of how/where it was installed
  try {
    execSync('claude --version', { stdio: 'pipe', shell: true, timeout: 10000 });
    return 'claude';
  } catch {}

  // Windows: try common install locations
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (process.platform === 'win32') {
    const winPaths = [
      join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'claude.exe'),
      join(home, '.npm-global', 'bin', 'claude.cmd'),
      join(home, '.npm-global', 'claude.cmd'),
      join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
    ];
    for (const p of winPaths) {
      if (existsSync(p)) return p;
    }

    // Try where command (finds .cmd, .exe, .ps1)
    try {
      const result = execSync('where claude', { stdio: 'pipe', shell: true, timeout: 5000 });
      const found = result.toString().trim().split('\n')[0].trim();
      if (found) return found;
    } catch {}
  } else {
    // Unix
    const unixPaths = ['/usr/local/bin/claude', join(home, '.npm-global', 'bin', 'claude')];
    for (const p of unixPaths) {
      if (existsSync(p)) return p;
    }
    try {
      const result = execSync('which claude', { stdio: 'pipe', timeout: 5000 });
      const found = result.toString().trim();
      if (found) return found;
    } catch {}
  }

  // Last resort — return 'claude' and let it fail with a clear error at call time
  return 'claude';
}

let claudePath = null;
async function getClaude() {
  if (!claudePath) claudePath = await findClaude();
  return claudePath;
}

/**
 * Write string to a temp file, return path
 */
async function writeTempFile(content) {
  const name = `exodus-${randomBytes(6).toString('hex')}.txt`;
  const path = join(tmpdir(), name);
  await writeFile(path, content, 'utf-8');
  return path;
}

/**
 * Call Claude via CLI
 * System prompt → temp file (--system-prompt-file)
 * Prompt → stdin pipe
 */
export async function callClaude({ system, prompt, model }) {
  const claude = await getClaude();
  const args = ['--print'];

  let sysFile = null;

  if (system) {
    sysFile = await writeTempFile(system);
    args.push('--system-prompt-file', sysFile);
  }

  if (model) {
    args.push('--model', model);
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const proc = spawn(claude, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: tmpdir(), // avoid picking up CLAUDE.md from home/project dirs
        shell: process.platform === 'win32', // Windows needs shell to resolve .cmd files
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('error', (err) => {
        if (err.code === 'ENOENT') {
          reject(new Error(
            'Claude Code CLI not found. Install it first:\n' +
            '  npm install -g @anthropic-ai/claude-code\n' +
            'Then log in: claude login'
          ));
        } else {
          reject(err);
        }
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          const errMsg = stderr.trim() || stdout.trim() || '(no output)';
          reject(new Error(`Claude CLI exited with code ${code}: ${errMsg}`));
        } else {
          resolve(stdout.trim());
        }
      });

      // Pipe prompt via stdin
      proc.stdin.write(prompt);
      proc.stdin.end();
    });

    return result;

  } finally {
    // Clean up temp file
    if (sysFile) {
      await unlink(sysFile).catch(() => {});
    }
  }
}

/**
 * Check that Claude CLI is available and logged in
 */
export async function checkCLI() {
  try {
    const claude = await getClaude();
    return await new Promise((resolve) => {
      const proc = spawn(claude, ['--version'], { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
      let stdout = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.on('error', () => resolve({ ok: false, error: 'Claude Code CLI not found' }));
      proc.on('close', (code) => {
        resolve(code === 0
          ? { ok: true, version: stdout.trim() }
          : { ok: false, error: 'Claude Code CLI not responding' }
        );
      });
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
