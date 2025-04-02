export class InsufficientFundsError extends Error {
  constructor() {
    super('Insufficient funds');
    this.name = 'InsufficientFundsError';
  }
}

export class InvalidBetStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBetStateError';
  }
}
