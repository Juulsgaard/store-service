import {Subscription, Unsubscribable} from "rxjs";
import {BaseCommand, QueueAction, Reducer} from "../models";
import {Signal, untracked} from "@angular/core";

export class ActionQueue<T> {

  private readonly queue: QueueAction<T>[] = [];
  private readonly cmdLocks = new Set<BaseCommand>();
  private transaction?: Unsubscribable;
  private readonly subscriptions = new Subscription();
  private executing: {interrupt: boolean}|undefined = undefined;

  constructor(private readonly state: Signal<T>, private readonly setState: (newState: T) => void) {
  }

  private execute() {
    if (this.executing) return;
    this.executing = {interrupt: true};

    try {
      let cont = true;
      while (cont) {
        if (this.executing?.interrupt) return;
        cont = this.dequeue();
      }
    } finally {
      this.executing = undefined;
    }
  }

  /**
   * Execute the next action in the queue.
   * @private
   * @return continue - Returns true if the queue should continue executing
   */
  private dequeue(): boolean {
    if (this.transaction) return false;
    if (!this.queue.length) return false;

    // Find and extract first action that isn't locked
    const actionIndex = this.queue.findIndex(x => !this.cmdLocks.has(x.type))
    if (actionIndex < 0) return false;
    const action = this.queue.splice(actionIndex, 1)[0]!;

    // Execute action
    if (action.runInTransaction) {
      this.runTransaction(action);
      return false;
    }

    if (action.queued) {
      this.runQueued(action);
      return true;
    }

    this.run(action);
    return true;
  }

  /**
   * Apply an action in a transaction
   * @param action
   * @private
   */
  private runTransaction(action: QueueAction<T>) {

    const snapshot = untracked(this.state);
    let finished = false;

    const finish = () => {
      this.transaction = undefined;
      finished = true;
      this.execute();
    }

    const rollBack = () => {
      this.applyReducer(() => snapshot);
      finish();
    }

    const sub = this.transaction = action.run().subscribe({
      next: x => this.applyReducer(x),
      error: rollBack,
      complete: finish,
    });

    this.subscriptions.add(sub);

    if (!finished) this.transaction = sub;
  }

  /**
   * Apply a queued action
   * @param action
   * @private
   */
  private runQueued(action: QueueAction<T>) {
    this.cmdLocks.add(action.type);

    const finish = () => {
      this.cmdLocks.delete(action.type);
      this.execute();
    }

    const sub = action.run().subscribe({
      next: x => this.applyReducer(x),
      error: finish,
      complete: finish,
    });

    this.subscriptions.add(sub);
  }

  /**
   * Apply a simple action
   * @param action
   */
  private run(action: QueueAction<T>) {
    const sub = action.run().subscribe(x => this.applyReducer(x));
    this.subscriptions.add(sub);
  }

  private applyReducer(reducer: Reducer<T>) {
    this.setState(reducer(untracked(this.state)));
  }

  public clear() {
    this.subscriptions.unsubscribe();
    this.queue.length = 0;
    this.cmdLocks.clear();
    this.transaction = undefined;
    if (this.executing) this.executing.interrupt = true;
  }

  public addAction(action: QueueAction<T>) {
    this.queue.push(action);
    this.execute();
  }
}
