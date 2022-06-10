import {ListReducer} from "../models/store-types";
import {WithId} from "@consensus-labs/ts-tools";


export namespace Reducers {

  /**
   * Add an element to the end of a list
   */
  export function addition<TState extends TElement[], TElement, TData extends TElement>(): ListReducer<TState, TElement, TData> {
    return (data, state) => [...state, data] as TState;
  }

  /**
   * Update an element in a list
   * Element targeted based on ID
   */
  export function updateById<TState extends TElement[], TElement extends WithId>(): ListReducer<TState, TElement, Partial<TElement>&WithId> {
    return (data, state) => {
      const index = state.findIndex(x => x.id === data.id);

      if (index < 0) return state;

      const val = state[index];

      const newState = [...state];
      newState.splice(index, 1, {...val, ...data});
      return newState as TState;
    };
  }

  /**
   * Remove an element from a list
   * Element targeted based on ID
   */
  export function deleteById<TState extends TElement[], TElement extends WithId, TData extends string>(): ListReducer<TState, TElement, TData> {
    return (data, state) => {
      const index = state.findIndex(x => x.id === data);
      if (index < 0) return state;

      const newState = [...state];
      newState.splice(index, 1);
      return newState as TState;
    };
  }

}
