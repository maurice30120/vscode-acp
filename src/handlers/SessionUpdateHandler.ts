import { log } from '../utils/Logger';

import type { SessionNotification } from '@agentclientprotocol/sdk';

export type SessionUpdateListener = (update: SessionNotification) => void;

/**
 * Distribue les notifications session/update vers les listeners enregistres.
 * ChatWebviewProvider s'enregistre pour relayer ces mises a jour vers le webview.
 */
export class SessionUpdateHandler {
  private listeners: Set<SessionUpdateListener> = new Set();

  addListener(listener: SessionUpdateListener): void {
    this.listeners.add(listener);
  }

  removeListener(listener: SessionUpdateListener): void {
    this.listeners.delete(listener);
  }

  handleUpdate(update: SessionNotification): void {
    const updateType = (update.update as any)?.sessionUpdate || 'unknown';
    log(`sessionUpdate: type=${updateType}, sessionId=${update.sessionId}`);

    for (const listener of this.listeners) {
      try {
        listener(update);
      } catch (e) {
        log(`Error in session update listener: ${e}`);
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
