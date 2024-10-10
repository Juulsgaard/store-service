import {Observable, shareReplay} from "rxjs";
import {logFailedAction, logSuccessfulAction} from "../models/logging";
import {CommandAction, Reducer} from "../models/store-types";
import {StoreServiceContext} from "../configs/command-config";
import {retryAction} from "../lib/retry";
import {IdMap} from "../lib/id-map";
import {untracked} from "@angular/core";
import {parseError} from "@juulsgaard/ts-tools";
import {ActionCancelledError, PayloadCommand, QueueAction} from "../models";
import {IValueRequestState, requestState} from "@juulsgaard/signal-tools";


/**
 * The options for an Action Command
 */
export interface ActionCommandOptions<TPayload, TData> {
  readonly action: CommandAction<TPayload, TData>;
  initialLoad: boolean;
  requestId?: IdMap<TPayload>;
  showError: boolean;
  errorMessage?: string;
  successMessage?: string | ((data: TData, payload: TPayload) => string);
  modify?: (data: TData) => TData | void;
  queue: boolean;
  cancelConcurrent: boolean;
  /** An effect action that is triggered after a successful command action */
  afterEffect?: (data: TData, payload: TPayload) => void;
  /** An effect action that is triggered after a successful command action, but before the reducer */
  preEffect?: (data: TData, payload: TPayload) => void;
  /** A list of retired. Every number represents the amount of time to wait before the retry attempt */
  retries?: number[];
}

/**
 * A command that triggers an action, and then applies a reducer
 */
export class ActionCommand<TState, TPayload, TData> extends PayloadCommand<TState, TPayload, TData> {

  readonly isSync = false;

  get initialLoad() {
    return this.options.initialLoad
  }

  constructor(
    context: StoreServiceContext<TState>,
    private readonly options: ActionCommandOptions<TPayload, TData>,
    private readonly reducer: (state: TState, data: TData, payload: TPayload) => TState
  ) {
    super(context, options.requestId);
  }

  //<editor-fold desc="Validation">
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

  //</editor-fold>

  /**
   * Dispatch the command and return a RequestState to monitor command progress
   * @param payload - The command payload
   * @param force - Ignore initial load constraint
   */
  emit(payload: TPayload, force = false): IValueRequestState<TData> {

    if (!force) {
      const error = this.canEmitError(payload);
      if (error) return requestState.error<TData>(error);
    }

    const requestId = this.getRequestId?.(payload);

    this.context.startLoad(this, requestId);

    let state: IValueRequestState<TData> | undefined = undefined;
    const output = requestState.writable<TData>(() => state?.cancel());

    const action = this.options.retries
      ? retryAction(
        () => this.options.action(payload),
        this.options.retries,
        this.context.errorIsCritical,
        this.logRetry.bind(this)
      )
      : () => this.options.action(payload);

    //<editor-fold desc="Execution logic">
    const execute$ = new Observable<Reducer<TState>>(subscriber => {

      // handle failed request
      const onError = (error: Error) => {

        this.logFailure(payload, error, startedAt);
        this.context.failLoad(this, error, requestId);

        subscriber.error(error);

        output.setError(error);
      }

      // Handle successful request
      const onValue = (value: TData) => {

        this.logSuccess(payload, value, startedAt);

        this.options.preEffect?.(value, payload);
        this.context.endLoad(this, requestId);

        const reducer = (storeState: TState) => this.reducer(storeState, value, payload);
        subscriber.next(reducer);
        subscriber.complete();

        this.options.afterEffect?.(value, payload)
        output.setValue(value);
      }

      if (untracked(output.cancelled)) {
        const error = new ActionCancelledError(this, "Action cancelled before execution", payload);
        onError(error);
        return;
      }

      const startedAt = Date.now();

      try {
        const result = action();
        state = requestState(result);
        state.then(onValue, onError);

        return () => {
          state?.cancel(() => new ActionCancelledError(this, "Action cancelled during execution", payload));
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
      this.options.queue
    );

    // Send Queue Action
    this.context.applyCommand(queueAction);

    return output.asReadonly();
  };

  private logRetry(attempt: number, nextDelay: number) {
    this.context.logActionRetry(this.name, attempt, nextDelay);
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
    if (this.options.showError) {
      this.context.displayError(this.options.errorMessage, error);
    }

    if (!this.context.isProduction) logFailedAction(this.name, startedAt, payload, error);
  }
}
