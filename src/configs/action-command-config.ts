import {ActionCommand, ActionCommandOptions} from "../commands/action-command";
import {
  ActionReducerCoalesce, ActionReducerData, applyScopedObjectReducer, createActionReducerCoalesce, listReducerScope,
  objectReducerScope, ReducerScope
} from "../models/reducer-scope";
import {ListReducer, ListSelector, ObjectReducer} from "../models/store-types";
import {StoreServiceContext} from "./command-config";
import {ArrayType, Conditional, KeysOfTypeOrNull, SimpleObject, ValueOfKey} from "@juulsgaard/ts-tools";
import {IdMap} from "../lib/id-map";


/**
 * A base config that allows modification of an option object
 */
class ActionCommandOptionConfig<TPayload, TData> {

  constructor(protected options: ActionCommandOptions<TPayload, TData>) {
  }

  /**
   * Marks the command as an initial load
   * This command can only be run once
   */
  isInitial(requestId?: IdMap<TPayload>): this {
    this.options.initialLoad = true;
    this.options.requestId = requestId ?? this.options.requestId;
    return this;
  }

  /**
   * Cancels requests that happen while one of similar type / id is ongoing
   */
  cancelConcurrent(requestId?: IdMap<TPayload>): this {
    this.options.cancelConcurrent = true;
    this.options.requestId = requestId ?? this.options.requestId;
    return this;
  }

  /**
   * Assign a request id to individual actions
   * @param requestId - Request Id generator
   */
  withRequestId(requestId: IdMap<TPayload>): this {
    this.options.requestId = requestId;
    return this;
  }

  /**
   * Don't show errors to the user
   */
  hideErrors(): this {
    this.options.showError = false;
    return this;
  }

  /**
   * Define a custom error message
   * @param message - The message
   */
  withErrorMessage(message: string): this {
    this.options.errorMessage = message;
    return this;
  }

  /**
   * Define a message to show the user on success
   * @param message - The message / message factory
   */
  withSuccessMessage(message: string | ((data: TData, payload: TPayload) => string)): this {
    this.options.successMessage = message;
    return this;
  }

  /**
   * Define a parser to apply to the data before the reducer
   * @param parser - A parser that modifies the data
   */
  withParser(parser: (data: TData) => TData | void): this {
    this.options.modify = parser;
    return this;
  }

  /**
   * Apply all actions of this type via a queue
   * New actions of this type won't be emitted until the previous ones have completed
   */
  withQueue(): this {
    this.options.queue = true;
    return this;
  }

  /**
   * Add an action that will be run after a successful command action
   * @param effect
   * @param beforeReducer - Make the effect execute before the reducer
   */
  withAfterEffect(effect: (data: TData, payload: TPayload) => void, beforeReducer = false): this {
    if (beforeReducer) this.options.preEffect = effect;
    else this.options.afterEffect = effect;
    return this;
  }

  /**
   * Add a retry policy for the action
   * @param retries - How many retries
   * @param delay - The delay between retries
   * @param backoff - A number added to every consecutive delay
   */
  withRetries(retries: number, delay: number, backoff?: number): this;
  /**
   * Add a retry policy for the action
   * @param retries - The delays for every retry
   */
  withRetries(retries: number[]): this;
  withRetries(retries: number[]|number, delay = 1000, backoff = 0): this {
    if (Array.isArray(retries)) {
      this.options.retries = retries;
    } else {
      this.options.retries = Array.from(new Array(retries), (_, i) => delay + (i * backoff))
    }
    return this;
  }
}

/**
 * A config for building the Action Command reducer
 * Object scoped
 */
export class ActionCommandObjectConfig<TRoot, TState extends Record<string, any>, TPayload, TData> extends ActionCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: ActionCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, ActionReducerData<TPayload, TData>>,
    private path: string[]
  ) {
    super(options);
  }

  /**
   * Target a property on the object
   * @param key - The property name
   * @param coalesce - A default value to use if property isn't found
   */
  targetProp<TKey extends KeysOfTypeOrNull<TState, Record<string, any>>>(
    key: TKey,
    coalesce?: ActionReducerCoalesce<TPayload, TData, ValueOfKey<TState, TKey>, TState>
  ): ActionCommandObjectConfig<TRoot, ValueOfKey<TState, TKey>, TPayload, TData> {
    const path = [...this.path, key.toString()];
    return new ActionCommandObjectConfig(
      this.context,
      this.options,
      objectReducerScope(this.scope, key, path, createActionReducerCoalesce(coalesce)),
      path
    );
  };

  /**
   * Target a list property on the object
   * @param key - The property name
   * @param create - Add list if it doesn't exist
   */
  targetList<TKey extends KeysOfTypeOrNull<TState, SimpleObject[]>>(
    key: TKey,
    create = false
  ): ActionCommandListConfig<TRoot, ValueOfKey<TState, TKey>, TPayload, TData> {
    const path = [...this.path, key.toString()];
    return new ActionCommandListConfig(
      this.context,
      this.options,
      objectReducerScope(this.scope, key, path, create ? [] as TState[TKey] : undefined),
      path,
    );
  };

  /**
   * Apply a modification to the payload / data before the reducer
   * @param func - The data modification
   */
  modify<TModified>(func: (data: TData, payload: TPayload, state: TState) => TModified): ActionCommandObjectDataConfig<TRoot, TState, TPayload, TData, TModified> {
    return new ActionCommandObjectDataConfig(this.context, this.options, this.scope, func);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: (data: TData, state: TState, payload: TPayload) => Partial<TState>): ActionCommand<TRoot, TPayload, TData>
  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ObjectReducer<TState, TData>): ActionCommand<TRoot, TPayload, TData>
  withReducer(reducer: (data: TData, state: TState, payload: TPayload) => Partial<TState>): ActionCommand<TRoot, TPayload, TData> {
    return new ActionCommand(
      this.context,
      this.options,
      (root, data, payload) => this.scope(
        root,
        {data, payload},
        state => applyScopedObjectReducer(state, reducer(data, state, payload))
      )
    );
  }

}

/**
 * A config for building the Action Command reducer
 * List scoped
 */
class ActionCommandListConfig<TRoot, TState extends SimpleObject[], TPayload, TData> extends ActionCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: ActionCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, ActionReducerData<TPayload, TData>>,
    private path: string[]
  ) {
    super(options);
  }

  /**
   * Target a list item in the list
   * @param selector - The selector for the list item
   * @param coalesce - A default value to append if item isn't found
   */
  targetItem(
    selector: Conditional<ArrayType<TState>, Record<string, any>, ListSelector<TState, TPayload, TData>>,
    coalesce?: ActionReducerCoalesce<TPayload, TData, ArrayType<TState>, TState>
  ): ActionCommandObjectConfig<TRoot, ArrayType<TState>, TPayload, TData> {
    const path = [...this.path, '[]'];
    return new ActionCommandObjectConfig(
      this.context,
      this.options,
      listReducerScope(
        this.scope,
        ({data, payload}) => selector(data, payload),
        path,
        createActionReducerCoalesce(coalesce)
      ),
      path
    );
  }

  /*  targetSubList(
      selector: Conditional<TElement, any[], (x: TElement, data: TData, payload: TPayload) => boolean>
    ): TElement extends any[] ? ActionCommandListContext<TRoot, TElement, ArrayType<TElement>, TPayload, TData> : never {
      const path = [...this.path, '[]'];
      return new ActionCommandListContext(
        this.options,
        listReducerScope<TRoot, TState, any, ObjectReducerData<TPayload, TData>>(this.scope, (x, {data, payload}) => selector(x, data, payload), path),
        path
      ) as unknown as TElement extends any[] ? ActionCommandListContext<TRoot, TElement, ArrayType<TElement>, TPayload, TData> : never;
    }*/

  /**
   * Apply a modification to the payload / data before the reducer
   * @param func - The data modification
   */
  modify<TModified>(func: (data: TData, payload: TPayload, state: TState) => TModified): ActionCommandListDataConfig<TRoot, TState, TPayload, TData, TModified> {
    return new ActionCommandListDataConfig(this.context, this.options, this.scope, func);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: (data: TData, state: TState, payload: TPayload) => TState): ActionCommand<TRoot, TPayload, TData>
  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ListReducer<TState, TData>): ActionCommand<TRoot, TPayload, TData>
  withReducer(reducer: (data: TData, state: TState, payload: TPayload) => TState): ActionCommand<TRoot, TPayload, TData> {
    return new ActionCommand(
      this.context,
      this.options,
      (root, data, payload) => this.scope(root, {data, payload}, state => reducer(data, state, payload))
    );
  }

}

/**
 * A config that represents a modified Action Command reducer
 * Object scope
 */
class ActionCommandObjectDataConfig<TRoot, TState extends Record<string, any>, TPayload, TData, TModified> extends ActionCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: ActionCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, ActionReducerData<TPayload, TData>>,
    private modify: (data: TData, payload: TPayload, state: TState) => TModified
  ) {
    super(options);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ObjectReducer<TState, TModified>) {
    return new ActionCommand(
      this.context,
      this.options,
      (root, data, payload) => this.scope(
        root,
        {data, payload},
        state => applyScopedObjectReducer(state, reducer(this.modify(data, payload, state), state))
      )
    );
  }
}

/**
 * A config that represents a modified Action Command reducer
 * List scope
 */
class ActionCommandListDataConfig<TRoot, TState extends any[], TPayload, TData, TModified> extends ActionCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: ActionCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, ActionReducerData<TPayload, TData>>,
    private modify: (data: TData, payload: TPayload, state: TState) => TModified
  ) {
    super(options);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ListReducer<TState, TModified>): ActionCommand<TRoot, TPayload, TData> {
    return new ActionCommand(
      this.context,
      this.options,
      (root, data, payload) => this.scope(
        root,
        {data, payload},
        state => reducer(this.modify(data, payload, state), state)
      )
    );
  }

}
