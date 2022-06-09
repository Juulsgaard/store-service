export type ReducerScope<TRoot, TState, TData> = (root: TRoot, data: TData, func: (state: TState) => TState) => TRoot;
export type ObjectReducerData<TPayload, TData> = { payload: TPayload, data: TData };

export function rootReducerScope<TRoot>(root: TRoot, data: unknown, func: (state: TRoot) => TRoot) {
  return func(root);
}

export function objectReducerScope<TRoot, TState extends Record<string, any>, TTarget, TData>(
  prevReducer: ReducerScope<TRoot, TState, TData>,
  key: keyof TState,
  path: string[]
): ReducerScope<TRoot, TTarget, TData> {
  return (root, data, func) => {
    return prevReducer(root, data, (state: TState) => {

      const val: TTarget = state[key];

      if (!val) {
        console.warn(`Object prop '${path.join('.')}' not found in reducer`)
        return state;
      }

      const delta = func(val);
      if (delta === val) return state;

      return {...state, [key]: delta};

    })
  }
}

export function listReducerScope<TRoot, TState extends TElement[], TElement, TData>(
  prevReducer: ReducerScope<TRoot, TState, TData>,
  selector: (x: TElement, data: TData) => boolean,
  path: string[]
): ReducerScope<TRoot, TElement, TData> {
  return (root, data, func) => {
    return prevReducer(root, data, (state: TState) => {

      const index = state.findIndex(x => selector(x, data));

      if (index < 0) {
        console.warn(`List element '${path.join('.')}' not found in reducer`)
        return state;
      }

      const val = state[index];
      const delta = func(val);
      if (delta === val) return state;

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
