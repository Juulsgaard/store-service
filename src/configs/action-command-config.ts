import {ActionCommand, ActionCommandOptions} from "../commands/action-command";
import {applyScopedObjectReducer, listReducerScope, ObjectReducerData, objectReducerScope, ReducerScope} from "../models/reducer-scope";
import {ListReducer, ObjectReducer} from "../models/store-types";
import {StoreServiceContext} from "./command-config";
import {ArrayType, Conditional, KeysOfType} from "@consensus-labs/ts-tools";


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
  isInitial(requestId?: (payload: TPayload) => string): this {
    this.options.initialLoad = true;
    this.options.initialLoadId = requestId;
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

  withAfterEffect(effect: (data: TData, payload: TPayload) => void): this {
    this.options.afterEffect = effect;
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
    private scope: ReducerScope<TRoot, TState, ObjectReducerData<TPayload, TData>>,
    private path: string[]
  ) {
    super(options);
  }

  /**
   * Target a property on the object
   * @param key - The property name
   */
  targetProp<TKey extends KeysOfType<TState, Record<string, any>>>(key: TKey): ActionCommandObjectConfig<TRoot, TState[TKey], TPayload, TData> {
    const path = [...this.path, key.toString()];
    return new ActionCommandObjectConfig(
      this.context,
      this.options,
      objectReducerScope(this.scope, key, path),
      path
    );
  };

  /**
   * Target a list property on the object
   * @param key - The property name
   */
  targetList<TKey extends KeysOfType<TState, any[]>>(key: TKey): ActionCommandListConfig<TRoot, TState[TKey], ArrayType<TState[TKey]>, TPayload, TData> {
    const path = [...this.path, key.toString()];
    return new ActionCommandListConfig(
      this.context,
      this.options,
      objectReducerScope(this.scope, key, path),
      path
    );
  };

  /**
   * Apply a modification to the payload / data before the reducer
   * @param func - The data modification
   */
  modify<TModified>(func: (data: TData, payload: TPayload) => TModified): ActionCommandObjectDataConfig<TRoot, TState, TPayload, TData, TModified> {
    return new ActionCommandObjectDataConfig(this.context, this.options, this.scope, func);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ObjectReducer<TState, TData>): ActionCommand<TRoot, TPayload, TData>
  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: (data: TData, state: TState, payload: TPayload) => Partial<TState>): ActionCommand<TRoot, TPayload, TData>
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
class ActionCommandListConfig<TRoot, TState extends TElement[], TElement, TPayload, TData> extends ActionCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: ActionCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, ObjectReducerData<TPayload, TData>>,
    private path: string[]
  ) {
    super(options);
  }

  /**
   * Target a list item in the list
   * @param selector - The selector for the list item
   */
  targetItem(
    selector: Conditional<TElement, Record<string, any>, (x: TElement, data: TData, payload: TPayload) => boolean>
  ): ActionCommandObjectConfig<TRoot, TElement, TPayload, TData> {
    const path = [...this.path, '[]'];
    return new ActionCommandObjectConfig(
      this.context,
      this.options,
      listReducerScope(this.scope, (x, {
        data,
        payload
      }) => selector(x, data, payload), path),
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
  modify<TModified>(func: (data: TData, payload: TPayload) => TModified): ActionCommandListDataConfig<TRoot, TState, TElement, TPayload, TData, TModified> {
    return new ActionCommandListDataConfig(this.context, this.options, this.scope, func);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ListReducer<TState, TElement, TData>): ActionCommand<TRoot, TPayload, TData>
  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: (data: TData, state: TState, payload: TPayload) => TState): ActionCommand<TRoot, TPayload, TData>
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
    private scope: ReducerScope<TRoot, TState, ObjectReducerData<TPayload, TData>>,
    private modify: (data: TData, payload: TPayload) => TModified
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
        state => applyScopedObjectReducer(state, reducer(this.modify(data, payload), state))
      )
    );
  }
}

/**
 * A config that represents a modified Action Command reducer
 * List scope
 */
class ActionCommandListDataConfig<TRoot, TState extends TElement[], TElement, TPayload, TData, TModified> extends ActionCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: ActionCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, ObjectReducerData<TPayload, TData>>,
    private modify: (data: TData, payload: TPayload) => TModified
  ) {
    super(options);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ListReducer<TState, TElement, TModified>): ActionCommand<TRoot, TPayload, TData> {
    return new ActionCommand(
      this.context,
      this.options,
      (root, data, payload) => this.scope(
        root,
        {data, payload},
        state => reducer(this.modify(data, payload), state)
      )
    );
  }

}
