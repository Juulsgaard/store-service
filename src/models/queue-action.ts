import {Reducer} from "./store-types";
import {EMPTY, Observable} from "rxjs";
import {BaseCommand} from "./base-commands";

export class QueueAction<TState> {

  private hasRun = false;

  constructor(
    public type: BaseCommand,
    private execution$: Observable<Reducer<TState>>,
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

    if (this.hasRun) {
      console.error('Command execution instances can only be used once');
      return EMPTY;
    }

    this.hasRun = true;
    return this.execution$;
  }
}
