import {ListReducer} from "../models/store-types";
import {ArrayType, WithId} from "@juulsgaard/ts-tools";


export class BaseReducers {

  /**
   * Add an element to the end of a list
   */
  static addition<TState extends any[], TData extends ArrayType<TState>>(): ListReducer<TState, TData> {
    return (data, state) => [...state, data] as TState;
  }

  /**
   * Update an element in a list
   * Element is targeted based on ID
   */
  static updateById<TState extends WithId[]>(): ListReducer<TState, Partial<ArrayType<TState>>&WithId> {
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
  static updateElement<TState extends any[], TUpdate extends Partial<ArrayType<TState>>>(
    selector: (element: ArrayType<TState>|TUpdate) => string
  ): ListReducer<TState, TUpdate> {
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
  static deleteById<TState extends WithId[], TData extends string>(): ListReducer<TState, TData> {
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
  static deleteElement<TState extends any[], TData extends string>(
    selector: (element: ArrayType<TState>) => string
  ): ListReducer<TState, TData> {
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
  static setById<TState extends WithId[]>(): ListReducer<TState, ArrayType<TState>> {
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
  static setElement<TState extends any[]>(selector: (element: ArrayType<TState>) => string): ListReducer<TState, ArrayType<TState>> {
    return (data, state) => {
      const index = state.findIndex(x => selector(x) === selector(data));

      if (index < 0) return [...state, data] as TState;

      const val = state[index];

      const newState = [...state];
      newState.splice(index, 1, {...val, ...data});
      return newState as TState;
    };
  }

  /**
   * Replace an element in a list
   * Element is targeted based on ID
   * @param add - If true the element is added when no match is found
   */
  static replaceById<TState extends WithId[]>(add = false): ListReducer<TState, ArrayType<TState>> {
    return (data, state) => {
      const index = state.findIndex(x => x.id === data.id);

      if (index < 0) {
        if (add) return [...state, data] as TState;
        else return state;
      }

      const newState = [...state];
      newState.splice(index, 1, data);
      return newState as TState;
    };
  }

  /**
   * Replace an element in a list
   * Element is targeted based on given selector
   * @param selector - Selector for targeting element
   * @param add - If true the element is added when no match is found
   */
  static replaceElement<TState extends any[]>(selector: (element: ArrayType<TState>) => string, add = false): ListReducer<TState, ArrayType<TState>> {
    return (data, state) => {
      const index = state.findIndex(x => selector(x) === selector(data));

      if (index < 0) {
        if (add) return [...state, data] as TState;
        else return state;
      }

      const newState = [...state];
      newState.splice(index, 1, data);
      return newState as TState;
    };
  }

}
