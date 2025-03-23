export class InvalidBetStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBetStateError';
  }
}
