import type { JSX } from 'react';

import type { PipelineActivityItem } from '../app/OrchestrationProjector';

export interface PipelineActivityLineProps {
  item: PipelineActivityItem | null;
}

export function PipelineActivityLine({ item }: PipelineActivityLineProps): JSX.Element | null {
  if (!item) {
    return null;
  }

  const label = item.agentName ? `${item.role} · ${item.agentName}` : item.role;
  return (
    <div className="pipeline-activity-line">
      <span className="pipeline-activity-dot" />
      <span className="pipeline-activity-label">{label}</span>
      <span className="pipeline-activity-text">réfléchit</span>
    </div>
  );
}
