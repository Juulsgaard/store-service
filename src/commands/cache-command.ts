import {combineLatest, distinctUntilChanged, EMPTY, Observable, of, Subject, switchMap, tap} from "rxjs";
import {logActionInformation, logFailedAction, logSuccessfulAction} from "../models/logging";
import {CommandAction} from "../models/store-types";
import {ActionCommandError, CacheCommandError, InitialLoadError} from "../models/errors";
import {catchError, map} from "rxjs/operators";
import {StoreServiceContext} from "../configs/command-config";
import {LoadingState} from "../loading-state";
import {QueueAction} from "../models/queue-action";
import {PlainCommand} from "./plain-command";
import {ActionCommand} from "./action-command";
import {PayloadCommand, StoreCommand, StoreCommandUnion} from "../models/base-commands";


/**
 * The options for a Cache Command
 */
export interface CacheCommandOptions<TPayload, TData> {
  readonly action: CommandAction<{ options: CacheLoadOptions, payload: TPayload }, TData | undefined>;
  failCondition?: (data: TData) => boolean;
  errorMessage?: string;
  successMessage?: string | ((data: TData, payload: TPayload) => string);
  initialLoad: boolean;
  requestId?: (payload: TPayload) => string;

  /** Use the cache even if online */
  cacheWhenOnline: boolean;
  /** Attempt the fallback action even if offline */
  fallbackWhenOffline: boolean;
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

  get initialLoad() {
    return this.options.initialLoad
  }

  cacheLoading$: Observable<boolean>;
  cacheLoaded$: Observable<boolean>;

  constructor(
    context: StoreServiceContext<TState>,
    private readonly options: CacheCommandOptions<TPayload, TData>,
    private readonly reducer: (state: TState, data: TData, payload: TPayload) => TState,
    private fallbackCommand?: StoreCommandUnion<TState, TXPayload, TXData>,
    private concurrentFallback = false
  ) {
    super(context);

    this.cacheLoading$ = super.loading$;
    this.cacheLoaded$ = super.loaded$;

    if (fallbackCommand) {
      this.loading$ = combineLatest([this.cacheLoading$, fallbackCommand.loading$]).pipe(
        map(([x, y]) => x || y),
        distinctUntilChanged()
      );
    }

    if (fallbackCommand) {
      this.loaded$ = combineLatest([this.cacheLoaded$, fallbackCommand.loaded$]).pipe(
        map(([x, y]) => x || y),
        distinctUntilChanged()
      );
    }
  }

  //<editor-fold desc="Request Loading State">
  cacheLoadingById$(payload: TPayload) {
    if (!this.options.requestId) return this.loading$;
    return this.context.getLoadState$(this, this.options.requestId(payload)).pipe(
      map(x => !!x && x > 0),
      distinctUntilChanged()
    )
  }

  cacheLoadedById$(payload: TPayload) {
    if (!this.options.requestId) return this.loaded$;
    return this.context.getLoadState$(this, this.options.requestId(payload)).pipe(
      map(x => x !== undefined),
      distinctUntilChanged()
    )
  }

  loadingById$(payload: TPayload & TXPayload): Observable<boolean>;
  loadingById$(cachePayload: TPayload, commandPayload: TXPayload): Observable<boolean>;
  loadingById$(cachePayload: TPayload | (TPayload & TXPayload), commandPayload?: TXPayload) {
    if (!this.options.requestId) return this.loading$;
    if (!this.fallbackCommand || !('loadingById$' in this.fallbackCommand)) return this.cacheLoadingById$(cachePayload);
    const cmdPayload = commandPayload ?? cachePayload as TXPayload;
    return combineLatest([this.cacheLoadingById$(cachePayload), this.fallbackCommand.loadingById$(cmdPayload)]).pipe(
      map(([x, y]) => x || y),
      distinctUntilChanged()
    );
  }

  loadedById$(payload: TPayload & TXPayload): Observable<boolean>;
  loadedById$(cachePayload: TPayload, commandPayload: TXPayload): Observable<boolean>;
  loadedById$(cachePayload: TPayload | (TPayload & TXPayload), commandPayload?: TXPayload) {
    if (!this.options.requestId) return this.loading$;
    if (!this.fallbackCommand || !('loadedById$' in this.fallbackCommand)) return this.cacheLoadedById$(cachePayload);
    const cmdPayload = commandPayload ?? cachePayload as TXPayload;
    return combineLatest([this.cacheLoadedById$(cachePayload), this.fallbackCommand.loadedById$(cmdPayload)]).pipe(
      map(([x, y]) => x || y),
      distinctUntilChanged()
    );
  }

  //</editor-fold>

  private valueIsValid(data: TData | undefined): data is TData {
    return data != undefined && !this.options.failCondition?.(data);
  }

  alreadyLoaded(payload: TPayload): boolean {
    if (!this.options.initialLoad) return false;

    if (this.options.requestId) {
      return this.context.getLoadState(this, this.options.requestId(payload)) !== undefined
    }

    return this.context.getLoadState(this) !== undefined;
  }

  /**
   * Dispatch the command/fallback and return a LoadingState to monitor progress of both
   * @param payload - The command/cache payload
   */
  observe(payload: TPayload & TXPayload): LoadingState<TData | TXData>
  /**
   * Dispatch the command/fallback and return a LoadingState to monitor progress of both
   * @param cachePayload - The cache payload
   * @param commandPayload - The command payload
   */
  observe(cachePayload: TPayload, commandPayload: TXPayload): LoadingState<TData | TXData>
  observe(cachePayload: TPayload | (TPayload & TXPayload), commandPayload?: TXPayload): LoadingState<TData | TXData> {

    const cmdPayload = commandPayload ?? cachePayload as TXPayload;

    //<editor-fold desc="Precondition">
    // Throw error if initial load has already been loaded
    if (this.alreadyLoaded(cachePayload)) {
      return LoadingState.FromError(() => new InitialLoadError('This cache action has already been loaded', cachePayload));
    }

    // Throw error if initial load has already been loaded for fallback
    if (this.fallbackCommand && 'alreadyLoaded' in this.fallbackCommand) {
      if (this.fallbackCommand.alreadyLoaded(cmdPayload)) {
        return LoadingState.FromError(() => new InitialLoadError('This cache fallback action has already been loaded', cachePayload))
      }
    }
    //</editor-fold>

    const requestId = this.options.requestId?.(cachePayload);

    this.context.startLoad(this, requestId);

    //<editor-fold desc="State">
    const sharedState = new Subject<TData | TXData | void>();
    const sharedLoadingState = new LoadingState(sharedState) as LoadingState<TData | TXData>;

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
    if (online && !this.options.cacheWhenOnline) {
      if (this.fallbackCommand) {
        emitFallback();
        this.context.endLoad(this, requestId)
      } else {
        sharedState.error(new CacheCommandError('Cache disabled online, but missing fallback', cachePayload));
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

          //<editor-fold desc="Concurrent Fallback">
          if (this.concurrentFallback) {

            // If fallback is not valid
            if (!online && !this.options.fallbackWhenOffline) {

              // If fallback is not valid, and cache wasn't valid, return error
              if (!this.valueIsValid(result)) {
                sharedState.error(new CacheCommandError(`Concurrent fallback isn't offline, and no value found in cache`, cachePayload));
                return;
              }

              // If fallback isn't valid, but cache was, return cache value
              sharedState.next(result);
              return;
            }

            // If fallback is valid, execute it
            emitFallback();
            return;
          }
          //</editor-fold>

          // If cache was valid, return cache
          if (this.valueIsValid(result)) {
            sharedState.next(result);
            return;
          }

          // If fallback is invalid return error
          if (!online && !this.options.fallbackWhenOffline) {
            sharedState.error(new CacheCommandError('No value found in cache, and no offline fallback', cachePayload));
            return;
          }

          // If fallback is valid, but cache wasn't, emit fallback
          emitFallback();
          return;
        }

        // If no fallback, and invalid cache return error
        if (!this.valueIsValid(result)) {
          sharedState.error(new CacheCommandError('No value found in cache, and no fallback', cachePayload));
          return;
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
  emit(payload: TPayload & TXPayload): void
  /**
   * Emit the command with no status returned
   * @param cachePayload - The cache payload
   * @param commandPayload - The command payload
   */
  emit(cachePayload: TPayload, commandPayload: TXPayload): void
  emit(cachePayload: TPayload | (TPayload & TXPayload), commandPayload?: TXPayload): void {
    this.observe(cachePayload, commandPayload as TXPayload);
  };

  /**
   * Emit the cache / fallback command with a Promise status
   * @param payload - The command/cache payload
   */
  emitAsync(payload: TPayload & TXPayload): Promise<TData | TXData>
  /**
   * Emit the cache / fallback command with a Promise status
   * @param cachePayload - The cache payload
   * @param commandPayload - The command payload
   */
  emitAsync(cachePayload: TPayload, commandPayload: TXPayload): Promise<TData | TXData>
  emitAsync(cachePayload: TPayload | (TPayload & TXPayload), commandPayload?: TXPayload): Promise<TData | TXData> {
    return this.observe(cachePayload, commandPayload as TXPayload).resultAsync;
  };
}
