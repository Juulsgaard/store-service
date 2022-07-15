import {BehaviorSubject, concatMap, distinctUntilChanged, EMPTY, Observable, shareReplay, Subject, Subscription} from "rxjs";
import {StoreClientCommandConfig, StoreCommandConfig, StoreServiceContext} from "./configs/command-config";
import {Reducer, StoreCommand} from "./models/store-types";
import {IStoreConfigService} from "./models/store-config-service";
import {catchError} from "rxjs/operators";
import {ActionCommand} from "./commands/action-command";
import {arrToMap, deepCopy, deepFreeze, slugify, titleCase} from "@consensus-labs/ts-tools";
import {QueueAction} from "./models/queue-action";

/**
 * A service managing the store state
 */
export abstract class StoreService<TState extends Record<string, any>> {

  private _state$: BehaviorSubject<TState>;
  /**
   * The state observable
   */
  state$: Observable<TState>;

  /**
   * The current state
   */
  get state(): TState {
    return this._state$.value;
  }

  /**
   * Generated names for all actions
   * @private
   */
  private _actionNames?: Map<StoreCommand<TState>, string>;
  private get actionNames(): Map<StoreCommand<TState>, string> {
    if (this._actionNames) return this._actionNames;
    this._actionNames = arrToMap(
      Object.entries(this).filter(([_, val]) => val instanceof StoreCommand),
      ([_, val]) => val,
      ([key]) => titleCase(key)
    );
    return this._actionNames;
  }

  /**
   * Generated name for the store
   * @private
   */
  private readonly storeName: string;

  /**
   * The current loading state of all commands
   * @private
   */
  private loadStates = new Map<StoreCommand<TState>, BehaviorSubject<number | undefined>>();

  /**
   * A context object that allows commands to interact with the store
   * @private
   */
  protected context: StoreServiceContext<TState> = {
    getCommandName: cmd => this.getCommandName(cmd),
    applyCommand: reducer$ => this.reducerQueue$.next(reducer$),
    getLoadState: (cmd: StoreCommand<TState>) => this.getLoadState$(cmd).value,
    getLoadState$: (cmd: StoreCommand<TState>) => this.getLoadState$(cmd).asObservable(),
    displayError: (msg, error) => this.configService.displayError(msg, error),
    displaySuccess: (message: string) => this.configService.displaySuccess(message),
    startLoad: (cmd: StoreCommand<TState>) => this.startLoad(cmd),
    endLoad: (cmd: StoreCommand<TState>) => this.endLoad(cmd),
    isProduction: this.configService.isProduction
  }

  /**
   * A queue of reducer transactions
   * Every observable is a transaction that has to complete before the next can start
   * @private
   */
  private reducerQueue$!: Subject<QueueAction<TState>>;
  private queueSub?: Subscription;

  protected constructor(private initialState: TState, private configService: IStoreConfigService) {
    this._state$ = new BehaviorSubject(this.freeze(deepCopy(initialState)));
    this.state$ = this._state$.pipe(
      shareReplay({bufferSize: 1, refCount: true})
    );
    this.storeName = titleCase(this.constructor.name);

    this.startQueue();
  }

  //<editor-fold desc="Queue Logic">
  /**
   * Clear and set up the Reducer queue
   * @private
   */
  private startQueue() {
    this.queueSub?.unsubscribe();
    this.reducerQueue$ = new Subject();

    const subs = new Subscription();
    const queue: QueueAction<TState>[] = [];
    const typeQueues = new Set<StoreCommand<TState>>();
    let transaction: Observable<Reducer<TState>> | undefined;
    const self = this;

    function dequeue() {
      if (transaction) return;
      if (!queue.length) return;

      // Find first action that isn't blocked
      const actionIndex = queue.findIndex(x => !typeQueues.has(x.type))
      if (actionIndex < 0) return;
      const action = queue.splice(actionIndex, 1)[0];

      // Execute action
      if (action.runInTransaction) runTransaction(action);
      else if (action.queued) runQueued(action);
      else run(action);
    }

    function applyReducer(reducer: Reducer<TState>) {
      self.applyState(reducer(self._state$.value));
    }

    // Apply a simple action
    function run(action: QueueAction<TState>) {
      subs.add(action.run().subscribe(applyReducer));
      dequeue();
    }

    // Apply an action in a transaction
    function runTransaction(action: QueueAction<TState>) {

      const snapshot = self._state$.value;
      transaction = action.run();

      function finish() {
        transaction = undefined;
        dequeue();
      }

      subs.add(transaction.subscribe({
        next: applyReducer,
        error: () => {
          applyReducer(() => snapshot);
          finish();
        },
        complete: finish,
      }));
    }

    // Apply a queued action
    function runQueued(action: QueueAction<TState>) {
      typeQueues.add(action.type);

      function finish() {
        typeQueues.delete(action.type);
        dequeue();
      }

      subs.add(action.run().subscribe({
        next: applyReducer,
        error: finish,
        complete: finish,
      }));
    }

    subs.add(this.reducerQueue$.subscribe(action => {
      queue.push(action);
      dequeue();
    }));

    this.queueSub = subs;
  }

  //</editor-fold>

  /**
   * Apply a new state to the store
   * @param state - The new state
   * @private
   */
  private applyState(state: TState): boolean {
    if (this._state$.value === state) return false;
    this._state$.next(this.freeze(state));
    return true;
  }

  /**
   * Get a subject with the loading state of a Command
   * @param cmd - The command
   * @private
   */
  private getLoadState$(cmd: StoreCommand<TState>) {
    let sub = this.loadStates.get(cmd);
    if (sub) return sub;

    sub = new BehaviorSubject<number | undefined>(undefined);
    this.loadStates.set(cmd, sub);
    return sub;
  }

  /**
   * Mark a command as having started loading
   * @param cmd - The command
   * @private
   */
  private startLoad(cmd: StoreCommand<TState>) {
    const sub = this.getLoadState$(cmd);
    sub.next((sub.value ?? 0) + 1);
  }

  /**
   * Mark a command as having finished loading
   * @param cmd - The command
   * @private
   */
  private endLoad(cmd: StoreCommand<TState>) {
    const sub = this.getLoadState$(cmd);
    sub.next((sub.value ?? 1) - 1);
  }

  /**
   * Get the display name of a command
   * @param cmd
   * @private
   */
  private getCommandName(cmd: StoreCommand<TState>) {
    return `[${this.storeName}] ${this.actionNames.get(cmd) ?? 'N/A'}`;
  }

  /**
   * Apply deep freeze on an object
   * Only freezes in dev environments
   * @param data - The data to freeze
   * @private
   */
  private freeze<T extends object>(data: T): T {
    if (!this.configService.isProduction) return deepFreeze(data) as T;
    return data;
  }

  /**
   * Reset the entire store
   */
  reset() {

    //Restart the queue
    this.startQueue();

    this._state$.next(this.freeze(deepCopy(this.initialState)));
    this.loadStates.forEach(x => x.next(undefined));
  }


  /**
   * Create a command and supply a client for the command action
   * @param client - The action client
   * @protected
   */
  protected command<TClient>(client: TClient): StoreClientCommandConfig<TState, TClient>
  /**
   * Create a command
   * @protected
   */
  protected command(): StoreCommandConfig<TState>
  protected command<TClient>(client?: TClient): StoreCommandConfig<TState> | StoreClientCommandConfig<TState, TClient> {
    return client
      ? new StoreClientCommandConfig(this.context, client)
      : new StoreCommandConfig(this.context);
  }

  /**
   * Create a selector
   * @param pipe - The observable modification for the selector
   * @protected
   */
  protected selector<TSelect>(pipe: (state$: Observable<TState>) => Observable<TSelect>) {
    return pipe(this.state$).pipe(
      distinctUntilChanged(),
      shareReplay({bufferSize: 1, refCount: true})
    );
  }
}

