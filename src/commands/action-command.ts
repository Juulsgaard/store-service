import {EMPTY, tap} from "rxjs";
import {logFailedAction, logSuccessfulAction} from "../models/logging";
import {CommandAction, StoreCommand} from "../models/store-types";
import {ActionCommandError} from "../models/errors";
import {catchError, map} from "rxjs/operators";
import {StoreServiceContext} from "../configs/command-config";
import {LoadingState} from "../loading-state";
import {QueueAction} from "../models/queue-action";


/**
 * The options for an Action Command
 */
export interface ActionCommandOptions<TPayload, TData> {
  readonly action: CommandAction<TPayload, TData>;
  initialLoad: boolean;
  showError: boolean;
  errorMessage?: string;
  successMessage?: string | ((data: TData, payload: TPayload) => string);
  modify?: (data: TData) => TData | void;
  queue: boolean;
}

/**
 * A command that triggers an action, and then applies a reducer
 */
export class ActionCommand<TState, TPayload, TData> extends StoreCommand<TState> {

  get initialLoad() {return this.options.initialLoad}

  constructor(
    context: StoreServiceContext<TState>,
    private readonly options: ActionCommandOptions<TPayload, TData>,
    private readonly reducer: (state: TState, data: TData, payload: TPayload) => TState
  ) {
    super(context);
  }

  /**
   * Dispatch the command and return a LoadingState to monitor command progress
   * @param payload - The command payload
   */
  observe(payload: TPayload): LoadingState<TData> {

    // Throw error if initial load has already been loaded
    if (this.options.initialLoad) {
      if (this.context.getLoadState(this) !== undefined) {
        return LoadingState.FromError(() => new ActionCommandError('This action has already been loaded', payload))
      }
    }

    this.context.startLoad(this);

    // Create a delayed loading state
    const loadState = LoadingState.Delayed(() => this.options.action(payload), this.options.modify);

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

    loadState.finally(() => this.context.endLoad(this));

    return loadState;
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
    this.observe(payload);
  };

  /**
   * Emit the command with a Promise status
   * @param payload
   */
  emitAsync(payload: TPayload): Promise<TData> {
    return this.observe(payload).resultAsync;
  };
}
