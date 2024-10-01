import {
  BaseStoreServiceContext, StoreClientCommandConfig, StoreCommandConfig, StoreServiceContext
} from "./configs/command-config";
import {AsyncCommand, BaseCommand, IStoreConfigService, StoreCommand} from "./models";
import {arrToMap, deepCopy, deepFreeze, titleCase} from "@juulsgaard/ts-tools";
import {DestroyRef, inject, signal, Signal, untracked, WritableSignal} from "@angular/core"
import {ActionQueue} from "./utils/action-queue";

/**
 * A service managing the store state
 */
export abstract class StoreService<TState extends Record<string, any>> {

  /**
   * Get the context object from a store.
   * This can be used to extend the Store with custom commands.
   * @param store - The store to extract the context from
   */
  static ExtractContext<T extends Record<string, any>>(store: StoreService<T>): BaseStoreServiceContext<T> {return store.context}

  private readonly _state: WritableSignal<TState>;
  /** The state signal */
  readonly state: Signal<TState>;

  private readonly queue: ActionQueue<TState>;

  /**
   * Generated names for all actions
   * @private
   */
  private _actionNames?: Map<BaseCommand, string>;
  private get actionNames(): Map<BaseCommand, string> {
    if (this._actionNames) return this._actionNames;
    this._actionNames = arrToMap(
      Object.entries(this).filter(([_, val]) => val instanceof BaseCommand),
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
  private loadStates = new Map<StoreCommand<TState>, WritableSignal<number | undefined>>();

  /**
   * The current loading state of all commands grouped on RequestId
   * @private
   */
  private requestLoadStates = new Map<StoreCommand<TState>, Map<string, WritableSignal<number | undefined>>>();
  //</editor-fold>

  //<editor-fold desc="Error State">
  /**
   * The current failure state of all commands
   * @private
   */
  private errorStates = new Map<StoreCommand<TState>, WritableSignal<Error|undefined>>();

  /**
   * The current failure state of all commands grouped on RequestId
   * @private
   */
  private requestErrorStates = new Map<StoreCommand<TState>, Map<string, WritableSignal<Error|undefined>>>();
  //</editor-fold>

  /**
   * A context object that allows commands to interact with the store
   * @private
   */
  protected context: StoreServiceContext<TState>;

  private configService: IStoreConfigService;
  private onDestroy = inject(DestroyRef);
  private disposed = false;

  protected constructor(private initialState: TState, configService?: IStoreConfigService) {
    this.configService = configService ?? inject(IStoreConfigService);

    this._state = signal(this.freeze(deepCopy(initialState)));
    this.state = this._state.asReadonly();

    const name = this.constructor.name.replace(/(^[_\W+]+|[_\W]+$)/g, '');
    this.storeName = titleCase(name);

    this.queue = new ActionQueue(this.state, x => this.applyState(x));

    this.context = {
      getCommandName: cmd => this.getCommandName(cmd),

      displaySuccess: msg => this.configService.displaySuccess(msg),
      displayError: (msg, error) => this.configService.displayError(msg, error),
      logActionRetry: (command, attempt, nextDelay) => this.configService.logActionRetry(command, attempt, nextDelay),

      errorIsCritical: error => this.configService.errorIsCritical(error),
      isProduction: this.configService.isProduction,

      applyCommand: reducer$ => {
        if (this.disposed) return;
        this.queue.addAction(reducer$);
      },

      getErrorState: (cmd, requestId) => this.getErrorState(cmd, requestId).asReadonly(),
      getLoadState: (cmd, requestId) => this.getLoadState(cmd, requestId).asReadonly(),

      startLoad: (cmd: AsyncCommand<TState>, requestId: string|undefined) => {
        this.startLoad(cmd, undefined);
        if (requestId) this.startLoad(cmd, requestId)
      },
      endLoad: (cmd: AsyncCommand<TState>, requestId: string|undefined) => {
        this.endLoad(cmd, undefined);
        if (requestId) this.endLoad(cmd, requestId)
      },
      failLoad: (cmd: AsyncCommand<TState>, error: Error, requestId: string) => {
        this.failLoad(cmd, error, undefined);
        if (requestId) this.failLoad(cmd, error, requestId)
      },
      resetErrorState: (cmd: AsyncCommand<TState>, requestId: string|undefined) => {
        this.resetErrorState(cmd, undefined);
        if (requestId) this.resetErrorState(cmd, requestId)
      }
    }

    this.onDestroy.onDestroy(() => {
      this.disposed = true;
      this.queue.clear();
    });
  }

  /**
   * Apply a new state to the store
   * @param state - The new state
   * @private
   */
  private applyState(state: TState): boolean {
    if (untracked(this._state) === state) return false;
    this._state.set(this.freeze(state));
    return true;
  }

  //<editor-fold desc="Get Load State">
  /**
   * Get a signal with the loading state of a Command
   * @param cmd - The command
   * @param requestId - An optional RequestId
   * @private
   */
  private getLoadState(cmd: AsyncCommand<TState>, requestId: string|undefined) {
    if (!requestId) {
      let state = this.loadStates.get(cmd);
      if (state) return state;

      state = signal<number | undefined>(undefined);
      this.loadStates.set(cmd, state);
      return state;
    }

    let map = this.requestLoadStates.get(cmd);
    if (!map) {
      map = new Map();
      this.requestLoadStates.set(cmd, map);
    }

    let state = map.get(requestId);
    if (state) return state;

    state = signal<number | undefined>(undefined);
    map.set(requestId, state);
    return state;
  }
  //</editor-fold>

  //<editor-fold desc="Get Error State">
  /**
   * Get a signal with the error state of a Command
   * @param cmd - The command
   * @param requestId - An optional RequestId
   * @private
   */
  private getErrorState(cmd: AsyncCommand<TState>, requestId: string|undefined) {
    if (!requestId) {
      let state = this.errorStates.get(cmd);
      if (state) return state;

      state = signal<Error | undefined>(undefined);
      this.errorStates.set(cmd, state);
      return state;
    }

    let map = this.requestErrorStates.get(cmd);
    if (!map) {
      map = new Map();
      this.requestErrorStates.set(cmd, map);
    }

    let state = map.get(requestId);
    if (state) return state;

    state = signal<Error | undefined>(undefined);
    map.set(requestId, state);
    return state;
  }
  //</editor-fold>

  //<editor-fold desc="Manage Fail / Load state">
  /**
   * Mark a command as having started loading
   * @param cmd - The command
   * @param requestId
   * @private
   */
  private startLoad(cmd: AsyncCommand<TState>, requestId: string|undefined) {
    const state = this.getLoadState(cmd, requestId);
    state.update(x => (x ?? 0) + 1);

    // Reset fail state
    this.resetErrorState(cmd, requestId);
  }

  /**
   * Mark a command as having finished loading
   * @param cmd - The command
   * @param requestId
   * @private
   */
  private endLoad(cmd: AsyncCommand<TState>, requestId: string|undefined) {
    const state = this.getLoadState(cmd, requestId);
    state.update(x => (x ?? 1) - 1);

    // Reset fail state
    this.resetErrorState(cmd, requestId);
  }

  /**
   * Mark a command as having finished loading with an error
   * @param cmd - The command
   * @param error
   * @param requestId
   * @private
   */
  private failLoad(cmd: AsyncCommand<TState>, error: Error, requestId: string|undefined) {

    this.getErrorState(cmd, requestId).set(error);

    const state = this.getLoadState(cmd, requestId);
    const val = untracked(state) ?? 1;

    // If initial load fails, set command as unloaded
    if (cmd.initialLoad && val === 1) {
      state.set(undefined);
      return;
    }

    state.set(val - 1);
  }

  private resetErrorState(cmd: AsyncCommand<TState>, requestId: string|undefined) {
    if (requestId) {
      this.requestErrorStates.get(cmd)?.get(requestId)?.set(undefined);
      return;
    }

    this.errorStates.get(cmd)?.set(undefined);
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
    this.queue.clear();

    this._state.set(this.freeze(deepCopy(this.initialState)));
    this.loadStates.forEach(x => x.set(undefined));
    this.requestLoadStates.forEach(cmd => cmd.forEach(x => x.set(undefined)));
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
}

