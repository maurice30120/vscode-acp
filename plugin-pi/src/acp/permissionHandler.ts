import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';

import type { PiPermissionContext } from '../types.js';

const CANCELLED: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } };

export class PermissionHandler {
  constructor(
    private readonly getContext: () => PiPermissionContext | undefined,
    private readonly options: { autoApproveAll?: boolean } = {},
  ) {}

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    if (this.options.autoApproveAll) {
      const option = params.options.find(candidate => candidate.kind === 'allow_once') ?? params.options[0];
      if (option) {
        return {
          outcome: {
            outcome: 'selected',
            optionId: option.optionId,
          },
        };
      }
    }

    const ctx = this.getContext();
    if (!ctx?.hasUI) {
      return CANCELLED;
    }

    const labels = params.options.map(option => `${option.name} [${option.kind}]`);
    const selected = await ctx.ui.select(
      params.toolCall?.title ?? 'ACP permission request',
      labels,
    );
    if (!selected) {
      return CANCELLED;
    }

    const index = labels.indexOf(selected);
    const option = index >= 0 ? params.options[index] : undefined;
    if (!option) {
      return CANCELLED;
    }

    return {
      outcome: {
        outcome: 'selected',
        optionId: option.optionId,
      },
    };
  }
}
