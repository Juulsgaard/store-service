import {
  BehaviorSubject, distinctUntilChanged, filter, isObservable, Observable, Subject, Subscription, tap
} from "rxjs";
import {StoreClientCommandConfig, StoreCommandConfig, StoreServiceContext} from "./configs/command-config";
import {Reducer} from "./models/store-types";
import {IStoreConfigService} from "./models/store-config-service";
import {map} from "rxjs/operators";
import {arrToMap, deepCopy, deepFreeze, titleCase} from "@juulsgaard/ts-tools";
import {QueueAction} from "./models/queue-action";
import {StoreCommand} from "./models/base-commands";
import {cache} from "@juulsgaard/rxjs-tools";

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

  //<editor-fold desc="Loading State">
  /**
   * The current loading state of all commands
   * @private
   */
  private loadStates = new Map<StoreCommand<TState>, BehaviorSubject<number | undefined>>();

  /**
   * The current loading state of all commands grouped on RequestId
   * @private
   */
  private requestLoadStates = new Map<StoreCommand<TState>, Map<string, BehaviorSubject<number | undefined>>>();
  //</editor-fold>

  //<editor-fold desc="Failure State">
  /**
   * The current failure state of all commands
   * @private
   */
  private failStates = new Map<StoreCommand<TState>, BehaviorSubject<boolean>>();

  /**
   * The current failure state of all commands grouped on RequestId
   * @private
   */
  private requestFailStates = new Map<StoreCommand<TState>, Map<string, BehaviorSubject<boolean>>>();
  //</editor-fold>

  /**
   * A context object that allows commands to interact with the store
   * @private
   */
  protected context: StoreServiceContext<TState>;

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
      cache()
    );
    this.storeName = titleCase(this.constructor.name);

    this.startQueue();

    this.context = {
      getCommandName: cmd => this.getCommandName(cmd),
      applyCommand: reducer$ => this.reducerQueue$.next(reducer$),
      getLoadState: (cmd: StoreCommand<TState>, requestId?: string) => this.getLoadState$(cmd, requestId).value,
      getLoadState$: (cmd: StoreCommand<TState>, requestId?: string) => this.getLoadState$(cmd, requestId).asObservable(),
      getFailureState$: (cmd: StoreCommand<TState>, requestId?: string) => this.getFailureState$(cmd, requestId).asObservable(),
      displayError: this.configService.displayError.bind(this.configService),
      displaySuccess: this.configService.displaySuccess.bind(this.configService),
      logActionRetry: this.configService.logActionRetry.bind(this.configService),
      startLoad: (cmd: StoreCommand<TState>, requestId?: string) => {
        this.startLoad(cmd);
        if (requestId) this.startLoad(cmd, requestId)
      },
      endLoad: (cmd: StoreCommand<TState>, requestId?: string) => {
        this.endLoad(cmd);
        if (requestId) this.endLoad(cmd, requestId)
      },
      failLoad: (cmd: StoreCommand<TState>, requestId?: string) => {
        this.failLoad(cmd);
        if (requestId) this.failLoad(cmd, requestId)
      },
      resetFailState: (cmd: StoreCommand<TState>, requestId?: string) => {
        this.resetFailState(cmd);
        if (requestId) this.resetFailState(cmd, requestId)
      },
      isProduction: this.configService.isProduction,
      errorIsCritical: this.configService.errorIsCritical.bind(this.configService)
    }
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
      const action = queue.splice(actionIndex, 1)[0]!;

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

  //<editor-fold desc="Get Load State">
  /**
   * Get a subject with the loading state of a Command
   * @param cmd - The command
   * @param requestId - An optional RequestId
   * @private
   */
  private getLoadState$(cmd: StoreCommand<TState>, requestId?: string) {
    if (!requestId) {
      let sub = this.loadStates.get(cmd);
      if (sub) return sub;

      sub = new BehaviorSubject<number | undefined>(undefined);
      this.loadStates.set(cmd, sub);
      return sub;
    }

    let map = this.requestLoadStates.get(cmd);
    if (!map) {
      map = new Map();
      this.requestLoadStates.set(cmd, map);
    }

    let sub = map.get(requestId);
    if (sub) return sub;

    sub = new BehaviorSubject<number | undefined>(undefined);
    map.set(requestId, sub);
    return sub;
  }
  //</editor-fold>

  //<editor-fold desc="Get Fail State">
  /**
   * Get a subject with the failure state of a Command
   * @param cmd - The command
   * @param requestId - An optional RequestId
   * @private
   */
  private getFailureState$(cmd: StoreCommand<TState>, requestId?: string) {
    if (!requestId) {
      let sub = this.failStates.get(cmd);
      if (sub) return sub;

      sub = new BehaviorSubject(false);
      this.failStates.set(cmd, sub);
      return sub;
    }

    let map = this.requestFailStates.get(cmd);
    if (!map) {
      map = new Map();
      this.requestFailStates.set(cmd, map);
    }

    let sub = map.get(requestId);
    if (sub) return sub;

    sub = new BehaviorSubject(false);
    map.set(requestId, sub);
    return sub;
  }

  /**
   * Get a subject with the failure state of a Command
   * @param cmd - The command
   * @param requestId - An optional RequestId
   * @private
   */
  private getFailureStateOrDefault$(cmd: StoreCommand<TState>, requestId?: string) {
    if (!requestId) {
      return this.failStates.get(cmd);
    }

    return this.requestFailStates.get(cmd)?.get(requestId);
  }
  //</editor-fold>

  //<editor-fold desc="Manage Fail / Load state">
  /**
   * Mark a command as having started loading
   * @param cmd - The command
   * @param requestId
   * @private
   */
  private startLoad(cmd: StoreCommand<TState>, requestId?: string) {
    const sub = this.getLoadState$(cmd, requestId);
    sub.next((sub.value ?? 0) + 1);

    // Reset fail state
    this.resetFailState(cmd, requestId);
  }

  /**
   * Mark a command as having finished loading
   * @param cmd - The command
   * @param requestId
   * @private
   */
  private endLoad(cmd: StoreCommand<TState>, requestId?: string) {
    const sub = this.getLoadState$(cmd, requestId);
    sub.next((sub.value ?? 1) - 1);

    // Reset fail state
    this.resetFailState(cmd, requestId);
  }

  /**
   * Mark a command as having finished loading with an error
   * @param cmd - The command
   * @param requestId
   * @private
   */
  private failLoad(cmd: StoreCommand<TState>, requestId?: string) {
    this.getFailureState$(cmd, requestId).next(true);

    const sub = this.getLoadState$(cmd, requestId);
    const val = sub.value ?? 1;

    // If initial load fails, set command as unloaded
    if (cmd.initialLoad && val === 1) {
      sub.next(undefined);
      return;
    }

    sub.next(val - 1);
  }

  private resetFailState(cmd: StoreCommand<TState>, requestId?: string) {
    this.getFailureStateOrDefault$(cmd, requestId)?.next(false);
  }
  //</editor-fold>

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
    this.requestLoadStates.forEach(cmd => cmd.forEach(x => x.next(undefined)));
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
   * Create a selector using RXJS
   * @param pipe - The observable modification for the selector
   * @protected
   */
  protected selector<TSelect>(pipe: (state$: Observable<TState>) => Observable<TSelect>): Observable<TSelect>
  /**
   * Create a selector from an existing observable
   * @protected
   * @param observable$
   */
  protected selector<TSelect>(observable$: Observable<TSelect>): Observable<TSelect>
  protected selector<TSelect>(pipe: ((state$: Observable<TState>) => Observable<TSelect>)|Observable<TSelect>): Observable<TSelect> {

    if (isObservable(pipe)) {
      return pipe.pipe(
        distinctUntilChanged(),
        cache()
      );
    }

    return pipe(this.state$).pipe(
      distinctUntilChanged(),
      cache()
    );
  }

  /**
   * Define a selector factory to reuse parameterized selectors
   * @param builder
   * @protected
   */
  protected selectorFactory<TPayload, TSelect>(
    builder: (payload: TPayload) => Observable<TSelect>
  ): (payload: TPayload) => Observable<TSelect>
  /**
   * Define a selector factory to reuse parameterized selectors
   * @param builder
   * @param getId
   * @protected
   */
  protected selectorFactory<TPayload, TSelect, TId>(
    builder: (payload: TPayload) => Observable<TSelect>,
    getId: (payload: TPayload) => TId
  ): (payload: TPayload) => Observable<TSelect>
  protected selectorFactory<TPayload, TSelect, TId>(
    builder: (payload: TPayload) => Observable<TSelect>,
    getId?: (payload: TPayload) => TId
  ): (payload: TPayload) => Observable<TSelect> {

    getId ??= (x: any) => x as TId;
    const lookup = new Map<TId, Observable<TSelect>>();

    // Method that loads / generates a selector on demand
    const getSelector = (payload: TPayload) => {
      const id = getId!(payload);
      let selector = lookup.get(id);

      if (!selector) {
        selector = builder(payload).pipe(
          distinctUntilChanged(),
          // Remove the observable when it's no longer used
          tap({finalize: () => lookup.delete(id)}),
          // Multicast the selector
          cache()
        );
        lookup.set(id, selector);
      }

      return selector;
    }

    return payload => new Observable<TSelect>(subscriber => {
      // Get/Create selector on subscribe
      return getSelector(payload).subscribe(subscriber);
    });
  }

  /**
   * Create a basic selector
   * @protected
   * @param selector - A method to map the state to the desired shape
   */
  protected select<TSelect>(selector: (state: TState) => TSelect) {
    return this.selector(state$ => state$.pipe(map(selector)))
  }

  /**
   * Create a basic with a nullability filter
   * @protected
   * @param selector - A method to map the state to the desired shape
   * @param modify - Modify the non-nullable data
   */
  protected selectNotNull<TSelect, TMod>(selector: (state: TState) => TSelect, modify: (data: NonNullable<TSelect>) => TMod): Observable<TMod>;
  /**
   * Create a basic with a nullability filter
   * @protected
   * @param selector - A method to map the state to the desired shape
   */
  protected selectNotNull<TSelect>(selector: (state: TState) => TSelect): Observable<NonNullable<TSelect>>;
  protected selectNotNull<TSelect, TMod>(selector: (state: TState) => TSelect, modify?: (data: NonNullable<TSelect>) => TMod): Observable<NonNullable<TSelect>|TMod> {
    return this.selector<NonNullable<TSelect>|TMod>(state$ => {
      const base$ = state$.pipe(map(selector), filter((x) : x is NonNullable<TSelect> => x != null));
      if (!modify) return base$;
      return base$.pipe(map(modify));
    });
  }
}

