import {StoreServiceContext} from "../configs/command-config";
import {map} from "rxjs/operators";
import {distinctUntilChanged, Observable} from "rxjs";
import {ActionCommand} from "../commands/action-command";
import {DeferredCommand} from "../commands/deferred-command";
import {PlainCommand} from "../commands/plain-command";

/**
 * The base Command class
 */
export abstract class StoreCommand<TState> {

  abstract get initialLoad(): boolean;

  /**
   * Indicates if any command of this type are currently executing
   */
  loading$: Observable<boolean>;
  /**
   * Indicates if any command of this type have been started
   */
  loaded$: Observable<boolean>;
  /**
   * Indicates if any command of this type has recently failed
   */
  failed$: Observable<boolean>;

  protected context: StoreServiceContext<TState>

  protected constructor(context: StoreServiceContext<TState>) {
    this.context = context;

    this.loading$ = context.getLoadState$(this).pipe(
      map(x => !!x && x > 0),
      distinctUntilChanged()
    );
    this.loaded$ = context.getLoadState$(this).pipe(
      map(x => x !== undefined),
      distinctUntilChanged()
    );
    this.failed$ = context.getFailureState$(this).pipe(
      distinctUntilChanged()
    );
  }

  /**
   * Name of the Command
   */
  get name() {
    return this.context.getCommandName(this)
  };

  /**
   * Resets the failure state of the command
   * @internal
   */
  resetFailState() {
    this.context.resetFailState(this);
  }

}

export abstract class PayloadCommand<TState, TPayload> extends StoreCommand<TState> {

  protected constructor(context: StoreServiceContext<TState>, private requestId?: (payload: TPayload) => string) {
    super(context);
  }

  loadingById$(payload: TPayload) {
    if (!this.requestId) return this.loading$;
    return this.context.getLoadState$(this, this.requestId(payload)).pipe(
      map(x => !!x && x > 0),
      distinctUntilChanged()
    )
  }

  loadedById$(payload: TPayload) {
    if (!this.requestId) return this.loaded$;
    return this.context.getLoadState$(this, this.requestId(payload)).pipe(
      map(x => x !== undefined),
      distinctUntilChanged()
    )
  }

  failedById$(payload: TPayload) {
    if (!this.requestId) return this.failed$;
    return this.context.getFailureState$(this, this.requestId(payload)).pipe(
      distinctUntilChanged()
    )
  }

  /**
   * Resets the failure state of the command and specific request
   * @internal
   */
  resetFailureStateById(payload: TPayload) {
    if (!this.requestId) {
      this.resetFailState();
      return;
    }
    this.context.resetFailState(this, this.requestId(payload));
  }
}

export type ActionCommandUnion<TState, TPayload, TData> = ActionCommand<TState, TPayload, TData> | DeferredCommand<TState, TPayload, TData>;
export type StoreCommandUnion<TState, TPayload, TData = any> = PlainCommand<TState, TPayload> | ActionCommandUnion<TState, TPayload, TData>;
