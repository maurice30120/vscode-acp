import { RequestError } from '@agentclientprotocol/sdk';

import type { ConnectionInfo } from './connectionManager.js';
import type { PiPermissionContext } from '../types.js';

export class SessionAuthHandler {
  constructor(
    private readonly killAgent: (agentId: string) => void,
    private readonly getPermissionContext: () => PiPermissionContext | undefined,
  ) {}

  isAuthRequiredError(error: unknown): boolean {
    return (error instanceof RequestError && error.code === -32000)
      || (isRecord(error) && error.code === -32000)
      || (isRecord(error) && typeof error.message === 'string' && /auth.?required/i.test(error.message));
  }

  async runAuthFlow(
    agentName: string,
    agentId: string,
    connInfo: ConnectionInfo,
  ): Promise<void> {
    const authMethods = connInfo.initResponse.authMethods;
    if (!authMethods || authMethods.length === 0) {
      this.killAgent(agentId);
      throw new Error(`Agent "${agentName}" requires authentication but did not advertise any auth methods.`);
    }

    const ctx = this.getPermissionContext();
    if (!ctx?.hasUI) {
      this.killAgent(agentId);
      throw new Error(`Agent "${agentName}" requires authentication, but Pi UI is not available.`);
    }

    let selectedMethod = authMethods[0];
    if (authMethods.length > 1) {
      const labels = authMethods.map(method => `${method.name} [${method.id}]`);
      const selected = await ctx.ui.select(`${agentName} authentication`, labels);
      if (!selected) {
        this.killAgent(agentId);
        throw new Error('Authentication cancelled by user.');
      }
      const index = labels.indexOf(selected);
      selectedMethod = authMethods[index] ?? authMethods[0];
    } else {
      const ok = await ctx.ui.confirm(
        `${agentName} authentication`,
        `Authenticate with "${selectedMethod.name}"?${selectedMethod.description ? `\n${selectedMethod.description}` : ''}`,
      );
      if (!ok) {
        this.killAgent(agentId);
        throw new Error('Authentication cancelled by user.');
      }
    }

    await connInfo.connection.authenticate({ methodId: selectedMethod.id });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
