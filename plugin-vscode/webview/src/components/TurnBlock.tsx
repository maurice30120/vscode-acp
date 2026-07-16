import { memo } from 'react';
import type { JSX } from 'react';

import type { CurrentToolCall, CurrentTurnStatus, ToolCallHistoryItem } from '../chatTypes';
import { PlanningDraftBlock } from './PlanningDraftBlock';
import { ThoughtBlock, type ThoughtBlockProps } from './ThoughtBlock';
import { TurnTools } from './TurnTools';
import { MarkdownDisplay } from './MarkdownDisplay';

type TurnToolHistoryItem = {
  item: ToolCallHistoryItem;
  historyIndex: number;
};

export type TurnBlockProps = {
  turnKey: string;
  thought: ThoughtBlockProps | null;
  planningDraftText?: string;
  status?: CurrentTurnStatus | null;
  assistantText?: string;
  toolCalls: CurrentToolCall[] | TurnToolHistoryItem[];
  collapsed: boolean;
  onToggleTools: () => void;
  onMentionClick?: (path: string) => void;
};

function TurnBlockComponent({
  turnKey,
  thought,
  planningDraftText,
  status,
  assistantText,
  toolCalls,
  collapsed,
  onToggleTools,
  onMentionClick,
}: TurnBlockProps): JSX.Element | null {
  const hasAssistantContent = typeof assistantText === 'string' && assistantText.trim().length > 0;
  const hasAssistant = hasAssistantContent;
  const hasPlanningDraft = typeof planningDraftText === 'string' && planningDraftText.trim().length > 0;
  const hasStatus = Boolean(status);
  const hasVisibleContent = Boolean(thought) || hasPlanningDraft || hasStatus || hasAssistant || toolCalls.length > 0;

  if (!hasVisibleContent) {
    return null;
  }

  return (
    <div className="turn" key={turnKey}>
      {thought ? <ThoughtBlock {...thought} /> : null}
      {hasPlanningDraft ? <PlanningDraftBlock text={planningDraftText ?? ''} /> : null}
      {status ? <SandcastleStatusRow status={status} /> : null}
      {hasAssistant ? (
        <div className={`message assistant md-rendered`}>
          <MarkdownDisplay onMentionClick={onMentionClick}>
            {assistantText || ''}
          </MarkdownDisplay>
        </div>
      ) : null}
      <TurnTools turnKey={turnKey} toolCalls={toolCalls} collapsed={collapsed} onToggle={onToggleTools} />
    </div>
  );
}

export const TurnBlock = memo(TurnBlockComponent);

function formatElapsed(elapsedMs?: number): string | null {
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) {
    return null;
  }
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function SandcastleStatusRow({ status }: { status: CurrentTurnStatus }): JSX.Element {
  const elapsed = formatElapsed(status.elapsedMs);
  const provider = status.provider ? ` ${status.provider}` : '';
  const verb = status.status === 'starting' ? 'starting' : 'running';
  const detail = elapsed ? ` for ${elapsed}` : '';
  return (
    <div className="sandcastle-status-row" title={status.worktreePath}>
      Sandcastle{provider} {verb} in sandbox{detail}
    </div>
  );
}
