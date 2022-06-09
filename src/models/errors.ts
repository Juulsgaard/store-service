/**
 * An error with Action Commands
 */
export class ActionCommandError<TPayload> extends Error {
  constructor(message: string, public payload: TPayload) {
    super(message);
  }

}
