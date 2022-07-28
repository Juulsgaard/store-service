import {listReducerScope, objectReducerScope, ReducerScope} from "../models/reducer-scope";
import {ListReducer, ListSelector, ObjectReducer} from "../models/store-types";
import {PlainCommand} from "../commands/plain-command";
import {StoreServiceContext} from "./command-config";
import {ArrayType, Conditional, KeysOfType} from "@consensus-labs/ts-tools";

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
   */
  targetProp<TKey extends KeysOfType<TState, Record<string, any>>>(key: TKey): PlainCommandObjectConfig<TRoot, TState[TKey], TData> {
    const path = [...this.path, key.toString()];
    return new PlainCommandObjectConfig(
      this.context,
      objectReducerScope(this.scope, key, path),
      path
    );
  };

  /**
   * Target a list property on the object
   * @param key - The property name
   */
  targetList<TKey extends KeysOfType<TState, any[]>>(key: TKey): PlainCommandListConfig<TRoot, TState[TKey], ArrayType<TState[TKey]>, TData> {
    const path = [...this.path, key.toString()];
    return new PlainCommandListConfig(
      this.context,
      objectReducerScope(this.scope, key, path),
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
class PlainCommandListConfig<TRoot, TState extends TElement[], TElement, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    private scope: ReducerScope<TRoot, TState, TData>,
    private path: string[]
  ) {

  }

  /**
   * Target a list item in the list
   * @param selector - The selector for the list item
   */
  targetItem(
    selector: Conditional<TElement, Record<string, any>, ListSelector<TElement, TData, TData>>
  ): PlainCommandObjectConfig<TRoot, TElement, TData> {
    const path = [...this.path, '[]'];
    return new PlainCommandObjectConfig(
      this.context,
      listReducerScope<TRoot, TState, TElement, TData>(this.scope, (data) => selector(data, data), path),
      path
    );
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ListReducer<TState, TElement, TData>): PlainCommand<TRoot, TData> {
    return new PlainCommand(
      this.context,
      (root, data) => this.scope(root, data, state => reducer(data, state))
    );
  }
}
