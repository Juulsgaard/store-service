import {StoreServiceContext} from "../configs/command-config";
import {map} from "rxjs/operators";
import {distinctUntilChanged, Observable} from "rxjs";
import {ActionCommand, DeferredCommand, PlainCommand} from "../commands";
import {IdMap, parseIdMap} from "../lib/id-map";
import {ILoadingState} from "@juulsgaard/rxjs-tools";

export abstract class BaseCommand {

  /** True if the commands triggers a reducer synchronously */
  abstract readonly isSync: boolean;

  abstract get name(): string;
}

/**
 * The base Command class
 */
export abstract class StoreCommand<TState> extends BaseCommand {

  protected context: StoreServiceContext<TState>

  protected constructor(context: StoreServiceContext<TState>) {
    super();

    this.context = context;
  }

  /**
   * Name of the Command
   */
  get name() {
    return this.context.getCommandName(this)
  };
}

export interface PayloadCommand<TPayload> {
  /**
   * Emit the command with no status returned
   * @param payload
   */
  emit(payload: TPayload): void;
}

export abstract class AsyncCommand<TState> extends StoreCommand<TState> {

  abstract get initialLoad(): boolean;

  /**
   * Indicates if any command of this type are currently executing
   */
  loading$: Observable<boolean>;
  /**
   * Indicates if any command of this type have been started
   */
  loaded$: Observable<boolean>;
  /**
   * Indicates if any command of this type has recently failed
   */
  failed$: Observable<boolean>;
  /**
   * Provides the error from the most recently failed request when in an error state
   */
  error$: Observable<Error|undefined>;


  protected constructor(context: StoreServiceContext<TState>) {
    super(context);

    this.loading$ = context.getLoadState$(this, undefined).pipe(
      map(x => !!x && x > 0),
      distinctUntilChanged()
    );

    this.loaded$ = context.getLoadState$(this, undefined).pipe(
      map(x => x !== undefined),
      distinctUntilChanged()
    );

    this.failed$ = context.getFailureState$(this, undefined).pipe(
      distinctUntilChanged()
    );

    this.error$ = context.getErrorState$(this, undefined).pipe(
      distinctUntilChanged()
    );
  }

  /**
   * Resets the failure state of the command
   * @internal
   */
  resetFailState() {
    this.context.resetFailState(this, undefined);
  }
}

export abstract class AsyncPayloadCommand<TState, TPayload> extends AsyncCommand<TState> implements PayloadCommand<TPayload> {

  protected getRequestId?: (payload: TPayload) => string;

  protected constructor(context: StoreServiceContext<TState>, requestId?: IdMap<TPayload>) {
    super(context);
    this.getRequestId = requestId && parseIdMap(requestId);
  }

  loadingById$(payload: TPayload) {
    if (!this.getRequestId) return this.loading$;
    return this.context.getLoadState$(this, this.getRequestId(payload)).pipe(
      map(x => !!x && x > 0),
      distinctUntilChanged()
    )
  }

  loadedById$(payload: TPayload) {
    if (!this.getRequestId) return this.loaded$;
    return this.context.getLoadState$(this, this.getRequestId(payload)).pipe(
      map(x => x !== undefined),
      distinctUntilChanged()
    )
  }

  failedById$(payload: TPayload) {
    if (!this.getRequestId) return this.failed$;
    return this.context.getFailureState$(this, this.getRequestId(payload)).pipe(
      distinctUntilChanged()
    )
  }

  errorById$(payload: TPayload) {
    if (!this.getRequestId) return this.error$;
    return this.context.getErrorState$(this, this.getRequestId(payload)).pipe(
      distinctUntilChanged()
    )
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
    this.context.resetFailState(this, this.getRequestId(payload));
  }

  /**
   * Dispatch the command and return a LoadingState to monitor command progress
   * @param payload - The command payload
   */
  abstract observe(payload: TPayload): ILoadingState;

  /**
   * Dispatch the command and return a Promise to monitor command progress
   * @param payload - The command payload
   */
  abstract emitAsync(payload: TPayload): Promise<unknown>;

  /**
   * Emit the command with no status returned
   * @param payload - The command payload
   */
  abstract emit(payload: TPayload): void;
}

export type ActionCommandUnion<TState, TPayload, TData> = ActionCommand<TState, TPayload, TData> | DeferredCommand<TState, TPayload, TData>;
export type StoreCommandUnion<TState, TPayload, TData = any> = PlainCommand<TState, TPayload> | ActionCommandUnion<TState, TPayload, TData>;
