import {tap} from "rxjs";
import {logFailedAction, logSuccessfulAction} from "../models/logging";
import {CommandAction} from "../models/store-types";
import {ActionCancelledError} from "../models/errors";
import {map} from "rxjs/operators";
import {StoreServiceContext} from "../configs/command-config";
import {QueueAction} from "../models/queue-action";
import {retryAction} from "../lib/retry";
import {AsyncPayloadCommand} from "../models/base-commands";
import {IdMap} from "../lib/id-map";
import {IValueLoadingState, Loading} from "@juulsgaard/rxjs-tools";


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
export class ActionCommand<TState, TPayload, TData> extends AsyncPayloadCommand<TState, TPayload> {

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
   * Dispatch the command and return a LoadingState to monitor command progress
   * @param payload - The command payload
   */
  override observe(payload: TPayload): IValueLoadingState<TData> {
    return this.execute(payload, false);
  }

  /**
   * Dispatch the command and return a LoadingState to monitor command progress
   * Will load initial load commands even if they have already been loaded
   * @param payload - The command payload
   */
  forceObserve(payload: TPayload): IValueLoadingState<TData> {
    return this.execute(payload, true);
  }

  /**
   * Dispatch the command and return a LoadingState to monitor command progress
   * @param payload - The command payload
   * @param ignoreInitial - Ignore initial load constraint
   */
  private execute(payload: TPayload, ignoreInitial: boolean): IValueLoadingState<TData> {

    // Throw error if initial load has already been loaded
    if (!ignoreInitial) {
      if (this.alreadyLoaded(payload)) {
        return Loading.FromError(() => new ActionCancelledError('This action has already been loaded', payload))
      }
      if (this.cancelConcurrent(payload)) {
        return Loading.FromError(() => new ActionCancelledError('Actions was cancelled because another is already running', payload))
      }
    }

    const requestId = this.getRequestId?.(payload);

    this.context.startLoad(this, requestId);

    // Create a delayed loading state
    const action = () => this.options.action(payload);
    const loadState = Loading.Delayed(
      this.options.retries
        ? retryAction(action, this.options.retries, this.context.errorIsCritical, this.logRetry.bind(this))
        : action,
      this.options.modify
    );

    // Define the execution for the Command
    const execute = () => {
      const startedAt = Date.now();

      // Trigger action and map result
      return loadState.trigger$.pipe(
        // Log errors
        tap({error: error => this.onFailure(payload, error, startedAt)}),
        // Generate reducer
        map(result => {
          this.onSuccess(payload, result, startedAt);
          return (state: TState) => this.reducer(state, result, payload);
        })
      )
    };

    // Send Queue Action
    this.context.applyCommand(new QueueAction<TState>(
      this,
      execute,
      () => loadState.cancel(),
      this.options.queue
    ));

    loadState
      .then(data => {
        this.context.endLoad(this, requestId);
        this.options.preEffect?.(data, payload);
        // Use timeout to ensure effect runs after reducer
        setTimeout(() => this.options.afterEffect?.(data, payload));
      })
      .catch(e => this.context.failLoad(this, e, requestId))

    return loadState;
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
   * Handle a failed action
   * @param payload
   * @param error
   * @param startedAt
   * @private
   */
  private onFailure(payload: TPayload, error: Error, startedAt?: number) {

    // Display error message
    if (this.options.showError) {
      this.context.displayError(this.options.errorMessage, error);
    }

    if (!this.context.isProduction) logFailedAction(this.name, startedAt, payload, error);
  }

  /**
   * Emit the command with no status returned
   * @param payload
   */
  override emit(payload: TPayload) {
    this.execute(payload, false);
  };

  /**
   * Emit the command with a Promise status
   * @param payload
   */
  override emitAsync(payload: TPayload): Promise<TData> {
    return this.execute(payload, false).resultAsync;
  };
}
