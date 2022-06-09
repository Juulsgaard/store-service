import {logFailedAction, logSuccessfulAction} from "../models/logging";
import {ReplaySubject} from "rxjs";
import {CommandAction, StoreCommand} from "../models/store-types";
import {StoreServiceContext} from "../configs/command-config";
import {LoadingState} from "../loading-state";

/**
 * The options for a Deferred Command
 * @internal
 */
export interface DeferredCommandOptions<TPayload, TData> {
  readonly action: CommandAction<TPayload, TData>;
  showError: boolean;
  errorMessage?: string;
  successMessage?: string | ((data: TData, payload: TPayload) => string);
}

/**
 * A deferred command
 * This command will apply a selector and dispatch an action afterward
 * If the action fails, the command will roll back the store
 * This command type will lock the store using a transaction while active
 */
export class DeferredCommand<TState, TPayload, TData>  extends StoreCommand<TState> {

  /** @internal */
  constructor(
    context: StoreServiceContext<TState>,
    private readonly options: DeferredCommandOptions<TPayload, TData>,
    private readonly reducer: (state: TState, data: TPayload) => TState
  ) {
    super(context);
  }

  /**
   * Dispatch the command and return a LoadingState to monitor command progress
   * @param payload - The command payload
   */
  observe(payload: TPayload): LoadingState<TData> {

    // Create a transaction
    // The store command queue will help until the subject completes
    const transaction = new ReplaySubject<(state: TState) => TState>(1);
    let snapshot: TState;
    let startedAt: number;

    this.context.startLoad(this);

    // Set up a delayed loading state
    const loadingState = LoadingState.Delayed(() => this.options.action(payload))

    // Send the transaction to the store
    this.context.applyCommand(transaction);

    // Start the transaction with the eager reducer
    transaction.next((state: TState) => {
      // Save a snapshot for rollback
      snapshot = state;
      startedAt = Date.now();

      // Start the API call when the eager reducer is applied
      loadingState.trigger();

      return this.reducer(state, payload);
    });

    loadingState
      .then(result => this.onSuccess(payload, result, startedAt))
      .catch(error => {
        // If the API call fails, roll back the store
        if (snapshot !== undefined) transaction.next(() => snapshot);
        this.onFailure(payload, error, startedAt);
      })
      .finally(() => {
        // Complete the transaction when the API call has finished
        transaction.complete();
        this.context.endLoad(this);
      });

    return loadingState;
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