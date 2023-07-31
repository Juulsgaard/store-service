import {listReducerScope, objectReducerScope, ReducerCoalesce, ReducerScope} from "../models/reducer-scope";
import {ListReducer, ListSelector, ObjectReducer} from "../models/store-types";
import {PlainCommand} from "../commands/plain-command";
import {StoreServiceContext} from "./command-config";
import {ArrayType, Conditional, KeysOfTypeOrNull, SimpleObject, ValueOfKey} from "@juulsgaard/ts-tools";

/**
 * A config for building the Plain Command reducer
 * Object scoped
 */
export class PlainCommandObjectConfig<TRoot, TState extends Record<string, any>, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    private scope: ReducerScope<TRoot, TState, TData>,
    private path: string[]
  ) {

  }

  /**
   * Target a property on the object
   * @param key - The property name
   * @param coalesce - A default value to use if property isn't found
   */
  targetProp<TKey extends KeysOfTypeOrNull<TState, Record<string, any>>>(
    key: TKey,
    coalesce?: ReducerCoalesce<TData, ValueOfKey<TState, TKey>, TState>
  ): PlainCommandObjectConfig<TRoot, ValueOfKey<TState, TKey>, TData> {
    const path = [...this.path, key.toString()];
    return new PlainCommandObjectConfig(
      this.context,
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
  ): PlainCommandListConfig<TRoot, ValueOfKey<TState, TKey>, TData> {
    const path = [...this.path, key.toString()];
    return new PlainCommandListConfig(
      this.context,
      objectReducerScope(this.scope, key, path, create ? [] as TState[TKey] : undefined),
      path
    );
  };

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ObjectReducer<TState, TData>): PlainCommand<TRoot, TData> {
    return new PlainCommand(
      this.context,
      (root, data) => this.scope(root, data, state => ({...state, ...reducer(data, state)}))
    );
  }
}

/**
 * A config for building the Plain Command reducer
 * List scoped
 */
class PlainCommandListConfig<TRoot, TState extends SimpleObject[], TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    private scope: ReducerScope<TRoot, TState, TData>,
    private path: string[]
  ) {

  }

  /**
   * Target a list item in the list
   * @param selector - The selector for the list item
   * @param coalesce - A default value to append if item isn't found
   */
  targetItem(
    selector: Conditional<ArrayType<TState>, Record<string, any>, ListSelector<TState, TData, TData>>,
    coalesce?: ReducerCoalesce<TData, ArrayType<TState>, TState>
  ): PlainCommandObjectConfig<TRoot, ArrayType<TState>, TData> {
    const path = [...this.path, '[]'];
    return new PlainCommandObjectConfig(
      this.context,
      listReducerScope<TRoot, TState, TData>(this.scope, (data) => selector(data, data), path, coalesce),
      path
    );
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ListReducer<TState, TData>): PlainCommand<TRoot, TData> {
    return new PlainCommand(
      this.context,
      (root, data) => this.scope(root, data, state => reducer(data, state))
    );
  }
}
