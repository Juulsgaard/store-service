import {isObject} from "./type-predicates";

/** @internal */
export function deepCopy<T>(source: T): T {

  if (source === undefined) return undefined!;
  if (source === null) return null!;

  if (source instanceof Date) {
    return new Date(source.getTime()) as any;
  }

  if (Array.isArray(source)) {
    return source.map(x => deepCopy(x)) as any;
  }

  if (source instanceof Object) {
    const ret: any = {};
    for (let key in source) {
      ret[key] = deepCopy(source[key]);
    }
    return ret;
  }

  return source;
}

/** @internal */
export function deepFreeze<T>(array: T[]): ReadonlyArray<DeepReadonly<T>>;
/** @internal */
export function deepFreeze<T extends object>(obj: T): DeepReadonly<T>;
/** @internal */
export function deepFreeze<T>(data: T): DeepReadonly<T> {
  if (data == null) return data as DeepReadonly<T>;
  if (data instanceof Function) return Object.freeze(data) as DeepReadonly<T>;

  if (isObject(data)) {
    for (let key in data) {
      if (!data.hasOwnProperty(key)) continue;
      const val = data[key];
      if (val == null) continue;
      if (val instanceof Function || isObject(val)) deepFreeze(val);
    }
  }

  if (Object.isFrozen(data)) return data as DeepReadonly<T>;
  return Object.freeze(data) as DeepReadonly<T>;
}

type DeepReadonly<T> =
  T extends Function ? T :
    T extends (infer U)[] ? ReadonlyArray<DeepReadonly<U>> :
      T extends object ? { readonly [P in keyof T]: DeepReadonly<T[P]> } :
        T;
