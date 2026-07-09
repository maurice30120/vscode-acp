export class RunAbortedError extends Error {
  constructor() {
    super('Run aborted.');
  }
}
