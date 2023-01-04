import {applyScopedObjectReducer, listReducerScope, objectReducerScope, ReducerCoalesce, ReducerScope} from "../models/reducer-scope";
import {ListReducer, ListSelector, ObjectReducer} from "../models/store-types";
import {StoreServiceContext} from "./command-config";
import {DeferredCommand, DeferredCommandOptions} from "../commands/deferred-command";
import {ArrayType, Conditional, KeysOfType, KeysOfTypeOrNull, SimpleObject, ValueOfKey} from "@consensus-labs/ts-tools";

/**
 * A base config that allows modification of an option object
 */
class DeferredCommandOptionConfig<TPayload, TData> {

  constructor(protected options: DeferredCommandOptions<TPayload, TData>) {
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
   * Add an action that will be run after a successful command action
   * @param effect
   */
  withAfterEffect(effect: (data: TData, payload: TPayload) => void): this {
    this.options.afterEffect = effect;
    return this;
  }
}

/**
 * A config for building the Deferred Command reducer
 * Object scoped
 */
export class DeferredCommandObjectConfig<TRoot, TState extends Record<string, any>, TPayload, TData> extends DeferredCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: DeferredCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, TPayload>,
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
    coalesce?: ReducerCoalesce<TPayload, ValueOfKey<TState, TKey>, TState>
  ): DeferredCommandObjectConfig<TRoot, ValueOfKey<TState, TKey>, TPayload, TData> {
    const path = [...this.path, key.toString()];
    return new DeferredCommandObjectConfig(
      this.context,
      this.options,
      objectReducerScope(this.scope, key, path, coalesce),
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
  ): DeferredCommandListConfig<TRoot, ValueOfKey<TState, TKey>, TPayload, TData> {
    const path = [...this.path, key.toString()];
    return new DeferredCommandListConfig(
      this.context,
      this.options,
      objectReducerScope(this.scope, key, path, create ? [] as TState[TKey] : undefined),
      path
    );
  };

  /**
   * Apply a modification to the payload before the reducer
   * @param func - The data modification
   */
  modify<TModified>(func: (payload: TPayload, state: TState) => TModified): DeferredCommandObjectDataConfig<TRoot, TState, TPayload, TData, TModified> {
    return new DeferredCommandObjectDataConfig(this.context, this.options, this.scope, func);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ObjectReducer<TState, TPayload>): DeferredCommand<TRoot, TPayload, TData> {
    return new DeferredCommand(
      this.context,
      this.options,
      (root, data) => this.scope(
        root,
        data,
        state => applyScopedObjectReducer(state, reducer(data, state))
      )
    );
  }
}

/**
 * A config for building the Deferred Command reducer
 * List scoped
 */
class DeferredCommandListConfig<TRoot, TState extends SimpleObject[], TPayload, TData> extends DeferredCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: DeferredCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, TPayload>,
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
    selector: Conditional<ArrayType<TState>, Record<string, any>, ListSelector<TState, TPayload, TPayload>>,
    coalesce?: ReducerCoalesce<TPayload, ArrayType<TState>, TState>
  ): DeferredCommandObjectConfig<TRoot, ArrayType<TState>, TPayload, TData> {
    const path = [...this.path, '[]'];
    return new DeferredCommandObjectConfig(
      this.context,
      this.options,
      listReducerScope(this.scope, (payload) => selector(payload, payload), path, coalesce),
      path
    );
  }

  /**
   * Apply a modification to the payload before the reducer
   * @param func - The data modification
   */
  modify<TModified>(func: (payload: TPayload, state: TState) => TModified): DeferredCommandListDataConfig<TRoot, TState, TPayload, TData, TModified> {
    return new DeferredCommandListDataConfig(this.context, this.options, this.scope, func);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ListReducer<TState, TPayload>): DeferredCommand<TRoot, TPayload, TData> {
    return new DeferredCommand(
      this.context,
      this.options,
      (root, data) => this.scope(root, data, state => reducer(data, state))
    );
  }
}

/**
 * A config that represents a modified Deferred Command reducer
 * Object scope
 */
class DeferredCommandObjectDataConfig<TRoot, TState extends Record<string, any>, TPayload, TData, TModified> extends DeferredCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: DeferredCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, TPayload>,
    private modify: (payload: TPayload, state: TState) => TModified
  ) {
    super(options);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ObjectReducer<TState, TModified>): DeferredCommand<TRoot, TPayload, TData> {
    return new DeferredCommand(
      this.context,
      this.options,
      (root, data) => this.scope(
        root,
        data,
        state => applyScopedObjectReducer(state, reducer(this.modify(data, state), state))
      )
    );
  }
}

/**
 * A config that represents a modified Deferred Command reducer
 * List scope
 */
class DeferredCommandListDataConfig<TRoot, TState extends any[], TPayload, TData, TModified> extends DeferredCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: DeferredCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, TPayload>,
    private modify: (payload: TPayload, state: TState) => TModified
  ) {
    super(options);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ListReducer<TState, TModified>): DeferredCommand<TRoot, TPayload, TData> {
    return new DeferredCommand(
      this.context,
      this.options,
      (root, data) => this.scope(
        root,
        data,
        state => reducer(this.modify(data, state), state)
      )
    );
  }

}
