
/**
 *
 * @param array
 * @param getKey
 * @param getVal
 * @internal
 */
export function arrayToMap<T, TKey, TVal> (array: T[], getKey: (x: T) => TKey, getVal: (x: T) => TVal) {
  const map = new Map<TKey, TVal>();
  for (let item of array) {
    map.set(getKey(item), getVal(item));
  }
  return map;
}
