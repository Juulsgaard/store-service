import {Observable} from "rxjs";
import {map} from "rxjs/operators";
import {StoreServiceContext} from "../configs/command-config";

/**
 * The signature for a Command Action
 */
export type CommandAction<TPayload, TData> =
  ((payload: TPayload) => Promise<TData>)
  | ((payload: TPayload) => Observable<TData>)
  | ((payload: TPayload) => TData);

/**
 * A reducer that can be applied to a list
 */
export type ListReducer<TState extends TElement[], TElement, TData> = (data: TData, state: TState) => TState;
/**
 * A reducer that can be applied to an object
 */
export type ObjectReducer<TState extends Record<string, any>, TData> = (data: TData, state: TState) => Partial<TState>;

/**
 * The base Command class
 */
export abstract class StoreCommand<TState> {

  /**
   * Indicates if any command of this type are currently executing
   */
  loading$: Observable<boolean>;
  /**
   * Indicated if any command of this type have been started
   */
  loaded$: Observable<boolean>;

  /** @internal */
  protected context: StoreServiceContext<TState>

  /** @internal */
  protected constructor(context: StoreServiceContext<TState>) {
    this.context = context;
    this.loading$ = context.getLoadState$(this).pipe(map(x => !!x && x > 0));
    this.loaded$ = context.getLoadState$(this).pipe(map(x => x !== undefined));
  }

  /**
   * Name of the Command
   */
  get name() {
    return this.context.getCommandName(this)
  };

}
