import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { docker } from '@ai-hero/sandcastle/sandboxes/docker';
import { prepareVibeHome } from './VibeHome.js';
export function prepareCodexHome(repoDir) {
    const codexHome = join(repoDir, '.sandcastle', 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    const hostAuth = join(homedir(), '.codex', 'auth.json');
    const sandboxAuth = join(codexHome, 'auth.json');
    if (existsSync(hostAuth) && !existsSync(sandboxAuth)) {
        copyFileSync(hostAuth, sandboxAuth);
    }
    return codexHome;
}
export function codexAuthMounts(repoDir) {
    return [{
            hostPath: prepareCodexHome(repoDir),
            sandboxPath: '/home/agent/.codex',
            readonly: false,
        }];
}
export function vibeAuthMounts(repoDir) {
    return [{
            hostPath: prepareVibeHome(repoDir),
            sandboxPath: '/home/agent/.vibe',
            readonly: false,
        }];
}
export function agentsSkillsMounts(repoDir) {
    const agentsDir = join(repoDir, '.agents');
    if (!existsSync(agentsDir)) {
        return [];
    }
    return [{
            hostPath: agentsDir,
            sandboxPath: '.agents',
            readonly: false,
        }];
}
export function gitWorktreeMounts(repoDir, branch) {
    const gitDir = resolveGitCommonDir(repoDir);
    if (!gitDir) {
        return [];
    }
    const worktreeName = branch.replace(/\//g, '-');
    const overrideDir = join(repoDir, '.sandcastle', 'git-overrides');
    mkdirSync(overrideDir, { recursive: true });
    const overrideFile = join(overrideDir, `${worktreeName}.git`);
    writeFileSync(overrideFile, `gitdir: /.sandcastle-parent-git/worktrees/${worktreeName}\n`, 'utf8');
    return [
        {
            hostPath: gitDir,
            sandboxPath: '/.sandcastle-parent-git',
            readonly: false,
        },
        {
            hostPath: overrideFile,
            sandboxPath: '/home/agent/workspace/.git',
            readonly: true,
        },
    ];
}
export function buildSandboxMounts(config, cwd, branch) {
    const mounts = [...agentsSkillsMounts(cwd)];
    if (branch) {
        mounts.push(...gitWorktreeMounts(cwd, branch));
    }
    if (config.provider === 'codex') {
        mounts.push(...codexAuthMounts(cwd));
    }
    if (config.provider === 'vibe') {
        mounts.push(...vibeAuthMounts(cwd));
    }
    return mounts;
}
export function createDockerSandboxProvider(config, cwd, branch) {
    return docker({
        imageName: config.imageName,
        cpus: config.cpus ?? 2,
        mounts: buildSandboxMounts(config, cwd, branch),
    });
}
function resolveGitCommonDir(repoDir) {
    try {
        return execFileSync('git', ['-C', repoDir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    }
    catch {
        const fallback = join(repoDir, '.git');
        return existsSync(fallback) ? fallback : undefined;
    }
}
//# sourceMappingURL=SandboxMounts.js.map