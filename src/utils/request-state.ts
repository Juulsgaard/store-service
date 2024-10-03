import {first, from, isObservable, Observable, Observer, of, ReplaySubject, Subscribable, Unsubscribable} from "rxjs";
import {signal, Signal} from "@angular/core";
import {isPromise} from "rxjs/internal/util/isPromise";
import {CancelledError} from "../models";

//TODO: Move to signal-tools package

export abstract class IRequestState implements Subscribable<unknown> {
  abstract readonly request$: Observable<unknown>;
  abstract readonly result$: Observable<unknown>;

  abstract readonly result: Signal<unknown | undefined>;
  abstract readonly loading: Signal<boolean>;
  abstract readonly error: Signal<Error | undefined>;
  abstract readonly failed: Signal<boolean>;

  abstract cancel(): boolean;

  abstract then(next: (value: unknown) => void, error?: (error: Error) => void): this;

  subscribe(observer: Partial<Observer<unknown>>): Unsubscribable {
    return this.request$.subscribe(observer);
  }
}

export class LoadingRequestState {

}

export class EmptyRequestState {

}

export class ErrorRequestState extends IRequestState {

}

export class TypesErrorRequestState<T> extends IValueRequestState<T> {

}

export abstract class IValueRequestState<T> extends IRequestState implements Subscribable<T> {
  abstract override readonly request$: Observable<T>;
  abstract override readonly result$: Observable<T>;
  abstract override readonly result: Signal<T | undefined>;

  abstract override then(next: (value: T) => void, error?: (error: Error) => void): this;

  override subscribe(observer: Partial<Observer<T>>): Unsubscribable {
    return this.request$.subscribe(observer);
  }
}

export class StaticRequestState<T> extends IValueRequestState<T> {

  readonly request$: Observable<T>;
  readonly result$: Observable<T>;
  readonly result: Signal<T>;

  readonly loading = signal(false);
  readonly error = signal(undefined);
  readonly failed = signal(false);

  constructor(private readonly value: T) {
    super();

    this.request$ = of(value);
    this.result$ = this.request$;
    this.result = signal(value);

  }

  override cancel(): boolean {
    return false;
  }

  override then(next: (value: T) => void, _error?: (error: Error) => void): this {
    next(this.value);
    return this;
  }
}

export class RequestState<T> extends IValueRequestState<T> {

  readonly request$: Observable<T>;

  constructor(request: Promise<T> | Observable<T>) {
    super();

    this.request$ = isObservable(request) ? request.pipe(first()) : from(request);
  }
}

export class WritableRequestState<T> extends RequestState<T> {

  private readonly _request$: ReplaySubject<T>;

  private readonly _cancelled$ = new ReplaySubject<true>();
  readonly cancelled$ = this._cancelled$.asObservable();

  constructor(private readonly onCancel?: () => void) {
    const request$ = new ReplaySubject<T>();
    super(request$);

    this._request$ = request$;
  }

  asReadonly(): RequestState<T> {
    return this;
  }

  setError(error: unknown|Error): void {
    this._request$.error(error);
    this._request$.complete();
  }

  setValue(value: T) {
    this._request$.next(value);
    this._request$.complete();
  }

  cancel() {
    if (this._request$.closed) return false;
    this.setError(new CancelledError());

    if (this._cancelled$.closed) return false;
    this._cancelled$.next(true);
    this._cancelled$.complete();

    this.onCancel?.();
    return true;
  }
}

function writableRequestState<T>(onCancel?: () => void): WritableRequestState<T> {
  return new WritableRequestState<T>(onCancel);
}

function errorRequestState(error: Error|(() => Error)): IRequestState {

}

function typedErrorRequestState<T>(error: Error|(() => Error)): IValueRequestState<T> {

}

function valueRequestState<T>(data: T | Promise<T> | Observable<T>): IValueRequestState<T> {
  if (isObservable(data)) return new RequestState<T>(data);
  if (isPromise(data)) return new RequestState<T>(data);
  return new StaticRequestState<T>(data);
}

const compiled = valueRequestState as typeof valueRequestState & {
  writable: typeof writableRequestState,
  error: typeof errorRequestState,
  typedError: typeof typedErrorRequestState,
};

compiled.writable = writableRequestState;
compiled.error = errorRequestState;
compiled.typedError = typedErrorRequestState;

export const requestState = compiled;
