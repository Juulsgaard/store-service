/**
 * An error with Action Commands
 */
export class ActionCommandError<TPayload> extends Error {
  constructor(message: string, public payload: TPayload) {
    super(message);
  }

}

export class CacheCommandError<TPayload> extends Error {
  constructor(message: string, public payload: TPayload) {
    super(message);
  }

}

export class ActionCancelledError<TPayload> extends Error {
  constructor(message: string, public payload: TPayload) {
    super(message);
  }

}

export class CancelledError extends Error {
  constructor(message?: string) {
    super(message ?? 'Cancelled');
  }
}
