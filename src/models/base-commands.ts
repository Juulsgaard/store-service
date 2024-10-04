import {StoreServiceContext} from "../configs/command-config";
import {IdMap, parseIdMap} from "../lib/id-map";
import {IValueRequestState} from "../utils/request-state";
import {computed, Signal} from "@angular/core";

export abstract class BaseCommand {

  /** True if the commands triggers a reducer synchronously */
  abstract readonly isSync: boolean;

  abstract get name(): string;
}

/**
 * The base Command class
 */
export abstract class StoreCommand<TState> extends BaseCommand {

  abstract get initialLoad(): boolean;

  protected readonly context: StoreServiceContext<TState>;

  /** Indicates if any command of this type are currently executing */
  loading: Signal<boolean>;
  /** Indicates if any command of this type have been started */
  loaded: Signal<boolean>;
  /** Provides the error from the most recently failed request when in an error state */
  error: Signal<Error|undefined>;
  /** Indicates if any command of this type has recently failed */
  failed: Signal<boolean>;

  protected constructor(context: StoreServiceContext<TState>) {
    super();

    this.context = context;

    const loadState = context.getLoadState(this, undefined);

    this.loading = computed(() => {
      const state = loadState();
      return state !== undefined && state > 0;
    });

    this.loaded = computed(() => loadState() !== undefined);

    this.error = context.getErrorState(this, undefined);
    this.failed = computed(() => this.error() !== undefined);
  }

  /** Name of the Command */
  get name() {
    return this.context.getCommandName(this)
  };

  /**
   * Resets the failure state of the command
   * @internal
   */
  resetFailState() {
    this.context.resetErrorState(this, undefined);
  }
}

export abstract class PayloadCommand<TState, TPayload, TResult> extends StoreCommand<TState> {

  protected getRequestId?: (payload: TPayload) => string;

  protected constructor(context: StoreServiceContext<TState>, requestId: IdMap<TPayload>|undefined) {
    super(context);

    this.getRequestId = requestId && parseIdMap(requestId);
  }

  /**
   * Emit the command
   * @param payload
   */
  abstract emit(payload: TPayload): IValueRequestState<TResult>;

  /**
   * Returns true if the command can be emitted
   * @param payload
   */
  abstract canEmit(payload: TPayload): boolean;

  /**
   * Indicates if any command with a matching type and payload are currently executing
   * @param payload - The payload used to recognise the request
   */
  loadingById(payload: TPayload): Signal<boolean> {
    if (!this.getRequestId) return this.loading;

    const requestId = this.getRequestId(payload);
    const loadState = this.context.getLoadState(this, requestId);
    return computed(() => {
      const state = loadState();
      return state !== undefined && state > 0;
    });
  }

  /**
   * Indicates if any command with a matching type and payload have been started
   * @param payload - The payload used to recognise the request
   */
  loadedById(payload: TPayload): Signal<boolean> {
    if (!this.getRequestId) return this.loaded;

    const requestId = this.getRequestId(payload);
    const loadState = this.context.getLoadState(this, requestId);
    return computed(() => loadState() !== undefined);
  }

  /**
   * Provides the error from the most recently failed request with a matching type and payload when in an error state
   * @param payload - The payload used to recognise the request
   */
  errorById(payload: TPayload): Signal<Error|undefined> {
    if (!this.getRequestId) return this.error;

    const requestId = this.getRequestId(payload);
    return this.context.getErrorState(this, requestId);
  }

  /**
   * Provides the error from the most recently failed request with a matching type and payload when in an error state
   * @param payload - The payload used to recognise the request
   */
  failedById(payload: TPayload): Signal<boolean> {
    if (!this.getRequestId) return this.failed;

    const error = this.errorById(payload);
    return computed(() => error() !== undefined);
  }

  /**
   * Resets the failure state of the command and specific request
   * @internal
   */
  resetFailureStateById(payload: TPayload) {
    if (!this.getRequestId) {
      this.resetFailState();
      return;
    }
    this.context.resetErrorState(this, this.getRequestId(payload));
  }

}

// export type ActionCommandUnion<TState, TPayload, TData> = ActionCommand<TState, TPayload, TData> | DeferredCommand<TState, TPayload, TData>;
// export type StoreCommandUnion<TState, TPayload, TData = any> = PlainCommand<TState, TPayload> | ActionCommandUnion<TState, TPayload, TData>;
