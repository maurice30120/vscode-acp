import { existsSync } from 'node:fs';

export interface ResolvedUnixShell {
  shell: string;
  useLoginFlag: boolean;
}

export interface SpawnCommandSpec {
  file: string;
  args: string[];
  shell?: boolean;
  shellName?: string;
  useLoginFlag?: boolean;
}

interface ResolveUnixShellOptions {
  userShell?: string;
  pathExists?: (path: string) => boolean;
  onUnsupportedShell?: (userShell: string) => void;
}

interface BuildSpawnCommandSpecOptions extends ResolveUnixShellOptions {
  platform?: NodeJS.Platform;
}

/**
 * Escape a single argument for safe inclusion in a shell command string.
 * Wraps in single quotes, escaping any embedded single quotes.
 */
export function shellEscape(arg: string): string {
  // Replace ' with '\'' (end quote, escaped quote, start quote)
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Determine the appropriate shell and whether it supports the -l (login) flag
 * on macOS/Linux. A login shell sources the user's shell startup files so that
 * PATH includes user-installed tool directories.
 *
 * Shell support:
 *   zsh, bash, ksh  ->  -l supported
 *   fish, sh, dash  ->  use as-is without -l
 *   csh, tcsh, etc. ->  not POSIX-compatible; fall back to bash or /bin/sh
 */
export function resolveUnixShell(options: ResolveUnixShellOptions = {}): ResolvedUnixShell {
  const {
    userShell = process.env.SHELL,
    pathExists = existsSync,
    onUnsupportedShell,
  } = options;

  if (userShell) {
    const base = userShell.split('/').pop() || '';

    if (['zsh', 'bash', 'ksh'].includes(base)) {
      return { shell: userShell, useLoginFlag: true };
    }

    if (['fish', 'sh', 'dash'].includes(base)) {
      return { shell: userShell, useLoginFlag: false };
    }

    onUnsupportedShell?.(userShell);
  }

  if (pathExists('/bin/bash')) {
    return { shell: '/bin/bash', useLoginFlag: true };
  }
  if (pathExists('/usr/bin/bash')) {
    return { shell: '/usr/bin/bash', useLoginFlag: true };
  }
  return { shell: '/bin/sh', useLoginFlag: false };
}

export function buildSpawnCommandSpec(
  command: string,
  args: string[] = [],
  options: BuildSpawnCommandSpecOptions = {},
): SpawnCommandSpec {
  if (command.trim().length === 0) {
    throw new Error('Command must be a non-empty string');
  }

  const {
    platform = process.platform,
    userShell,
    pathExists,
    onUnsupportedShell,
  } = options;

  if (platform === 'win32') {
    return {
      file: command,
      args,
      shell: true,
    };
  }

  const { shell, useLoginFlag } = resolveUnixShell({
    userShell,
    pathExists,
    onUnsupportedShell,
  });
  const commandStr = [command, ...args].map(shellEscape).join(' ');

  return {
    file: shell,
    args: useLoginFlag ? ['-l', '-c', commandStr] : ['-c', commandStr],
    shellName: shell.split('/').pop() || shell,
    useLoginFlag,
  };
}
