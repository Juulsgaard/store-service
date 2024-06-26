import {combineLatest, distinctUntilChanged, EMPTY, Observable, of, Subject, switchMap, tap} from "rxjs";
import {logActionInformation, logFailedAction, logSuccessfulAction} from "../models/logging";
import {CommandAction} from "../models/store-types";
import {ActionCancelledError, CacheCommandError} from "../models/errors";
import {map} from "rxjs/operators";
import {StoreServiceContext} from "../configs/command-config";
import {QueueAction} from "../models/queue-action";
import {PlainCommand} from "./plain-command";
import {AsyncCommand, AsyncPayloadCommand, StoreCommandUnion} from "../models/base-commands";
import {IdMap, parseIdMap} from "../lib/id-map";
import {IValueLoadingState, Loading, LoadingState} from "@juulsgaard/rxjs-tools";


/**
 * The options for a Cache Command
 */
export interface CacheCommandOptions<TPayload, TData> {
  readonly action: CommandAction<{ options: CacheLoadOptions, payload: TPayload }, TData | undefined>;
  failCondition?: (data: TData) => boolean;
  errorMessage?: string;
  successMessage?: string | ((data: TData, payload: TPayload) => string);
  initialLoad: boolean;
  cancelConcurrent: boolean;
  requestId?: IdMap<TPayload>;

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
export class CacheCommand<TState, TPayload, TData, TXPayload, TXData> extends AsyncCommand<TState> {

  readonly isSync = false;

  protected getRequestId?: (payload: TPayload) => string;

  get initialLoad() {
    return this.options.initialLoad
  }

  cacheLoading$: Observable<boolean>;
  cacheLoaded$: Observable<boolean>;
  cacheFailed$: Observable<boolean>;

  constructor(
    context: StoreServiceContext<TState>,
    private readonly options: CacheCommandOptions<TPayload, TData>,
    private readonly reducer: (state: TState, data: TData, payload: TPayload) => TState,
    private fallbackCommand?: StoreCommandUnion<TState, TXPayload, TXData>,
    private concurrentFallback = false
  ) {
    super(context);
    this.getRequestId = this.options.requestId && parseIdMap(this.options.requestId);

    this.cacheLoading$ = this.loading$;
    this.cacheLoaded$ = this.loaded$;
    this.cacheFailed$ = this.failed$;

    if (fallbackCommand instanceof AsyncCommand) {
      this.loading$ = combineLatest([this.cacheLoading$, fallbackCommand.loading$]).pipe(
        map(([x, y]) => x || y),
        distinctUntilChanged()
      );

      this.loaded$ = combineLatest([this.cacheLoaded$, fallbackCommand.loaded$]).pipe(
        map(([x, y]) => x || y),
        distinctUntilChanged()
      );

      this.failed$ = combineLatest([this.cacheFailed$, fallbackCommand.failed$]).pipe(
        map(([x, y]) => x || y),
        distinctUntilChanged()
      );
    }
  }

  //<editor-fold desc="Cache Request Loading State">
  cacheLoadingById$(payload: TPayload) {
    if (!this.getRequestId) return this.loading$;
    return this.context.getLoadState$(this, this.getRequestId(payload)).pipe(
      map(x => !!x && x > 0),
      distinctUntilChanged()
    )
  }

  cacheLoadedById$(payload: TPayload) {
    if (!this.getRequestId) return this.loaded$;
    return this.context.getLoadState$(this, this.getRequestId(payload)).pipe(
      map(x => x !== undefined),
      distinctUntilChanged()
    )
  }

  cacheFailedById$(payload: TPayload) {
    if (!this.getRequestId) return this.failed$;
    return this.context.getFailureState$(this, this.getRequestId(payload)).pipe(
      distinctUntilChanged()
    )
  }

  cacheErrorById$(payload: TPayload) {
    if (!this.getRequestId) return this.error$;
    return this.context.getErrorState$(this, this.getRequestId(payload)).pipe(
      distinctUntilChanged()
    )
  }

  //</editor-fold>

  //<editor-fold desc="Combined Request Loading State">

  loadingById$(payload: TPayload & TXPayload): Observable<boolean>;
  loadingById$(cachePayload: TPayload, commandPayload: TXPayload): Observable<boolean>;
  loadingById$(cachePayload: TPayload | (TPayload & TXPayload), commandPayload?: TXPayload) {
    if (!this.getRequestId) return this.loading$;
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
    if (!this.getRequestId) return this.loading$;
    if (!this.fallbackCommand || !('loadedById$' in this.fallbackCommand)) return this.cacheLoadedById$(cachePayload);
    const cmdPayload = commandPayload ?? cachePayload as TXPayload;
    return combineLatest([this.cacheLoadedById$(cachePayload), this.fallbackCommand.loadedById$(cmdPayload)]).pipe(
      map(([x, y]) => x || y),
      distinctUntilChanged()
    );
  }

  failedById$(payload: TPayload & TXPayload): Observable<boolean>;
  failedById$(cachePayload: TPayload, commandPayload: TXPayload): Observable<boolean>;
  failedById$(cachePayload: TPayload | (TPayload & TXPayload), commandPayload?: TXPayload) {
    if (!this.getRequestId) return this.failed$;
    if (!this.fallbackCommand || !('failedById$' in this.fallbackCommand)) return this.cacheFailedById$(cachePayload);
    const cmdPayload = commandPayload ?? cachePayload as TXPayload;
    return combineLatest([this.cacheFailedById$(cachePayload), this.fallbackCommand.failedById$(cmdPayload)]).pipe(
      map(([x, y]) => x || y),
      distinctUntilChanged()
    );
  }

  errorById$(payload: TPayload & TXPayload): Observable<Error|undefined>;
  errorById$(cachePayload: TPayload, commandPayload: TXPayload): Observable<Error|undefined>;
  errorById$(cachePayload: TPayload | (TPayload & TXPayload), commandPayload?: TXPayload): Observable<Error|undefined> {
    if (!this.getRequestId) return this.error$;
    if (!this.fallbackCommand || !('errorById$' in this.fallbackCommand)) return this.cacheErrorById$(cachePayload);
    const cmdPayload = commandPayload ?? cachePayload as TXPayload;
    return combineLatest([this.cacheErrorById$(cachePayload), this.fallbackCommand.errorById$(cmdPayload)]).pipe(
      map(([x, y]) => x ?? y),
      distinctUntilChanged()
    );
  }

  //</editor-fold>

  private valueIsValid(data: TData | undefined): data is TData {
    return data != undefined && !this.options.failCondition?.(data);
  }

  alreadyLoaded(payload: TPayload): boolean {
    if (!this.options.initialLoad) return false;

    if (this.getRequestId) {
      return this.context.getLoadState(this, this.getRequestId(payload)) !== undefined
    }

    return this.context.getLoadState(this, undefined) !== undefined;
  }

  cancelConcurrent(payload: TPayload): boolean {
    if (!this.options.cancelConcurrent) return false;

    if (this.getRequestId) {
      return (this.context.getLoadState(this, this.getRequestId(payload)) ?? 0) > 0;
    }

    return (this.context.getLoadState(this, undefined) ?? 0) > 0;
  }

  /**
   * Dispatch the command/fallback and return a LoadingState to monitor progress of both
   * @param payload - The command/cache payload
   */
  observe(payload: TPayload & TXPayload): IValueLoadingState<TData | TXData>
  /**
   * Dispatch the command/fallback and return a LoadingState to monitor progress of both
   * @param cachePayload - The cache payload
   * @param commandPayload - The command payload
   */
  observe(cachePayload: TPayload, commandPayload: TXPayload): IValueLoadingState<TData | TXData>
  observe(cachePayload: TPayload | (TPayload & TXPayload), commandPayload?: TXPayload): IValueLoadingState<TData | TXData> {

    const cmdPayload = commandPayload ?? cachePayload as TXPayload;

    //<editor-fold desc="Precondition">

    // Throw error if initial load has already been loaded
    if (this.alreadyLoaded(cachePayload)) {
      return Loading.FromError(() => new ActionCancelledError('This cache action has already been loaded', cachePayload));
    }

    // Throw error if the action is concurrent and concurrent are set to be cancelled
    if (this.cancelConcurrent(cachePayload)) {
      return Loading.FromError(() => new ActionCancelledError('Actions was cancelled because another is already running', cachePayload))
    }

    // Throw error if initial load has already been loaded for fallback
    if (this.fallbackCommand && 'alreadyLoaded' in this.fallbackCommand) {
      if (this.fallbackCommand.alreadyLoaded(cmdPayload)) {
        return Loading.FromError(() => new ActionCancelledError('This cache fallback action has already been loaded', cachePayload))
      }
    }
    //</editor-fold>

    const requestId = this.getRequestId?.(cachePayload);

    this.context.startLoad(this, requestId);

    //<editor-fold desc="State">
    const sharedState = new Subject<TData | TXData | void>();
    const sharedLoadingState = Loading.Async<TData | TXData | void>(sharedState) as LoadingState<TData | TXData>;

    const online = typeof navigator == 'undefined' ? true : navigator.onLine;
    const maxAge = online ? this.options.onlineMaxAge : this.options.offlineMaxAge;
    const absoluteAge = online ? !!this.options.onlineAbsoluteAge : !!this.options.offlineAbsoluteAge;
    //</editor-fold>

    //<editor-fold desc="Fallback Helpers">

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

    const resetFallback = () => {
      if (!this.fallbackCommand) return;
      if (this.fallbackCommand instanceof AsyncPayloadCommand) {
        this.fallbackCommand.resetFailureStateById(cmdPayload);
        return;
      }
      if (this.fallbackCommand instanceof AsyncCommand) {
        this.fallbackCommand.resetFailState();
      }
    };

    //</editor-fold>

    // Check if cache should be used based on online state of client
    if (online && !this.options.cacheWhenOnline) {
      if (this.fallbackCommand) {
        emitFallback();
        this.context.endLoad(this, requestId)
      } else {
        const error = new CacheCommandError('Cache disabled online, but missing fallback', cachePayload);
        sharedState.error(error);
        this.context.failLoad(this, error, requestId)
      }
      return sharedLoadingState;
    }

    //<editor-fold desc="Cache Reducer Action">

    // Create a delayed loading state
    const cacheLoad = Loading.Delayed(
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

    //<editor-fold desc="Cache Value Parsing Helper">
    /**
     * A method that handles the cache result
     * @param result
     * @throws CacheCommandError - Throws error if invalid state is reached
     * @return valid - Returns true if value should be returned, false when fallback should be emitted
     */
    const validateCacheResult = (result: TData|undefined): boolean => {
      if (this.fallbackCommand) {

        //<editor-fold desc="Concurrent Fallback">
        if (this.concurrentFallback) {

          // If fallback is not valid
          if (!online && !this.options.fallbackWhenOffline) {

            // If fallback is not valid, and cache wasn't valid, return error
            if (!this.valueIsValid(result)) {
              throw new CacheCommandError(`Concurrent fallback isn't offline, and no value found in cache`, cachePayload);
            }

            // If fallback isn't valid, but cache was, return cache value
            resetFallback();
            return true;
          }

          // If fallback is valid, execute it
          return false;
        }
        //</editor-fold>

        // If cache was valid, return cache
        if (this.valueIsValid(result)) {
          resetFallback();
          return true;
        }

        // If fallback is invalid return error
        if (!online && !this.options.fallbackWhenOffline) {
          throw new CacheCommandError('No value found in cache, and no offline fallback', cachePayload);
        }

        // If fallback is valid, but cache wasn't, emit fallback
        return false;
      }

      // If no fallback, and invalid cache return error
      if (!this.valueIsValid(result)) {
        throw new CacheCommandError('No value found in cache, and no fallback', cachePayload);
      }

      // Default case - Emit cache result
      return true;
    }
    //</editor-fold>

    //<editor-fold desc="Post Cache Fallback logic">
    cacheLoad
      .then(result => {
        try {
          // Check if cache result is valid
          const valid = validateCacheResult(result);
          this.context.endLoad(this, requestId);

          // If valid return result
          if (valid) sharedState.next(result);
          // If invalid, emit the fallback
          else emitFallback();

        } catch (e: unknown) {
          // Handle fail states
          const error = e instanceof Error ? e : Error();
          this.context.failLoad(this, error, requestId);
          sharedState.error(error);
        }
      })
      .catch(err => {
        this.context.failLoad(this, err, requestId);
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
