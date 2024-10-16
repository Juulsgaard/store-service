import {BaseCommand} from "./base-commands";

export class CacheCommandError<TPayload> extends Error {
  constructor(message: string, public payload: TPayload) {
    super(message);
  }
}

export class ActionCancelledError<TPayload> extends Error {
  constructor(readonly cmd: BaseCommand, message: string, readonly payload: TPayload) {
    super(message);
  }
}
