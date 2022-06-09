import {Observable} from "rxjs";
import {CommandAction, StoreCommand} from "../models/store-types";
import {ActionCommandObjectConfig} from "./action-command-config";
import {DeferredCommandObjectConfig} from "./deferred-command-config";
import {rootReducerScope} from "../models/reducer-scope";
import {PlainCommandObjectConfig} from "./plain-command-config";

/**
 * A context element allowing commands to interface with the store
 * @internal
 */
export interface StoreServiceContext<TState> {
  getCommandName(cmd: StoreCommand<TState>): string;

  applyCommand(reducer$: Observable<(state: TState) => TState>): void;

  displaySuccess(message: string): void;

  displayError(message: string|undefined, error: Error): void;

  getLoadState(cmd: StoreCommand<TState>): number | undefined;

  getLoadState$(cmd: StoreCommand<TState>): Observable<number | undefined>;

  startLoad(cmd: StoreCommand<TState>): void;

  endLoad(cmd: StoreCommand<TState>): void;

  isProduction: boolean;
}

export class StoreCommandConfig<TState> {

  /** @internal */
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
      {action, showError: true, initialLoad: false, queue: false},
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

export class StoreClientCommandConfig<TState, TClient> {

  /** @internal */
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
      {action: action(this.client).bind(this.client), showError: true, initialLoad: false, queue: false},
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