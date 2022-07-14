import {Reducer, StoreCommand} from "./store-types";
import {EMPTY, isObservable, Observable, of, tap} from "rxjs";

export class QueueAction<TState> {

  constructor(
    public type: StoreCommand<TState>,
    private action: () => Reducer<TState>|Observable<Reducer<TState>>|void,
    private onCancel?: () => void,
    public queued: boolean = false,
    public runInTransaction = false,
  ) {

  }

  /**
   * Execute the action and return an observable with the resulting reducer
   * Observable fails if the actions fails
   * Unsubscribing from the observable will cancel the action
   * Observable can be empty
   */
  run(): Observable<Reducer<TState>> {
    const result = this.action();
    if (!result) return EMPTY;

    if (isObservable(result)) {
      return result.pipe(tap({unsubscribe: () => this.onCancel?.()}));
    }

    return of(result);
  }
}
