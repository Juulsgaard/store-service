import {Observable} from "rxjs";
import {ArrayType} from "@juulsgaard/ts-tools";

/**
 * The signature for a Command Action
 */
export type CommandAction<TPayload, TData> =
  ((payload: TPayload) => Promise<TData>)
  | ((payload: TPayload) => Observable<TData>)
  | ((payload: TPayload) => TData);

export type Reducer<TState> = (state: TState) => TState;

/**
 * A reducer that can be applied to a list
 */
export type ListReducer<TState extends any[], TData> = (data: TData, state: TState) => TState;
/**
 * A reducer that can be applied to an object
 */
export type ObjectReducer<TState extends Record<string, any>, TData> = (data: TData, state: TState) => Partial<TState>;

/**
 * A selector that selects an item in a list
 */
export type ListSelector<TList, TPayload, TData> = (data: TData, payload: TPayload) => (element: ArrayType<TList>) => boolean;
