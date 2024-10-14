import {computed, isSignal, Signal} from "@angular/core";
import {arrToMap, Mutable, WithId} from "@juulsgaard/ts-tools";

interface StoreCollectionProps<TKey, TVal> {
  /**
   * Get a value with the given key.
   * Emits undefined when no matching value is present.
   * @param key
   */
  get(key: TKey): Signal<TVal|undefined>;

  /**
   * Emits true when the given key is present in the collection.
   * @param key
   */
  has(key: TKey): Signal<boolean>;

  /** Emits the length of the list */
  readonly length: Signal<number>;
  /** Emits a lookup Map with all values from the collection */
  readonly lookup: Signal<ReadonlyMap<TKey, TVal>>;
  /** Returns the original array */
  readonly array: Signal<TVal[]>;
}

/** A signal based lookup / list */
export type StoreCollection<TKey, TVal> = StoreCollectionProps<TKey, TVal> & Signal<TVal[]>;
type InternalStoreCollection<TKey, TVal> = Mutable<StoreCollectionProps<TKey, TVal>> & Signal<TVal[]>

/**
 * Create a StoreCollection of entities with Ids
 * @param signal - The source signal / computation
 */
export function storeCollection<TVal extends WithId>(signal: (() => TVal[])|Signal<TVal[]>): StoreCollection<string, TVal>;
/**
 * Create a StoreCollection of entities with a custom key
 * @param signal - The source signal / computation
 * @param getKey - Map the entity key for lookups
 */
export function storeCollection<TKey, TVal>(signal: (() => TVal[])|Signal<TVal[]>, getKey: (val: TVal) => TKey): StoreCollection<TKey, TVal>;
export function storeCollection<TKey, TVal>(signal: (() => TVal[])|Signal<TVal[]>, getKey?: (val: TVal) => TKey): StoreCollection<TKey, TVal> {
  const list = isSignal(signal) ? signal : computed(signal);

  getKey ??= x => (x as WithId).id as TKey;
  const lookup = computed(() => arrToMap(list(), x => getKey(x)));

  const output = list as InternalStoreCollection<TKey, TVal>;

  output.array = list;
  output.lookup = lookup;
  output.length = computed(() => list().length);
  output.get = (key: TKey) => computed(() => lookup().get(key));
  output.has = (key: TKey) => computed(() => lookup().has(key));

  return output;
}
