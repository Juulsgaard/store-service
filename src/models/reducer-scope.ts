import {ArrayType, isFunction} from "@juulsgaard/ts-tools";

export type ReducerScope<TRoot, TState, TData> = (root: TRoot, data: TData, func: (state: TState) => TState) => TRoot;
export type ActionReducerData<TPayload, TData> = { payload: TPayload, data: TData };
export type ReducerCoalesce<TData, TElement, TState> = TElement|((data: TData, state: TState) => TElement)|undefined;
export type ActionReducerCoalesce<TPayload, TData, TElement, TState> = TElement|((data: TData, payload: TPayload, state: TState) => TElement)|undefined;

export function createActionReducerCoalesce<TPayload, TData, TElement, TState>(coalesce: ActionReducerCoalesce<TPayload, TData, TElement, TState>): ReducerCoalesce<ActionReducerData<TPayload, TData>, TElement, TState> {
  if (coalesce === undefined) return undefined;
  if (!isFunction(coalesce)) return coalesce;
  return ({data, payload}, state) => coalesce(data, payload, state);
}

export function rootReducerScope<TRoot>(root: TRoot, data: unknown, func: (state: TRoot) => TRoot) {
  return func(root);
}

export function objectReducerScope<TRoot, TState extends Record<string, any>, TTarget, TData>(
  prevReducer: ReducerScope<TRoot, TState, TData>,
  key: keyof TState,
  path: string[],
  coalesce?: ReducerCoalesce<TData, TTarget, TState>,
  modify?: (data: TData, state: TState) => TState
): ReducerScope<TRoot, TTarget, TData> {
  return (root, data, func) => {
    return prevReducer(root, data, (state: TState) => {

      let val: TTarget = state[key];

      // If value isn't found, but default is set, use default
      if (coalesce !== undefined && val === undefined) {
        val = isFunction(coalesce) ? coalesce(data, state) : coalesce;
      }

      // If no value or default is found, return no changes
      if (val === undefined) {
        console.warn(`Object prop '${path.join('.')}' not found in reducer`)
        return state;
      }

      if (modify) {
        state = modify(data, state);
      }

      // Apply sub-reducer
      const delta = func(val);
      if (delta === val) return state;

      // Apply delta if changed were made
      return {...state, [key]: delta};
    })
  }
}

export function listReducerScope<TRoot, TState extends any[], TData>(
  prevReducer: ReducerScope<TRoot, TState, TData>,
  selector: (data: TData) => (element: ArrayType<TState>) => boolean,
  path: string[],
  coalesce?: ReducerCoalesce<TData, ArrayType<TState>, TState>
): ReducerScope<TRoot, ArrayType<TState>, TData> {
  return (root, data, func) => {

    const filter = selector(data);

    return prevReducer(root, data, (state: TState) => {

      // Get index of element
      let index = state.findIndex(x => filter(x));

      // If element isn't found, and default is given, then append default
      if (coalesce !== undefined && index < 0) index = state.length;

      // If element isn't found, and default isn't set, return no changes
      if (index < 0) {
        console.warn(`List element '${path.join('.')}' not found in reducer`)
        return state;
      }

      // Set value to default value if applicable, otherwise read value from state
      const val = index === state.length && coalesce !== undefined
        ? (isFunction(coalesce) ? coalesce(data, state) : coalesce)
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
