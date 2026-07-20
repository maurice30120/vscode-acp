import type { SessionNotification } from '@agentclientprotocol/sdk';

export type PipelineStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'implementing'
  | 'reviewing'
  | 'testing'
  | 'completed'
  | 'rejected'
  | 'error'
  | 'cancelled';

export interface PipelineStatusEvent {
  sessionId: string;
  status: PipelineStatus;
  message: string;
  stepId?: string;
  branchId?: string;
  role?: string;
  agentName?: string;
  implementerUsesSandcastle?: boolean;
}

export interface PipelinePauseEvent {
  sessionId: string;
  pauseId: string;
  pauseType: 'approval' | 'question' | 'promotion';
  content: string;
  format: 'text' | 'markdown' | 'json' | 'proposed-plan';
  stepId: string;
  role?: string;
  agentName?: string;
  implementerUsesSandcastle?: boolean;
  revised?: boolean;
}

export interface PipelineSessionUpdateEvent {
  sessionId: string;
  phase: string;
  update: SessionNotification;
  stepId?: string;
  branchId?: string;
  role?: string;
  agentName?: string;
}
