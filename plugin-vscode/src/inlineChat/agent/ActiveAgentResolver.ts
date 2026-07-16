import { getAgentConfig } from '../../config/AgentConfig';
import {
  isVirtualAgentName,
  listSelectableAgentNames,
  resolveAgent,
} from '../../config/VirtualAgentCatalog';

export type RunnableInlineAgent = {
  name: string;
  displayName: string;
};

export interface ActiveAgentResolver {
  resolveRunnableAgent(): RunnableInlineAgent;
}

export class SessionBackedActiveAgentResolver implements ActiveAgentResolver {
  constructor(
    private readonly workspaceCwd: () => string,
    private readonly getActiveAgentName: () => string | undefined,
  ) {}

  resolveRunnableAgent(): RunnableInlineAgent {
    const cwd = this.workspaceCwd();
    const activeName = this.getActiveAgentName();

    if (activeName && !isVirtualAgentName(activeName, cwd)) {
      return this.toRunnable(activeName, cwd);
    }

    const fallback = listSelectableAgentNames(cwd).find(
      name => resolveAgent(name, cwd)?.kind === 'configured',
    );
    if (!fallback) {
      throw new Error('No ACP agent configured. Add agents in .acp/acp-agents.json.');
    }
    return this.toRunnable(fallback, cwd);
  }

  private toRunnable(name: string, cwd: string): RunnableInlineAgent {
    const cfg = getAgentConfig(name, cwd);
    return { name, displayName: cfg?.displayName ?? name };
  }
}
