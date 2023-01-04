import {logFailedAction, logSuccessfulAction} from "../models/logging";
import {EMPTY, startWith, switchMap, tap} from "rxjs";
import {CommandAction, Reducer} from "../models/store-types";
import {StoreServiceContext} from "../configs/command-config";
import {LoadingState} from "../loading-state";
import {QueueAction} from "../models/queue-action";
import {StoreCommand} from "../models/base-commands";

/**
 * The options for a Deferred Command
 */
export interface DeferredCommandOptions<TPayload, TData> {
  readonly action: CommandAction<TPayload, TData>;
  showError: boolean;
  errorMessage?: string;
  successMessage?: string | ((data: TData, payload: TPayload) => string);
  /** An effect action that is triggered after a successful command action */
  afterEffect?: (data: TData, payload: TPayload) => void;
}

/**
 * A deferred command
 * This command will apply a selector and dispatch an action afterward
 * If the action fails, the command will roll back the store
 * This command type will lock the store using a transaction while active
 */
export class DeferredCommand<TState, TPayload, TData>  extends StoreCommand<TState> {

  get initialLoad() {
    return false;
  }

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

    this.context.startLoad(this);

    // Set up a delayed loading state
    const state = LoadingState.Delayed(() => this.options.action(payload))

    // Define the execution for the Command
    const execute = () => {
      const startedAt = Date.now();

      // Trigger action, send reducer and complete when API is done
      return state.trigger$.pipe(
        // Log success / error
        tap({
          next: result => this.onSuccess(payload, result, startedAt),
          error: error => this.onFailure(payload, error, startedAt)
        }),
        switchMap(() => EMPTY),
        // Start with reducer
        startWith<Reducer<TState>>(state => this.reducer(state, payload))
      )
    };

    // Send Queue Action
    this.context.applyCommand(new QueueAction<TState>(
      this,
      execute,
      () => state.cancel(),
      false,
      true
    ));

    state
      .then(data => {
        this.context.endLoad(this);
        // Use timeout to ensure effect runs after reducer
        setTimeout(() => this.options.afterEffect?.(data, payload));
      })
      .catch(() => this.context.failLoad(this));

    return state;
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
