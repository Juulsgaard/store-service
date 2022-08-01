import {tap} from "rxjs";
import {logFailedAction, logSuccessfulAction} from "../models/logging";
import {CommandAction} from "../models/store-types";
import {InitialLoadError} from "../models/errors";
import {map} from "rxjs/operators";
import {StoreServiceContext} from "../configs/command-config";
import {LoadingState} from "../loading-state";
import {QueueAction} from "../models/queue-action";
import {retryAction} from "../utils/retry";
import {PayloadCommand} from "../models/base-commands";


/**
 * The options for an Action Command
 */
export interface ActionCommandOptions<TPayload, TData> {
  readonly action: CommandAction<TPayload, TData>;
  initialLoad: boolean;
  requestId?: (payload: TPayload) => string;
  showError: boolean;
  errorMessage?: string;
  successMessage?: string | ((data: TData, payload: TPayload) => string);
  modify?: (data: TData) => TData | void;
  queue: boolean;
  /** An effect action that is triggered after a successful command action */
  afterEffect?: (data: TData, payload: TPayload) => void;
  /** A list of retired. Every number represents the amount of time to wait before the retry attempt */
  retries?: number[];
}

/**
 * A command that triggers an action, and then applies a reducer
 */
export class ActionCommand<TState, TPayload, TData> extends PayloadCommand<TState, TPayload> {

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

  /**
   * @param payload
   * @internal
   */
  alreadyLoaded(payload: TPayload): boolean {
    if (!this.options.initialLoad) return false;

    if (this.options.requestId) {
      return this.context.getLoadState(this, this.options.requestId(payload)) !== undefined
    }

    return this.context.getLoadState(this) !== undefined;
  }

  /**
   * Dispatch the command and return a LoadingState to monitor command progress
   * @param payload - The command payload
   */
  observe(payload: TPayload): LoadingState<TData> {
    return this.execute(payload, false);
  }

  /**
   * Dispatch the command and return a LoadingState to monitor command progress
   * Will load initial load commands even if they have already been loaded
   * @param payload - The command payload
   */
  forceObserve(payload: TPayload): LoadingState<TData> {
    return this.execute(payload, true);
  }

  /**
   * Dispatch the command and return a LoadingState to monitor command progress
   * @param payload - The command payload
   * @param ignoreInitial - Ignore initial load constraint
   */
  private execute(payload: TPayload, ignoreInitial: boolean): LoadingState<TData> {

    // Throw error if initial load has already been loaded
    if (!ignoreInitial && this.alreadyLoaded(payload)) {
      return LoadingState.FromError(() => new InitialLoadError('This action has already been loaded', payload))
    }

    const requestId = this.options.requestId?.(payload);

    this.context.startLoad(this, requestId);

    // Create a delayed loading state
    const action = () => this.options.action(payload);
    const loadState = LoadingState.Delayed(
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
        // Use timeout to ensure effect runs after reducer
        setTimeout(() => this.options.afterEffect?.(data, payload));
      })
      .catch(() => this.context.failLoad(this, requestId))

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
  emit(payload: TPayload) {
    this.execute(payload, false);
  };

  /**
   * Emit the command with a Promise status
   * @param payload
   */
  emitAsync(payload: TPayload): Promise<TData> {
    return this.execute(payload, false).resultAsync;
  };
}
