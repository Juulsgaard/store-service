import {logFailedAction, logSuccessfulAction} from "../models/logging";
import {Observable, shareReplay} from "rxjs";
import {CommandAction, Reducer} from "../models/store-types";
import {StoreServiceContext} from "../configs/command-config";
import {ActionCancelledError, PayloadCommand, QueueAction} from "../models";
import {IValueRequestState, requestState} from "../utils/request-state";
import {parseError} from "@juulsgaard/ts-tools";
import {untracked} from "@angular/core";

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
export class DeferredCommand<TState, TPayload, TData> extends PayloadCommand<TState, TPayload, TData> {

  readonly isSync = true;

  get initialLoad() {
    return false;
  }

  constructor(
    context: StoreServiceContext<TState>,
    private readonly options: DeferredCommandOptions<TPayload, TData>,
    private readonly reducer: (state: TState, data: TPayload) => TState
  ) {
    super(context, undefined);
  }

  override canEmit(_payload: TPayload): boolean {
    return true;
  }

  /**
   * Dispatch the command and return a RequestState to monitor request progress
   * @param payload - The command payload
   */
  emit(payload: TPayload): IValueRequestState<TData> {

    const requestId = undefined;

    this.context.startLoad(this, requestId);

    let state: IValueRequestState<TData> | undefined = undefined;
    const output = requestState.writable<TData>(() => state?.cancel());

    const action = () => this.options.action(payload);

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

        this.context.endLoad(this, requestId);

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

        const reducer = (storeState: TState) => this.reducer(storeState, payload);
        subscriber.next(reducer);

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
      () => output.cancel(),
      false,
      true
    );

    // Send Queue Action
    this.context.applyCommand(queueAction);

    return output.asReadonly();
  };

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
