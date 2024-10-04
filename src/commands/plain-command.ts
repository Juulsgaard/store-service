import {StoreServiceContext} from "../configs/command-config";
import {ActionCancelledError, PayloadCommand, QueueAction, Reducer} from "../models";
import {IValueRequestState, requestState} from "../utils/request-state";
import {Observable, shareReplay} from "rxjs";
import {untracked} from "@angular/core";

export class PlainCommand<TState, TData> extends PayloadCommand<TState, TData, TData> {

  readonly isSync = true;

  get initialLoad() {
    return false;
  }

  constructor(
    context: StoreServiceContext<TState>,
    private readonly reducer: (state: TState, data: TData) => TState
  ) {
    super(context, undefined);
  }

  override canEmit(_payload: TData): boolean {
    return true;
  }

  /**
   * Dispatch the command and return a RequestState to monitor when the reducer is applied to the store
   * @param payload - The command payload
   */
  override emit(payload: TData): IValueRequestState<TData> {

    const requestId = undefined;

    this.context.startLoad(this, requestId);

    const output = requestState.writable<TData>();

    const execute$ = new Observable<Reducer<TState>>(subscriber => {

      if (untracked(output.cancelled)) {
        const error = new ActionCancelledError(this, "Action cancelled before execution", payload);
        this.context.failLoad(this, error, requestId);
        subscriber.error(error);
        subscriber.complete();
        output.setError(error);
        return;
      }

      this.context.endLoad(this, requestId);

      const reducer = (storeState: TState) => this.reducer(storeState, payload);
      subscriber.next(reducer);
      subscriber.complete();

      output.setValue(payload);

    }).pipe(shareReplay());
    //</editor-fold>

    const queueAction = new QueueAction<TState>(
      this,
      execute$,
      () => output.cancel()
    );

    // Send Queue Action
    this.context.applyCommand(queueAction);

    return output.asReadonly();
  }

}
