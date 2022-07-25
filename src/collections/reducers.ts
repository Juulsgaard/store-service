import {ListReducer} from "../models/store-types";
import {WithId} from "@consensus-labs/ts-tools";


export class BaseReducers {

  /**
   * Add an element to the end of a list
   */
  static addition<TState extends TElement[], TElement, TData extends TElement>(): ListReducer<TState, TElement, TData> {
    return (data, state) => [...state, data] as TState;
  }

  /**
   * Update an element in a list
   * Element is targeted based on ID
   */
  static updateById<TState extends TElement[], TElement extends WithId>(): ListReducer<TState, TElement, Partial<TElement>&WithId> {
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
   * Update an element in a list
   * Element is targeted based on given selector
   */
  static updateElement<TState extends TElement[], TElement, TUpdate extends Partial<TElement>>(selector: (element: TElement|TUpdate) => string): ListReducer<TState, TElement, TUpdate> {
    return (data, state) => {
      const index = state.findIndex(x => selector(x) === selector(data));

      if (index < 0) return state;

      const val = state[index];

      const newState = [...state];
      newState.splice(index, 1, {...val, ...data});
      return newState as TState;
    };
  }

  /**
   * Remove an element from a list
   * Element is targeted based on ID
   */
  static deleteById<TState extends TElement[], TElement extends WithId, TData extends string>(): ListReducer<TState, TElement, TData> {
    return (data, state) => {
      const index = state.findIndex(x => x.id === data);
      if (index < 0) return state;

      const newState = [...state];
      newState.splice(index, 1);
      return newState as TState;
    };
  }

  /**
   * Remove an element from a list
   * Element is targeted based on given selector
   */
  static deleteElement<TState extends TElement[], TElement, TData extends string>(selector: (element: TElement) => string): ListReducer<TState, TElement, TData> {
    return (data, state) => {
      const index = state.findIndex(x => selector(x) === data);
      if (index < 0) return state;

      const newState = [...state];
      newState.splice(index, 1);
      return newState as TState;
    };
  }

  /**
   * Update an element in a list
   * Element is targeted based on ID
   * If the element doesn't exist then it's added to the end of the list
   */
  static setById<TState extends TElement[], TElement extends WithId>(): ListReducer<TState, TElement, TElement> {
    return (data, state) => {
      const index = state.findIndex(x => x.id === data.id);

      if (index < 0) return [...state, data] as TState;

      const val = state[index];

      const newState = [...state];
      newState.splice(index, 1, {...val, ...data});
      return newState as TState;
    };
  }

  /**
   * Update an element in a list
   * Element is targeted based on given selector
   * If the element doesn't exist then it's added to the end of the list
   */
  static setElement<TState extends TElement[], TElement>(selector: (element: TElement) => string): ListReducer<TState, TElement, TElement> {
    return (data, state) => {
      const index = state.findIndex(x => selector(x) === selector(data));

      if (index < 0) return [...state, data] as TState;

      const val = state[index];

      const newState = [...state];
      newState.splice(index, 1, {...val, ...data});
      return newState as TState;
    };
  }

}
