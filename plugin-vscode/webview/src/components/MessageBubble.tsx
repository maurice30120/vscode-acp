import { memo, useMemo } from 'react';
import type { JSX } from 'react';

import type { AgentID, MessageHistoryItem } from '../chatTypes';
import { parseUserMessage } from '../app/composer';
import { MarkdownDisplay } from './MarkdownDisplay';
import { Codicon } from './Codicon';

const AGENT_COLORS = [
  'var(--vscode-charts-blue)',
  'var(--vscode-charts-green)',
  'var(--vscode-charts-orange)',
  'var(--vscode-charts-purple)',
  'var(--vscode-charts-red)',
  'var(--vscode-charts-yellow)',
];

function formatAgentName(agentId: AgentID): string {
  if (agentId === 'user') {
    return 'You';
  }
  return agentId
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(' ') || 'Agent';
}

function getAgentColor(agentId: AgentID): string {
  let hash = 0;
  for (const character of agentId) {
    hash = ((hash * 31) + character.codePointAt(0)!) >>> 0;
  }
  return AGENT_COLORS[hash % AGENT_COLORS.length]!;
}

export type MessageBubbleProps = {
  item: MessageHistoryItem;
  onMentionClick?: (path: string) => void;
};

function MessageBubbleComponent({ item, onMentionClick }: MessageBubbleProps): JSX.Element {
  const parsedUserMessage = useMemo(
    () => (item.role === 'user' ? parseUserMessage(item.text) : null),
    [item],
  );

  const agentId = item.agentId || (item.role === 'user' ? 'user' : 'agent');
  const agentName = formatAgentName(agentId);
  const agentAvatar = agentId === 'user' ? '👤' : agentName.charAt(0).toLocaleUpperCase();
  const agentColor = getAgentColor(agentId);

  if (item.role === 'assistant') {
    return (
      <div className="message assistant md-rendered" style={{ borderLeftColor: agentColor }}>
        <div className="message-header">
          <span className="agent-avatar" style={{ color: agentColor }}>{agentAvatar}</span>
          <span className="agent-name">{agentName}</span>
        </div>
        <MarkdownDisplay onMentionClick={onMentionClick}>
          {item.text}
        </MarkdownDisplay>
      </div>
    );
  }

  if (item.role === 'error') {
    return (
      <div className="message error md-rendered" style={{ borderLeftColor: agentColor }}>
        <div className="message-header">
          <span className="agent-avatar" style={{ color: agentColor }}>{agentAvatar}</span>
          <span className="agent-name">{agentName}</span>
        </div>
        <Codicon className="message-status-icon" name="error" />
        <MarkdownDisplay>{item.text}</MarkdownDisplay>
      </div>
    );
  }

  if (item.role === 'info') {
    return (
      <div className="message info md-rendered" style={{ borderLeftColor: agentColor }}>
        <div className="message-header">
          <span className="agent-avatar" style={{ color: agentColor }}>{agentAvatar}</span>
          <span className="agent-name">{agentName}</span>
        </div>
        <Codicon className="message-status-icon" name="info" />
        <MarkdownDisplay>{item.text}</MarkdownDisplay>
      </div>
    );
  }

  if (!parsedUserMessage) {
    return (
      <div className="message user md-rendered" style={{ borderLeftColor: agentColor }}>
        <div className="message-header">
          <span className="agent-avatar" style={{ color: agentColor }}>{agentAvatar}</span>
          <span className="agent-name">{agentName}</span>
        </div>
        <MarkdownDisplay>{item.text}</MarkdownDisplay>
      </div>
    );
  }

  return (
    <div className="message user md-rendered" style={{ borderLeftColor: agentColor }}>
      <div className="message-header">
        <span className="agent-avatar" style={{ color: agentColor }}>{agentAvatar}</span>
        <span className="agent-name">{agentName}</span>
      </div>
      <span className="file-badge">
        <Codicon name="file" />
        {parsedUserMessage.badgeText}
      </span>
      {parsedUserMessage.body ? (
        <div className="message-text">
          <MarkdownDisplay>{parsedUserMessage.body}</MarkdownDisplay>
        </div>
      ) : null}
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleComponent);
