import {StoreServiceContext} from "./command-config";
import {
  ActionReducerCoalesce, ActionReducerData, applyScopedObjectReducer, createActionReducerCoalesce, listReducerScope,
  objectReducerScope, ReducerScope, rootReducerScope
} from "../models/reducer-scope";
import {ArrayType, Conditional, KeysOfTypeOrNull, SimpleObject, ValueOfKey} from "@juulsgaard/ts-tools";
import {ListReducer, ListSelector, ObjectReducer} from "../models/store-types";
import {CacheCommand, CacheCommandOptions} from "../commands/cache-command";
import {CacheChunk} from "../caching/cache-chunk";
import {PlainCommand} from "../commands/plain-command";
import {tap} from "rxjs";
import {ActionCommandUnion, StoreCommandUnion} from "../models/base-commands";
import {IdMap, parseIdMap} from "../lib/id-map";


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
        cacheWhenOnline: true,
        fallbackWhenOffline: true,
        cancelConcurrent: false
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
  fromSingle<TPayload>(map: IdMap<TPayload>): CacheCommandObjectConfig<TState, TState, TPayload, TCache>;
  fromSingle(map?: IdMap<any>): CacheCommandObjectConfig<TState, TState, any, TCache> {

    const idMap = map ? parseIdMap(map) : (x: unknown) => x as string;

    const cacheOptions: CacheCommandOptions<TState, TCache> = {
      initialLoad: false,
      action: ({options, payload}) => {
        let id = idMap(payload);

        // Mark item as loaded on a successful read
        return this.cache.loadItem(id, options).pipe(
          tap(x => {
            if (x === undefined) return;
            if (cacheOptions.failCondition?.(x)) return;
            this.cache.markAsLoaded(id as string);
          })
        );
      },
      cacheWhenOnline: true,
      fallbackWhenOffline: true,
      cancelConcurrent: false
    }

    return new CacheCommandObjectConfig<TState, TState, any, TCache>(
      this.context,
      cacheOptions,
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

  /** Tell the command to not use the cache if the client is online */
  skipCacheOnline(): this {
    this.options.cacheWhenOnline = false;
    return this;
  }

  /** Tell the command to not use the fallback command if the client is online */
  skipFallbackOffline(): this {
    this.options.fallbackWhenOffline = false;
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
  ): CacheCommandObjectConfig<TRoot, ValueOfKey<TState, TKey>, TPayload, TData> {
    const path = [...this.path, key.toString()];
    return new CacheCommandObjectConfig(
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
  ): CacheCommandListConfig<TRoot, ValueOfKey<TState, TKey>, TPayload, TData> {
    const path = [...this.path, key.toString()];
    return new CacheCommandListConfig(
      this.context,
      this.options,
      objectReducerScope(this.scope, key, path, create ? [] as TState[TKey] : undefined),
      path
    );
  };

  /**
   * Target a unit array property on the object
   * @param key - The property name
   * @param create - Add list if it doesn't exist
   */
  targetArray<TKey extends KeysOfTypeOrNull<TState, unknown[]>>(
    key: TKey,
    create = false
  ): CacheCommandArrayConfig<TRoot, ValueOfKey<TState, TKey>, TPayload, TData> {
    const path = [...this.path, key.toString()];
    return new CacheCommandArrayConfig(
      this.context,
      this.options,
      objectReducerScope(this.scope, key, path, create ? [] as TState[TKey] : undefined),
      path
    );
  };

  /**
   * Apply a modification to the payload / data before the reducer
   * @param func - The data modification
   */
  modify<TModified>(func: (data: TData, payload: TPayload, state: TState) => TModified): CacheCommandObjectDataConfig<TRoot, TState, TPayload, TData, TModified> {
    return new CacheCommandObjectDataConfig(this.context, this.options, this.scope, func);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: (data: TData, state: TState, payload: TPayload) => Partial<TState>): CacheCommandEffectConfig<TRoot, TPayload, TData>
  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ObjectReducer<TState, TData>): CacheCommandEffectConfig<TRoot, TPayload, TData>
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
class CacheCommandArrayConfig<TRoot, TState extends unknown[], TPayload, TData> extends CacheCommandOptionConfig<TPayload, TData> {

  constructor(
    protected context: StoreServiceContext<TRoot>,
    options: CacheCommandOptions<TPayload, TData>,
    protected scope: ReducerScope<TRoot, TState, ActionReducerData<TPayload, TData>>,
    protected path: string[]
  ) {
    super(options);
  }

  /**
   * Apply a modification to the payload / data before the reducer
   * @param func - The data modification
   */
  modify<TModified>(func: (data: TData, payload: TPayload, state: TState) => TModified): CacheCommandListDataConfig<TRoot, TState, TPayload, TData, TModified> {
    return new CacheCommandListDataConfig(this.context, this.options, this.scope, func);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: (data: TData, state: TState, payload: TPayload) => TState): CacheCommandEffectConfig<TRoot, TPayload, TData>
  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ListReducer<TState, TData>): CacheCommandEffectConfig<TRoot, TPayload, TData>
  withReducer(reducer: (data: TData, state: TState, payload: TPayload) => TState): CacheCommandEffectConfig<TRoot, TPayload, TData> {
    return new CacheCommandEffectConfig(
      this.context,
      this.options,
      (root, data, payload) => this.scope(root, {data, payload}, state => reducer(data, state, payload))
    );
  }

}

class CacheCommandListConfig<TRoot, TState extends SimpleObject[], TPayload, TData> extends CacheCommandArrayConfig<TRoot, TState, TPayload, TData> {

  /**
   * Target a list item in the list
   * @param selector - The selector for the list item
   * @param coalesce - A default value to append if item isn't found
   */
  targetItem(
    selector: Conditional<ArrayType<TState>, Record<string, any>, ListSelector<TState, TPayload, TData>>,
    coalesce?: ActionReducerCoalesce<TPayload, TData, ArrayType<TState>, TState>
  ): CacheCommandObjectConfig<TRoot, ArrayType<TState>, TPayload, TData> {
    const path = [...this.path, '[]'];
    return new CacheCommandObjectConfig(
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

}

/**
 * A config that represents a modified Cache Command reducer
 * Object scope
 */
class CacheCommandObjectDataConfig<TRoot, TState extends Record<string, any>, TPayload, TData, TModified> extends CacheCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: CacheCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, ActionReducerData<TPayload, TData>>,
    private modify: (data: TData, payload: TPayload, state: TState) => TModified
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
        state => applyScopedObjectReducer(state, reducer(this.modify(data, payload, state), state))
      )
    );
  }
}

/**
 * A config that represents a modified Cache Command reducer
 * List scope
 */
class CacheCommandListDataConfig<TRoot, TState extends any[], TPayload, TData, TModified> extends CacheCommandOptionConfig<TPayload, TData> {

  constructor(
    private context: StoreServiceContext<TRoot>,
    options: CacheCommandOptions<TPayload, TData>,
    private scope: ReducerScope<TRoot, TState, ActionReducerData<TPayload, TData>>,
    private modify: (data: TData, payload: TPayload, state: TState) => TModified
  ) {
    super(options);
  }

  /**
   * Define the reducer for the active scope
   * @param reducer
   */
  withReducer(reducer: ListReducer<TState, TModified>): CacheCommandEffectConfig<TRoot, TPayload, TData> {
    return new CacheCommandEffectConfig(
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
