import {isFunction} from "@consensus-labs/ts-tools";

export type ReducerScope<TRoot, TState, TData> = (root: TRoot, data: TData, func: (state: TState) => TState) => TRoot;
export type ActionReducerData<TPayload, TData> = { payload: TPayload, data: TData };
export type ReducerCoalesce<TData, TElement> = TElement|((data: TData) => TElement)|undefined;
export type ActionReducerCoalesce<TPayload, TData, TElement> = TElement|((data: TData, payload: TPayload) => TElement)|undefined;

export function createActionReducerCoalesce<TPayload, TData, TElement>(coalesce: ActionReducerCoalesce<TPayload, TData, TElement>): ReducerCoalesce<ActionReducerData<TPayload, TData>, TElement> {
  if (coalesce === undefined) return undefined;
  if (!isFunction(coalesce)) return coalesce;
  return ({data, payload}) => coalesce(data, payload);
}

export function rootReducerScope<TRoot>(root: TRoot, data: unknown, func: (state: TRoot) => TRoot) {
  return func(root);
}

export function objectReducerScope<TRoot, TState extends Record<string, any>, TTarget, TData>(
  prevReducer: ReducerScope<TRoot, TState, TData>,
  key: keyof TState,
  path: string[],
  coalesce?: ReducerCoalesce<TData, TTarget>
): ReducerScope<TRoot, TTarget, TData> {
  return (root, data, func) => {
    return prevReducer(root, data, (state: TState) => {

      let val: TTarget = state[key];

      // If value isn't found, but default is set, use default
      if (coalesce !== undefined && val === undefined) {
        val = isFunction(coalesce) ? coalesce(data) : coalesce;
      }

      // If no value or default is found, return no changes
      if (val === undefined) {
        console.warn(`Object prop '${path.join('.')}' not found in reducer`)
        return state;
      }

      // Apply sub-reducer
      const delta = func(val);
      if (delta === val) return state;

      // Apply delta if changed were made
      return {...state, [key]: delta};
    })
  }
}

export function listReducerScope<TRoot, TState extends TElement[], TElement, TData>(
  prevReducer: ReducerScope<TRoot, TState, TData>,
  selector: (x: TElement, data: TData) => boolean,
  path: string[],
  coalesce?: ReducerCoalesce<TData, TElement>
): ReducerScope<TRoot, TElement, TData> {
  return (root, data, func) => {
    return prevReducer(root, data, (state: TState) => {

      // Get index of element
      let index = state.findIndex(x => selector(x, data));

      // If element isn't found, and default is given, then append default
      if (coalesce !== undefined && index < 0) index = state.length;

      // If element isn't found, and default isn't set, return no changes
      if (index < 0) {
        console.warn(`List element '${path.join('.')}' not found in reducer`)
        return state;
      }

      // Set value to default value if applicable, otherwise read value from state
      const val = index === state.length && coalesce !== undefined
        ? (isFunction(coalesce) ? coalesce(data) : coalesce)
        : state[index];

      // Apply sub-reducer
      const delta = func(val);
      if (delta === val) return state;

      // Apply delta if changed were made
      const newState = [...state];
      newState.splice(index, 1, delta);
      return newState as TState;
    })
  }
}

export function applyScopedObjectReducer<TState>(state: TState, data: Partial<TState>) {
  if (data === state) return state;
  return {...state, ...data};
}
