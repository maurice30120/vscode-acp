import { createInterface, type Interface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import type { PiPermissionContext } from '@acp-client/pi-extension/host';

export interface CliTerminal {
  write(message: string): void;
  writeError(message: string): void;
  ask(question: string): Promise<string>;
  confirm(title: string, message?: string): Promise<boolean>;
  select(title: string, options: string[]): Promise<string | undefined>;
  asPermissionContext(): PiPermissionContext;
  close(): void;
}

export class NodeCliTerminal implements CliTerminal {
  private readonly readline: Interface;

  constructor() {
    this.readline = createInterface({ input, output });
  }

  write(message: string): void {
    output.write(`${message}\n`);
  }

  writeError(message: string): void {
    process.stderr.write(`${message}\n`);
  }

  async ask(question: string): Promise<string> {
    return (await this.readline.question(`${question} `)).trim();
  }

  async confirm(title: string, message?: string): Promise<boolean> {
    const label = message ? `${title}\n${message}\nConfirm? [y/N]` : `${title} [y/N]`;
    const answer = (await this.readline.question(`${label} `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes' || answer === 'o' || answer === 'oui';
  }

  async select(title: string, options: string[]): Promise<string | undefined> {
    if (options.length === 0) {
      return undefined;
    }
    this.write(title);
    options.forEach((option, index) => this.write(`  ${index + 1}. ${option}`));
    const answer = await this.ask(`Choose [1-${options.length}] or press Enter to cancel:`);
    if (!answer) {
      return undefined;
    }
    const index = Number.parseInt(answer, 10) - 1;
    return Number.isInteger(index) && index >= 0 && index < options.length
      ? options[index]
      : undefined;
  }

  asPermissionContext(): PiPermissionContext {
    return {
      hasUI: true,
      ui: {
        select: (title: string, options: string[]) => this.select(title, options),
        confirm: (title: string, message?: string) => this.confirm(title, message),
      } as PiPermissionContext['ui'],
    };
  }

  close(): void {
    this.readline.close();
  }
}
