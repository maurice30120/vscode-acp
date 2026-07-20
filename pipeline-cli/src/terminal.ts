import { stderr, stdin, stdout } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';

export interface CliTerminal {
  readonly interactive: boolean;
  write(message: string): void;
  writeError(message: string, newline?: boolean): void;
  ask(question: string): Promise<string>;
  confirm(question: string, defaultValue?: boolean): Promise<boolean>;
  select(title: string, options: string[]): Promise<string | undefined>;
  close(): void;
}

export class NodeCliTerminal implements CliTerminal {
  readonly interactive = stdin.isTTY === true && stdout.isTTY === true;
  private readonly readline: Interface;

  constructor() {
    this.readline = createInterface({ input: stdin, output: stdout });
  }

  write(message: string): void {
    stdout.write(message.endsWith('\n') ? message : `${message}\n`);
  }

  writeError(message: string, newline = true): void {
    stderr.write(newline && !message.endsWith('\n') ? `${message}\n` : message);
  }

  async ask(question: string): Promise<string> {
    return (await this.readline.question(`${question}\n> `)).trim();
  }

  async confirm(question: string, defaultValue = false): Promise<boolean> {
    const suffix = defaultValue ? '[Y/n]' : '[y/N]';
    const answer = (await this.readline.question(`${question} ${suffix} `)).trim().toLowerCase();
    if (!answer) {
      return defaultValue;
    }
    return answer === 'y' || answer === 'yes' || answer === 'o' || answer === 'oui';
  }

  async select(title: string, options: string[]): Promise<string | undefined> {
    if (options.length === 0) {
      return undefined;
    }
    this.write(title);
    options.forEach((option, index) => this.write(`  ${index + 1}. ${option}`));
    const answer = await this.ask('Select an option number');
    const selectedIndex = Number.parseInt(answer, 10) - 1;
    return Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < options.length
      ? options[selectedIndex]
      : undefined;
  }

  close(): void {
    this.readline.close();
  }
}
