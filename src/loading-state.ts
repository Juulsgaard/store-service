import {
  BehaviorSubject, from, lastValueFrom, Observable, Observer, of, ReplaySubject, Subject, Subscribable, Subscription, switchMap, tap, throwError,
  Unsubscribable
} from "rxjs";
import {first, map} from "rxjs/operators";

/**
 * The base loading state
 */
interface ILoadingState extends Subscribable<boolean> {

  readonly loading$: Observable<boolean>;
  readonly loading: boolean;
  readonly isAsync: boolean;

  cancel(): void;
}

/**
 * An empty loading state
 */
class EmptyLoadingState implements ILoadingState {

  readonly loading$ = of(false);
  readonly loading = false;
  readonly isAsync = false;
  cancel() {}

  subscribe(observer: Partial<Observer<boolean>>): Unsubscribable {
    return this.loading$.subscribe(observer);
  }
}

/**
 * Represents the loading state of a Command
 */
export class LoadingState<TData> implements ILoadingState {

  /**
   * Generate a state based on an action
   * @param action - An action returning the data
   * @param modify - An optional modification to apply to the data
   * @constructor
   */
  static FromAction<TData>(action: () => TData | Promise<TData> | Observable<TData>, modify?: (data: TData) => TData | void): LoadingState<TData> {
    try {
      let data = action();

      // Apply modification to result
      if (modify) {
        if (data instanceof Promise) data = data.then(x => modify(x) ?? x);
        else if (data instanceof Observable) data = data.pipe(map(x => modify(x) ?? x));
        else data = modify(data) ?? data;
      }

      return new LoadingState(data);
    } catch (error) {
      return LoadingState.FromError(() => error);
    }
  }

  static Delayed<TData>(action: () => TData | Promise<TData> | Observable<TData>, modify?: (data: TData) => TData | void): DelayedLoadingState<TData> {
    return new DelayedLoadingState<TData>(action, modify);
  }
  /**
   * Generate a state representing an error
   * @param error - The error to emit
   * @constructor
   */
  static FromError<TData>(error: () => any): LoadingState<TData> {
    return new LoadingState<TData>(throwError(error));
  }

  /**
   * Creates an empty / typeless Loading State placeholder
   * @constructor
   */
  static Empty(): ILoadingState {
    return new EmptyLoadingState();
  }

  /**
   * A subscription from binding Observable data
   * @private
   */
  private subscription?: Subscription;


  private _loading$ = new BehaviorSubject(true);
  /**
   * Indicated the loading state of the command
   */
  readonly loading$: Observable<boolean>;

  /**
   * Get the current loading state
   */
  get loading() {
    return this._loading$.value
  }

  /**
   * The internal result state
   * @private
   */
  private _result$ = new ReplaySubject<TData>(1);
  readonly result$: Observable<TData>;


  private _asyncResult?: Promise<TData>;

  /**
   * A promise returning the data once resolved
   */
  get resultAsync(): Promise<TData> {
    if (this._asyncResult) return this._asyncResult;
    this._asyncResult = lastValueFrom(this.result$);
    return this._asyncResult;
  }

  /**
   * The value is evaluated in an async fashion
   */
  readonly isAsync: boolean;

  constructor(data: TData | Promise<TData> | Observable<TData>) {

    this.result$ = this._result$.asObservable();
    this.loading$ = this._loading$.asObservable();

    if (data instanceof Promise) {
      this.isAsync = true;
      data.then(
        val => this.setValue(val),
        error => this.setError(error)
      );
      return;
    }

    if (data instanceof Observable) {
      this.isAsync = true;
      this.subscription = data.pipe(first()).subscribe({
        next: val => this.setValue(val),
        error: error => this.setError(error),
        complete: () => this.setError('Observable completed without value')
      });
      return;
    }

    this.isAsync = false;
    this.setValue(data);
  }

  /**
   * Set the value of the state
   * @param val
   * @private
   */
  private setValue(val: TData) {
    this._result$.next(val);
    this._result$.complete();
    this._loading$.next(false)
    this._loading$.complete();
    this.subscription?.unsubscribe();
  }

  /**
   * Emit an error
   * @param error
   * @private
   */
  private setError(error: any) {
    this._result$.error(LoadingState.parseError(error));
    this._result$.complete();
    this._loading$.next(false)
    this._loading$.complete();
    this.subscription?.unsubscribe();
  }

  /**
   * Parse errors into an Error object
   * @param error - The thrown error
   * @private
   */
  private static parseError(error: Error | any): Error {
    if ('name' in error && 'message' in error) return error;
    return Error(error.toString());
  }

  /**
   * Cancel the command
   * This will cancel HTTP requests if used
   */
  cancel() {
    this.subscription?.unsubscribe();
    if (this._result$.closed) return;
    this.setError(Error('Cancelled'));
  }

  /**
   * Subscribe to the loading state
   * @param observer
   */
  subscribe(observer: Partial<Observer<boolean>>): Unsubscribable {
    return this.loading$.subscribe(observer);
  }

  /**
   * Define a callback that will be executed on a successful action
   * @param func
   */
  then(func: (data: TData) => void): this {
    this.result$.subscribe(func);
    return this;
  }

  /**
   * Define a callback that will be executed on a failed action
   * @param func
   */
  catch(func: (error: Error) => void): this {
    this.result$.subscribe({error: func});
    return this;
  }

  /**
   * Define a callback that will be executed when the action has completed (Whether it failed or succeeded)
   * @param func
   */
  finally(func: () => void): this {
    this.result$.subscribe({complete: func});
    return this;
  }
}

export class DelayedLoadingState<TData> extends LoadingState<TData> {

  triggerSubject: Subject<void>;

  constructor(action: () => TData | Promise<TData> | Observable<TData>, modify?: (data: TData) => TData | void) {
    const triggerSubject = new Subject<void>();

    super(triggerSubject.pipe(
      first(),
      switchMap(() => {
        const data = action();
        if (data instanceof Observable) return data;
        if (data instanceof Promise) return from(data);
        return of(data);
      }),
      map(data => modify?.(data) ?? data)
    ));

    this.triggerSubject = triggerSubject;
    this.trigger$ = this.result$.pipe(tap({subscribe: () => this.triggerSubject.next()}));
  }

  trigger$: Observable<TData>;

  trigger() {
    this.triggerSubject.next();
  }
}
