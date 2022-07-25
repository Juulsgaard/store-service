import {EMPTY, of, Subject, switchMap, tap} from "rxjs";
import {logActionInformation, logFailedAction, logSuccessfulAction} from "../models/logging";
import {CommandAction, StoreCommand, StoreCommandUnion} from "../models/store-types";
import {ActionCommandError} from "../models/errors";
import {catchError, map} from "rxjs/operators";
import {StoreServiceContext} from "../configs/command-config";
import {LoadingState} from "../loading-state";
import {QueueAction} from "../models/queue-action";
import {PlainCommand} from "./plain-command";
import {ActionCommand} from "./action-command";


/**
 * The options for a Cache Command
 */
export interface CacheCommandOptions<TPayload, TData> {
  readonly action: CommandAction<{options: CacheLoadOptions, payload: TPayload}, TData|undefined>;
  failCondition?: (data: TData) => boolean;
  errorMessage?: string;
  successMessage?: string | ((data: TData, payload: TPayload) => string);
  initialLoad: boolean;
  initialLoadId?: (payload: TPayload) => string;

  /** Use the cache even if online */
  cacheIfOnline: boolean;
  /** Attempt the fallback action even if offline */
  fallbackIfOffline: boolean;
  /** The max age of the cache when client is online */
  onlineMaxAge?: number;
  /** The max age of the cache when the client is offline */
  offlineMaxAge?: number;
  /** If true the max age is based on creation when online. Otherwise last update */
  onlineAbsoluteAge?: boolean;
  /** If true the max age is based on creation when offline. Otherwise last update */
  offlineAbsoluteAge?: boolean;
}

export interface CacheLoadOptions {
  maxAge?: number;
  absoluteAge: boolean;
}

/**
 * A command that loads data from a cache, and then applies a reducer
 */
export class CacheCommand<TState, TPayload, TData, TXPayload, TXData> extends StoreCommand<TState> {

  get initialLoad() {return this.options.initialLoad}

  constructor(
    context: StoreServiceContext<TState>,
    private readonly options: CacheCommandOptions<TPayload, TData>,
    private readonly reducer: (state: TState, data: TData, payload: TPayload) => TState,
    private fallbackCommand?: StoreCommandUnion<TState, TXPayload, TXData>,
    private concurrentFallback = false
  ) {
    super(context);
  }

  private valueIsValid(data: TData|undefined): data is TData {
    return data != undefined && !this.options.failCondition?.(data);
  }

  alreadyLoaded(payload: TPayload): boolean {
    if (!this.options.initialLoad) return false;

    if (this.options.initialLoadId) {
      return this.context.getLoadState(this, this.options.initialLoadId(payload)) !== undefined
    }

    return this.context.getLoadState(this) !== undefined;
  }

  /**
   * Dispatch the command/fallback and return a LoadingState to monitor progress of both
   * @param payload - The command/cache payload
   */
  observe(payload: TPayload&TXPayload): LoadingState<TData|TXData>
  /**
   * Dispatch the command/fallback and return a LoadingState to monitor progress of both
   * @param cachePayload - The cache payload
   * @param commandPayload - The command payload
   */
  observe(cachePayload: TPayload, commandPayload: TXPayload): LoadingState<TData|TXData>
  observe(cachePayload: TPayload|(TPayload&TXPayload), commandPayload?: TXPayload): LoadingState<TData|TXData> {

    const cmdPayload = commandPayload ?? cachePayload as TXPayload;

    //<editor-fold desc="Precondition">
    // Throw error if initial load has already been loaded
    if (this.alreadyLoaded(cachePayload)) {
      return LoadingState.FromError(() => new ActionCommandError('This cache action has already been loaded', cachePayload));
    }

    // Throw error if initial load has already been loaded for fallback
    if (this.fallbackCommand && 'alreadyLoaded' in this.fallbackCommand) {
      if (this.fallbackCommand.alreadyLoaded(cmdPayload)) {
        return LoadingState.FromError(() => new ActionCommandError('This cache fallback action has already been loaded', cachePayload))
      }
    }
    //</editor-fold>

    const requestId = this.options.initialLoad ? this.options.initialLoadId?.(cachePayload) : undefined;

    this.context.startLoad(this, requestId);

    //<editor-fold desc="State">
    const sharedState = new Subject<TData|TXData|void>();
    const sharedLoadingState = new LoadingState(sharedState) as LoadingState<TData|TXData>;

    const online = navigator.onLine;
    const maxAge = online ? this.options.onlineMaxAge : this.options.offlineMaxAge;
    const absoluteAge = online ? !!this.options.onlineAbsoluteAge : !!this.options.offlineAbsoluteAge;
    //</editor-fold>

    //<editor-fold desc="Fallback emission">
    // Method that emits the fallback command
    const emitFallback = () => {
      // Concurrent Plain fallback
      if (this.fallbackCommand instanceof PlainCommand) {
        this.fallbackCommand.emit(cmdPayload);
        sharedState.next();
        return;
      }

      // Concurrent async fallback
      this.fallbackCommand!.observe(cmdPayload)
        .then(data => sharedState.next(data))
        .catch(err => sharedState.error(err));
    };
    //</editor-fold>

    // Check if cache should be used based on online state of client
    if (online && !this.options.cacheIfOnline) {
      if (this.fallbackCommand) {
        emitFallback();
        this.context.endLoad(this, requestId)
      } else {
        sharedState.error('Cache disabled online, but missing fallback');
        this.context.failLoad(this, requestId)
      }
      return sharedLoadingState;
    }

    //<editor-fold desc="Cache Reducer Action">

    // Create a delayed loading state
    const cacheLoad = LoadingState.Delayed(
      () => this.options.action({
        options: {maxAge, absoluteAge},
        payload: cachePayload
      })
    );

    // Define the execution for the Command
    const execute = () => {
      const startedAt = Date.now();

      // Trigger action and map result
      return cacheLoad.trigger$.pipe(
        // Log errors
        tap({error: error => this.onFailure(cachePayload, error, startedAt)}),
        // Terminate failed cache reads (undefined)
        switchMap(x => {
          if (this.valueIsValid(x)) return of(x);
          this.onNoCache(cachePayload, startedAt);
          return EMPTY
        }),
        // Generate reducer
        map(result => {
          this.onSuccess(cachePayload, result, startedAt);
          return (state: TState) => this.reducer(state, result, cachePayload);
        })
      )
    };
    //</editor-fold>

    // Send Queue Action
    this.context.applyCommand(new QueueAction<TState>(
      this,
      execute,
      () => cacheLoad.cancel(),
      true
    ));

    //<editor-fold desc="Post Cache Fallback logic">
    cacheLoad
      .then(result => {

        this.context.endLoad(this, requestId);

        if (this.fallbackCommand) {
          // Activate fallbacks if no cache result, or concurrent fallback is enabled
          if (this.concurrentFallback || !this.valueIsValid(result)) {
            if (!online && !this.options.fallbackIfOffline) {
              emitFallback();
              return;
            } else {
              sharedState.error(Error('No value found in cache, and no offline fallback'));
              return;
            }
          }
        }

        // Default case - Emit cache result
        sharedState.next(result);
      })
      .catch(err => {
        this.context.failLoad(this, requestId);
        sharedState.error(err);
      });
    //</editor-fold>

    return sharedLoadingState;
  };

  /**
   * Handle a successful action
   * @param payload
   * @param result
   * @param startedAt
   * @private
   */
  private onSuccess(payload: TPayload, result: TData, startedAt?: number) {

    // Display success message
    if (this.options.successMessage) {
      const message = this.options.successMessage instanceof Function
        ? this.options.successMessage(result, payload)
        : this.options.successMessage;
      this.context.displaySuccess(message)
    }

    if (!this.context.isProduction) logSuccessfulAction(this.name, undefined, startedAt, payload, result);
  }

  /**
   * Handle a successful cache load with no content
   * @param payload
   * @param startedAt
   * @private
   */
  private onNoCache(payload: TPayload, startedAt?: number) {
    if (!this.context.isProduction) {
      logActionInformation(this.name, 'Cache is empty', startedAt, payload);
    }
  }

  /**
   * Handle a failed action
   * @param payload
   * @param error
   * @param startedAt
   * @private
   */
  private onFailure(payload: TPayload, error: Error, startedAt?: number) {

    // Display error message
    if (this.options.errorMessage) {
      this.context.displayError(this.options.errorMessage, error);
    }

    if (!this.context.isProduction) logFailedAction(this.name, startedAt, payload, error);
  }

  /**
   * Emit the command with no status returned
   * @param payload - The command/cache payload
   */
  emit(payload: TPayload&TXPayload): void
  /**
   * Emit the command with no status returned
   * @param cachePayload - The cache payload
   * @param commandPayload - The command payload
   */
  emit(cachePayload: TPayload, commandPayload: TXPayload): void
  emit(cachePayload: TPayload|(TPayload&TXPayload), commandPayload?: TXPayload): void {
    this.observe(cachePayload, commandPayload as TXPayload);
  };

  /**
   * Emit the cache / fallback command with a Promise status
   * @param payload - The command/cache payload
   */
  emitAsync(payload: TPayload&TXPayload): Promise<TData|TXData>
  /**
   * Emit the cache / fallback command with a Promise status
   * @param cachePayload - The cache payload
   * @param commandPayload - The command payload
   */
  emitAsync(cachePayload: TPayload, commandPayload: TXPayload): Promise<TData|TXData>
  emitAsync(cachePayload: TPayload|(TPayload&TXPayload), commandPayload?: TXPayload): Promise<TData|TXData> {
    return this.observe(cachePayload, commandPayload as TXPayload).resultAsync;
  };
}
