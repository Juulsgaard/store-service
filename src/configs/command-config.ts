import {CommandAction} from "../models/store-types";
import {ActionCommandObjectConfig} from "./action-command-config";
import {DeferredCommandObjectConfig} from "./deferred-command-config";
import {rootReducerScope} from "../models/reducer-scope";
import {PlainCommandObjectConfig} from "./plain-command-config";
import {QueueAction} from "../models/queue-action";
import {AsyncCommand, StoreCommand} from "../models/base-commands";
import {SimpleObject} from "@juulsgaard/ts-tools";
import {Signal} from "@angular/core";

/**
 * A context element allowing commands to interface with the store
 */
export interface StoreServiceContext<TState> extends BaseStoreServiceContext<TState> {

  getCommandName(cmd: StoreCommand<TState>): string;

  displaySuccess(message: string): void;
  displayError(message: string|undefined, error: Error): void;

  logActionRetry(command: string, attempt: number, nextDelay: number): void;

  getLoadState(cmd: AsyncCommand<TState>, requestId: string|undefined): Signal<number | undefined>;
  getErrorState(cmd: AsyncCommand<TState>, requestId: string|undefined): Signal<Error|undefined>;

  startLoad(cmd: AsyncCommand<TState>, requestId: string|undefined): void;
  endLoad(cmd: AsyncCommand<TState>, requestId: string|undefined): void;
  failLoad(cmd: AsyncCommand<TState>, error: Error, requestId: string|undefined): void;
  resetErrorState(cmd: AsyncCommand<TState>, requestId: string|undefined): void;

  errorIsCritical(error: any): boolean;
}

export interface BaseStoreServiceContext<TState> {
  applyCommand(action: QueueAction<TState>): void;
  isProduction: boolean;
}

export class StoreCommandConfig<TState extends SimpleObject> {

  constructor(private context: StoreServiceContext<TState>) {
  }


  /**
   * Add an action to the command
   * @param action
   */
  withAction<TData>(action: CommandAction<void, TData>): ActionCommandObjectConfig<TState, TState, void, TData>
  /**
   * Add an action to the command
   * @param action
   */
  withAction<TPayload, TData>(action: CommandAction<TPayload, TData>): ActionCommandObjectConfig<TState, TState, TPayload, TData>
  withAction<TPayload, TData>(action: CommandAction<TPayload, TData>): ActionCommandObjectConfig<TState, TState, TPayload, TData> {
    return new ActionCommandObjectConfig<TState, TState, TPayload, TData>(
      this.context,
      {action, showError: true, initialLoad: false, queue: false, cancelConcurrent: false},
      rootReducerScope,
      []
    );
  }

  /**
   * Add a deferred action to the command that will be executed after the reducer
   * @param action
   */
  withDeferredAction<TData>(action: CommandAction<void, TData>): DeferredCommandObjectConfig<TState, TState, void, TData>
  /**
   * Add a deferred action to the command that will be executed after the reducer
   * @param action
   */
  withDeferredAction<TPayload, TData>(action: CommandAction<TPayload, TData>): DeferredCommandObjectConfig<TState, TState, TPayload, TData>
  withDeferredAction<TPayload, TData>(action: CommandAction<TPayload, TData>): DeferredCommandObjectConfig<TState, TState, TPayload, TData> {
    return new DeferredCommandObjectConfig<TState, TState, TPayload, TData>(
      this.context,
      {action, showError: true},
      rootReducerScope,
      []
    );
  }

  /**
   * Create a plain Command
   */
  withPayload<TPayload>(): PlainCommandObjectConfig<TState, TState, TPayload> {
    return new PlainCommandObjectConfig(this.context, rootReducerScope, []);
  }
}

export class StoreClientCommandConfig<TState extends SimpleObject, TClient> {

  constructor(private context: StoreServiceContext<TState>, private client: TClient) {
  }

  /**
   * Add an action to the command
   * @param action
   */
  withAction<TData>(action: (client: TClient) => CommandAction<void, TData>): ActionCommandObjectConfig<TState, TState, void, TData>;
  /**
   * Add an action to the command
   * @param action
   */
  withAction<TPayload, TData>(action: (client: TClient) => CommandAction<TPayload, TData>): ActionCommandObjectConfig<TState, TState, TPayload, TData>;
  withAction<TPayload, TData>(action: (client: TClient) => CommandAction<TPayload, TData>): ActionCommandObjectConfig<TState, TState, TPayload, TData> {
    return new ActionCommandObjectConfig<TState, TState, TPayload, TData>(
      this.context,
      {action: action(this.client).bind(this.client), showError: true, initialLoad: false, queue: false, cancelConcurrent: false},
      rootReducerScope,
      []
    );
  }

  /**
   * Add a deferred action to the command that will be executed after the reducer
   * @param action
   */
  withDeferredAction<TData>(action: (client: TClient) => CommandAction<void, TData>): DeferredCommandObjectConfig<TState, TState, void, TData>
  /**
   * Add a deferred action to the command that will be executed after the reducer
   * @param action
   */
  withDeferredAction<TPayload, TData>(action: (client: TClient) => CommandAction<TPayload, TData>): DeferredCommandObjectConfig<TState, TState, TPayload, TData>
  withDeferredAction<TPayload, TData>(action: (client: TClient) => CommandAction<TPayload, TData>): DeferredCommandObjectConfig<TState, TState, TPayload, TData> {
    return new DeferredCommandObjectConfig<TState, TState, TPayload, TData>(
      this.context,
      {action: action(this.client).bind(this.client), showError: true},
      rootReducerScope,
      []
    );
  }
}
