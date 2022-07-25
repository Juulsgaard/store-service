import {StoreServiceContext} from "./command-config";
import {
  applyScopedObjectReducer, listReducerScope, ObjectReducerData, objectReducerScope, ReducerScope, rootReducerScope
} from "../models/reducer-scope";
import {ArrayType, Conditional, KeysOfType} from "@consensus-labs/ts-tools";
import {ActionCommandUnion, ListReducer, ObjectReducer, StoreCommandUnion} from "../models/store-types";
import {CacheCommand, CacheCommandOptions} from "../commands/cache-command";
import {CacheChunk} from "../caching/cache-chunk";
import {PlainCommand} from "../commands/plain-command";


export class CacheCommandConfig<TState extends Record<string, any>, TCache> {

  constructor(private context: StoreServiceContext<TState>, private cache: CacheChunk<TCache>) {
  }

  /**
   * Create an action based on loading an entire cache chunk
   * Optionally provide a custom payload as a type param
   */
  fromAll<TPayload = void>(): CacheCommandObjectConfig<TState, TState, TPayload, TCache[]> {
    return new CacheCommandObjectConfig<TState, TState, TPayload, TCache[]>(
      this.context,
      {
        initialLoad: false,
        action: ({options}) => this.cache.loadAll(options),
        failCondition: x => x.length === 0,
        cacheIfOnline: true,
        fallbackIfOffline: true
      },
      rootReducerScope,
      []
    )
  }

  /**
   * Create an action based on loading a single cache item
   */
  fromSingle(): CacheCommandObjectConfig<TState, TState, string, TCache>;
  /**
   * Create an action based on loading a single cache item
   * Provide a custom payload, and a mapper from payload to item ID
   * @param map - A mapper from custom payload to item ID
   */
  fromSingle<TPayload>(map: (payload: TPayload) => string): CacheCommandObjectConfig<TState, TState, TPayload, TCache>;
  fromSingle(map?: (payload: any) => string): CacheCommandObjectConfig<TState, TState, any, TCache> {

    if (!map) map = x => x;

    return new CacheCommandObjectConfig<TState, TState, any, TCache>(
      this.context,
      {
        initialLoad: false,
        action: ({options, payload}) => this.cache.loadItem(map!(payload), options),
        cacheIfOnline: true,
        fallbackIfOffline: true
      },
      rootReducerScope,
      []
    )
  }

}

/**
 * A base config that allows modification of an option object
 */
class CacheCommandOptionConfig<TPayload, TData> {

  constructor(protected options: CacheCommandOptions<TPayload, TData>) {
  }

  /**
   * Define an error message for is the cache load fails
   * @param message - The message
   */
  withErrorMessage(message: string): this {
    this.options.errorMessage = message;
    return this;
  }

  /**
   * Define a success message to show the user on cache load success
   * @param message - The message / message factory
   */
  withSuccessMessage(message: string | ((data: TData, payload: TPayload) => string)): this {
    this.options.successMessage = message;
    return this;
  }

  /**
   * Mark the cache action as being an initial load
   */
  isInitial(requestId?: (payload: TPayload) => string): this {
    this.options.initialLoad = true;
    this.options.initialLoadId = requestId;
    return this;
  }

  /** Tell the command to not use the cache if the client is online */
  skipCacheOnline(): this {
    this.options.cacheIfOnline = false;
    return this;
  }

  /** Tell the command to not use the fallback command if the client is online */
  skipFallbackOffline(): this {
    this.options.fallbackIfOffline = false;
    return this;
  }

  maxAge(age: number, absolute = false): this {
    this.options.onlineMaxAge = age;
    this.options.offlineMaxAge = age;
    this.options.onlineAbsoluteAge = absolute;
    this.options.offlineAbsoluteAge = absolute;
    return this;
  }

  maxAgeOffline(age: number, absolute = false): this {
    this.options.offlineMaxAge = age;
    this.options.offlineAbsoluteAge = absolute;
    return this;
  }

  maxAgeOnline(age: number, absolute = false): this {
    this.options.onlineMaxAge = age;
    this.options.onlineAbsoluteAge = absolute;
    return this;
  }
}

/**
 * A config for building the Cache Command reducer
 * Object scoped
 */
class CacheCommandObjectConfig<TRoot, TState extends Record<string, any>, TPayload, TData> extends CacheCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: CacheCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, ObjectReducerData<TPayload, TData>>,
    private path: string[]
  ) {
    super(options);
  }

  /**
   * Target a property on the object
   * @param key - The property name
   */
  targetProp<TKey extends KeysOfType<TState, Record<string, any>>>(key: TKey): CacheCommandObjectConfig<TRoot, TState[TKey], TPayload, TData> {
    const path = [...this.path, key.toString()];
    return new CacheCommandObjectConfig(
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
  targetList<TKey extends KeysOfType<TState, any[]>>(key: TKey): CacheCommandListConfig<TRoot, TState[TKey], ArrayType<TState[TKey]>, TPayload, TData> {
    const path = [...this.path, key.toString()];
    return new CacheCommandListConfig(
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
  modify<TModified>(func: (data: TData, payload: TPayload) => TModified): CacheCommandObjectDataConfig<TRoot, TState, TPayload, TData, TModified> {
    return new CacheCommandObjectDataConfig(this.context, this.options, this.scope, func);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ObjectReducer<TState, TData>): CacheCommandEffectConfig<TRoot, TPayload, TData>
  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: (data: TData, state: TState, payload: TPayload) => Partial<TState>): CacheCommandEffectConfig<TRoot, TPayload, TData>
  withReducer(reducer: (data: TData, state: TState, payload: TPayload) => Partial<TState>): CacheCommandEffectConfig<TRoot, TPayload, TData> {
    return new CacheCommandEffectConfig(
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
 * A config for building the Cache Command reducer
 * List scoped
 */
class CacheCommandListConfig<TRoot, TState extends TElement[], TElement, TPayload, TData> extends CacheCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: CacheCommandOptions<TPayload, TData>,
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
  ): CacheCommandObjectConfig<TRoot, TElement, TPayload, TData> {
    const path = [...this.path, '[]'];
    return new CacheCommandObjectConfig(
      this.context,
      this.options,
      listReducerScope(this.scope, (x, {
        data,
        payload
      }) => selector(x, data, payload), path),
      path
    );
  }

  /**
   * Apply a modification to the payload / data before the reducer
   * @param func - The data modification
   */
  modify<TModified>(func: (data: TData, payload: TPayload) => TModified): CacheCommandListDataConfig<TRoot, TState, TElement, TPayload, TData, TModified> {
    return new CacheCommandListDataConfig(this.context, this.options, this.scope, func);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ListReducer<TState, TElement, TData>): CacheCommandEffectConfig<TRoot, TPayload, TData>
  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: (data: TData, state: TState, payload: TPayload) => TState): CacheCommandEffectConfig<TRoot, TPayload, TData>
  withReducer(reducer: (data: TData, state: TState, payload: TPayload) => TState): CacheCommandEffectConfig<TRoot, TPayload, TData> {
    return new CacheCommandEffectConfig(
      this.context,
      this.options,
      (root, data, payload) => this.scope(root, {data, payload}, state => reducer(data, state, payload))
    );
  }

}

/**
 * A config that represents a modified Cache Command reducer
 * Object scope
 */
class CacheCommandObjectDataConfig<TRoot, TState extends Record<string, any>, TPayload, TData, TModified> extends CacheCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: CacheCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, ObjectReducerData<TPayload, TData>>,
    private modify: (data: TData, payload: TPayload) => TModified
  ) {
    super(options);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ObjectReducer<TState, TModified>): CacheCommandEffectConfig<TRoot, TPayload, TData> {
    return new CacheCommandEffectConfig(
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
 * A config that represents a modified Cache Command reducer
 * List scope
 */
class CacheCommandListDataConfig<TRoot, TState extends TElement[], TElement, TPayload, TData, TModified> extends CacheCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: CacheCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, ObjectReducerData<TPayload, TData>>,
    private modify: (data: TData, payload: TPayload) => TModified
  ) {
    super(options);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ListReducer<TState, TElement, TModified>): CacheCommandEffectConfig<TRoot, TPayload, TData> {
    return new CacheCommandEffectConfig(
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

class CacheCommandEffectConfig<TState, TPayload, TData> {
  constructor(
    private context: StoreServiceContext<TState>,
    private readonly options: CacheCommandOptions<TPayload, TData>,
    private readonly reducer: (state: TState, data: TData, payload: TPayload) => TState
  ) {}

  withFallback<TXPayload, TXData>(command: ActionCommandUnion<TState, TXPayload, TXData>): CacheCommand<TState, TPayload, TData, TXPayload, TXData>
  withFallback<TXPayload>(command: PlainCommand<TState, TXPayload>): CacheCommand<TState, TPayload, TData, TXPayload, void>
  withFallback<TXPayload>(command: StoreCommandUnion<TState, TXPayload>): CacheCommand<TState, TPayload, TData, TXPayload, any> {
    return new CacheCommand<TState, TPayload, TData, TXPayload, any>(
      this.context,
      this.options,
      this.reducer,
      command,
      false
    );
  }

  withConcurrent<TXPayload, TXData>(command: ActionCommandUnion<TState, TXPayload, TXData>): CacheCommand<TState, TPayload, TData, TXPayload, TXData>
  withConcurrent<TXPayload>(command: PlainCommand<TState, TXPayload>): CacheCommand<TState, TPayload, TData, TXPayload, void>
  withConcurrent<TXPayload>(command: StoreCommandUnion<TState, TXPayload>): CacheCommand<TState, TPayload, TData, TXPayload, any> {
    return new CacheCommand<TState, TPayload, TData, TXPayload, any>(
      this.context,
      this.options,
      this.reducer,
      command,
      true
    );
  }

  noFallback(): CacheCommand<TState, TPayload, TData, TPayload, void> {
    return new CacheCommand<TState, TPayload, TData, TPayload, void>(
      this.context,
      this.options,
      this.reducer
    );
  }

}
