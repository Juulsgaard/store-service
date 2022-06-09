import {concatMap, EMPTY, mergeMap, Observable, of, Subject, Subscription, switchMap} from "rxjs";
import {logFailedAction, logSuccessfulAction} from "../models/logging";
import {CommandAction, StoreCommand} from "../models/store-types";
import {ActionCommandError} from "../models/errors";
import {catchError} from "rxjs/operators";
import {StoreServiceContext} from "../configs/command-config";
import {LoadingState} from "../loading-state";


/**
 * The options for an Action Command
 * @internal
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

interface ActionEmission<TPayload, TData> {
  payload: TPayload;
  data$: Observable<TData>;
}

/**
 * A command that triggers an action, and then applies a reducer
 */
export class ActionCommand<TState, TPayload, TData> extends StoreCommand<TState> {

  private actionQueue!: Subject<ActionEmission<TPayload, TData>>;
  private queueSubscription?: Subscription;

  /** @internal */
  constructor(
    context: StoreServiceContext<TState>,
    private readonly options: ActionCommandOptions<TPayload, TData>,
    private readonly reducer: (state: TState, data: TData, payload: TPayload) => TState
  ) {
    super(context);
    this.startQueue();
  }

  /**
   * Clear and set up the action queue
   * @private
   */
  private startQueue() {

    this.queueSubscription?.unsubscribe();
    this.actionQueue = new Subject();

    // This map takes an emission, listens to error and success states, and returns an empty observable
    const mapping = (x: ActionEmission<TPayload, TData>) => {
      const startedAt = Date.now();
      return x.data$.pipe(
        catchError(error => {
          this.onFailure(x.payload, error, startedAt)
          return EMPTY;
        }),
        switchMap(data => {
          this.onSuccess(x.payload, data, startedAt);
          return EMPTY;
        })
      )
    };

    // If the commands should be queued, then use concat map (Next trigger won't be activated before the previous one has resolved)
    // If no queue, use a merge map, to just forward all requests in the order they finish
    this.queueSubscription = this.actionQueue.pipe(
      this.options.queue ? concatMap(mapping) : mergeMap(mapping)
    ).subscribe();
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
    const state = LoadingState.Delayed(() => this.options.action(payload), this.options.modify);

    // Queue up the Command
    this.actionQueue.next({
      payload,
      data$: state.trigger$
    });

    state.finally(() => this.context.endLoad(this));

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

    // Apply reducer
    this.context.applyCommand(of((state: TState) => this.reducer(state, result, payload)))

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

  /**
   * Resets the command and cancels all pending actions
   */
  reset() {
    this.startQueue();
  }
}
