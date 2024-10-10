import {Observable, shareReplay} from "rxjs";
import {logActionInformation, logFailedAction, logSuccessfulAction} from "../models/logging";
import {CommandAction, Reducer} from "../models/store-types";
import {ActionCancelledError, CacheCommandError, PayloadCommand, QueueAction} from "../models";
import {StoreServiceContext} from "../configs/command-config";
import {IdMap} from "../lib/id-map";
import {computed, Signal, untracked} from "@angular/core";
import {parseError} from "@juulsgaard/ts-tools";
import {IValueRequestState, requestState} from "@juulsgaard/signal-tools";


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
export class CacheCommand<TState, TPayload, TData, TXPayload, TXData> extends PayloadCommand<TState, TPayload, TData | TXData> {

  readonly isSync = false;

  get initialLoad() {
    return this.options.initialLoad;
  }

  readonly anyLoading: Signal<boolean>;
  readonly anyLoaded: Signal<boolean>;
  readonly anyError: Signal<Error|undefined>;
  readonly anyFailed: Signal<boolean>;

  constructor(
    context: StoreServiceContext<TState>,
    private readonly options: CacheCommandOptions<TPayload, TData>,
    private readonly reducer: (state: TState, data: TData, payload: TPayload) => TState,
    readonly fallback?: PayloadCommand<TState, TXPayload, TXData>,
    private concurrentFallback = false
  ) {
    super(context, options.requestId);

    this.anyLoading = !fallback ? this.loading : computed(() => this.loading() || fallback.loading());
    this.anyLoaded = !fallback ? this.loaded : computed(() => this.loaded() || fallback.loaded());
    this.anyError = !fallback ? this.error : computed(() => this.error() || fallback.error());
    this.anyFailed = !fallback ? this.failed : computed(() => this.failed() || fallback.failed());
  }

  //<editor-fold desc="Request Load State">
  anyLoadingById(payload: TPayload&TXPayload): Signal<boolean>;
  anyLoadingById(payload: TPayload, fallbackPayload: TXPayload): Signal<boolean>;
  anyLoadingById(payload: TPayload | (TPayload&TXPayload), fallbackPayload?: TXPayload): Signal<boolean> {
    const fallback = this.fallback;

    const cmdVal = this.loadingById(payload);
    if (!fallback) return cmdVal;

    const fallbackVal = fallback.loadingById(fallbackPayload ?? payload as TXPayload);
    return computed(() => cmdVal() || fallbackVal());
  }

  anyLoadedById(payload: TPayload&TXPayload): Signal<boolean>;
  anyLoadedById(payload: TPayload, fallbackPayload: TXPayload): Signal<boolean>;
  anyLoadedById(payload: TPayload | (TPayload&TXPayload), fallbackPayload?: TXPayload): Signal<boolean> {
    const fallback = this.fallback;

    const cmdVal = this.loadedById(payload);
    if (!fallback) return cmdVal;

    const fallbackVal = fallback.loadedById(fallbackPayload ?? payload as TXPayload);
    return computed(() => cmdVal() || fallbackVal());
  }

  anyErrorById(payload: TPayload&TXPayload): Signal<Error | undefined>;
  anyErrorById(payload: TPayload, fallbackPayload: TXPayload): Signal<Error | undefined>;
  anyErrorById(payload: TPayload | (TPayload&TXPayload), fallbackPayload?: TXPayload): Signal<Error | undefined> {
    const fallback = this.fallback;

    const cmdVal = this.errorById(payload);
    if (!fallback) return cmdVal;

    const fallbackVal = fallback.errorById(fallbackPayload ?? payload as TXPayload);
    return computed(() => cmdVal() || fallbackVal());
  }

  anyFailedById(payload: TPayload&TXPayload): Signal<boolean>;
  anyFailedById(payload: TPayload, fallbackPayload: TXPayload): Signal<boolean>;
  anyFailedById(payload: TPayload | (TPayload&TXPayload), fallbackPayload?: TXPayload): Signal<boolean> {
    const fallback = this.fallback;

    const cmdVal = this.failedById(payload);
    if (!fallback) return cmdVal;

    const fallbackVal = fallback.failedById(fallbackPayload ?? payload as TXPayload);
    return computed(() => cmdVal() || fallbackVal());
  }
  //</editor-fold>

  private valueIsValid(data: TData | undefined): data is TData {
    return data != undefined && !this.options.failCondition?.(data);
  }

  private alreadyLoaded(payload: TPayload): boolean {
    if (!this.options.initialLoad) return false;
    return untracked(this.loadedById(payload));
  }

  private cancelConcurrent(payload: TPayload): boolean {
    if (!this.options.cancelConcurrent) return false;
    return untracked(this.loadingById(payload));
  }

  private canEmitError(payload: TPayload): Error | undefined {
    if (this.alreadyLoaded(payload)) {
      return new ActionCancelledError(this, 'This action has already been loaded', payload);
    }

    if (this.cancelConcurrent(payload)) {
      return new ActionCancelledError(this, 'Actions was cancelled because another is already running', payload);
    }

    return undefined;
  }

  canEmit(payload: TPayload): boolean {
    return !this.canEmitError(payload);
  }

  /**
   * Dispatch the command/fallback and return a LoadingState to monitor progress of both
   * @param payload - The command/cache payload
   */
  emit(payload: TPayload & TXPayload): IValueRequestState<TData | TXData>
  /**
   * Dispatch the command/fallback and return a LoadingState to monitor progress of both
   * @param cachePayload - The cache payload
   * @param commandPayload - The command payload
   */
  emit(cachePayload: TPayload, commandPayload: TXPayload): IValueRequestState<TData | TXData>
  emit(cachePayload: TPayload | (TPayload & TXPayload), commandPayload?: TXPayload): IValueRequestState<TData | TXData> {

    const error = this.canEmitError(cachePayload);
    if (error) return requestState.error<TData>(error);

    const cmdPayload = commandPayload ?? cachePayload as TXPayload;
    if (this.fallback) {
      if (!this.fallback.canEmit(cmdPayload)) {
        return requestState.error<TData>(() => new ActionCancelledError(this, 'The fallback command cannot run', cmdPayload));
      }
    }

    const requestId = this.getRequestId?.(cachePayload);

    this.context.startLoad(this, requestId);

    //<editor-fold desc="Setup">
    const online = typeof navigator == 'undefined' ? true : navigator.onLine;
    const maxAge = online ? this.options.onlineMaxAge : this.options.offlineMaxAge;
    const absoluteAge = online ? !!this.options.onlineAbsoluteAge : !!this.options.offlineAbsoluteAge;
    //</editor-fold>

    let state: IValueRequestState<TData|undefined> | undefined = undefined;
    const output = requestState.writable<TData|TXData>(() => state?.cancel());

    //<editor-fold desc="Skip Cache">

    // Check if cache should be used based on online state of client
    if (online && !this.options.cacheWhenOnline) {

      if (!this.fallback) {

        const error = new CacheCommandError('Cache disabled online, but missing fallback', cachePayload);
        output.setError(error);

        this.context.failLoad(this, error, requestId);
        return output;
      }

      this.fallback.emit(cmdPayload).then(
        value => output.setValue(value),
        error => output.setError(error)
      );

      this.context.endLoad(this, requestId)
      return output;
    }

    //</editor-fold>

    const cacheAction = () => this.options.action({
      options: {maxAge, absoluteAge},
      payload: cachePayload
    });

    //<editor-fold desc="Cache Value Parsing Helper">

    const resetFallback = () => {
      this.fallback?.resetFailureStateById(cmdPayload);
    };

    /**
     * A method that handles the cache result
     * @param isValid - True if the data is valid
     * @throws CacheCommandError - Throws error if invalid state is reached
     * @return state - Returns an error in failure states, true if the cache value should be used, and false if the fallback should be emitted
     */
    const getBehaviour = (isValid: boolean): Error|boolean|undefined => {

      //<editor-fold desc="No Fallback">
      if (!this.fallback) {

        // If no fallback, and invalid cache return error
        if (!isValid) {
          return new CacheCommandError('No value found in cache, and no fallback', cachePayload);
        }

        // Default case - Emit cache result
        return true;
      }
      //</editor-fold>

      //<editor-fold desc="Concurrent Fallback">
      if (this.concurrentFallback) {

        // If fallback is not valid
        if (!online && !this.options.fallbackWhenOffline) {

          // If fallback is not valid, and cache wasn't valid, return error
          if (!isValid) {
            return new CacheCommandError(`Concurrent fallback isn't offline, and no value found in cache`, cachePayload);
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
      if (isValid) {
        resetFallback();
        return true;
      }

      // If fallback is invalid return error
      if (!online && !this.options.fallbackWhenOffline) {
        return new CacheCommandError('No value found in cache, and no offline fallback', cachePayload);
      }

      // If fallback is valid, but cache wasn't, emit fallback
      return false;
    }
    //</editor-fold>

    //<editor-fold desc="Execution logic">
    const execute$ = new Observable<Reducer<TState>>(subscriber => {

      // Handle errors
      const onError = (error: Error) => {

        this.logFailure(cachePayload, error, startedAt);
        this.context.failLoad(this, error, requestId);

        subscriber.error(error);

        output.setError(error);
      }

      // Handle successful request
      const onValue = (value: TData|undefined) => {

        const isValid = this.valueIsValid(value);

        if (isValid) {
          const reducer = (storeState: TState) => this.reducer(storeState, value, cachePayload);
          subscriber.next(reducer);
          subscriber.complete();
          this.logSuccess(cachePayload, value, startedAt);
        } else {
          this.logNoCache(cachePayload, startedAt);
          subscriber.complete();
        }

        const behaviour = getBehaviour(isValid);

        // Handle Error state
        if (behaviour instanceof Error) {
          this.context.failLoad(this, behaviour, requestId);
          output.setError(behaviour);
          return;
        }

        // handle valid cache state
        if (behaviour) {
          output.setError(value);
          return;
        }

        // Handle "Load fallback" state
        this.fallback?.emit(cmdPayload).then(
          value => output.setValue(value),
          error => output.setError(error)
        );
      }

      if (untracked(output.cancelled)) {
        const error = new ActionCancelledError(this, "Action cancelled before execution", cachePayload);
        onError(error);
        return;
      }

      const startedAt = Date.now();

      try {
        const result = cacheAction();
        state = requestState(result);
        state.then(onValue, onError);

        return () => {
          state?.cancel(() => new ActionCancelledError(this, "Action cancelled during execution", cachePayload));
        };

      } catch (error: unknown) {
        onError(parseError(error));
      }

      return;

    }).pipe(shareReplay());
    //</editor-fold>

    const queueAction = new QueueAction<TState>(
      this,
      execute$,
      true
    );

    // Send Queue Action
    this.context.applyCommand(queueAction);

    return output;
  };

  /**
   * Handle a successful cache load with no content
   * @param payload
   * @param startedAt
   * @private
   */
  private logNoCache(payload: TPayload, startedAt?: number) {
    if (!this.context.isProduction) {
      logActionInformation(this.name, 'Cache is empty', startedAt, payload);
    }
  }

  /**
   * Handle a successful action
   * @param payload
   * @param result
   * @param startedAt
   * @private
   */
  private logSuccess(payload: TPayload, result: TData, startedAt?: number) {

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
   * Handle a failed action
   * @param payload
   * @param error
   * @param startedAt
   * @private
   */
  private logFailure(payload: TPayload, error: Error, startedAt?: number) {

    // Display error message
    if (this.options.errorMessage) {
      this.context.displayError(this.options.errorMessage, error);
    }

    if (!this.context.isProduction) logFailedAction(this.name, startedAt, payload, error);
  }
}
