import {
  delay, EMPTY, first, from, isObservable, Observable, Observer, of, ReplaySubject, Subject, Subscribable, Subscription,
  take, throwError, Unsubscribable
} from "rxjs";
import {computed, signal, Signal, untracked, WritableSignal} from "@angular/core";
import {isPromise} from "rxjs/internal/util/isPromise";
import {isFunction, isString, parseError} from "@juulsgaard/ts-tools";
import {CancelledError} from "@juulsgaard/rxjs-tools";

//TODO: Move to signal-tools package

export abstract class IRequestState implements Subscribable<unknown> {
  abstract readonly request$: Observable<unknown>;
  abstract readonly result$: Observable<unknown>;

  abstract readonly result: Signal<unknown | undefined>;
  abstract readonly loading: Signal<boolean>;
  abstract readonly error: Signal<Error | undefined>;
  abstract readonly failed: Signal<boolean>;

  abstract cancel(): boolean;

  abstract then(onValue: (value: unknown) => void, onError?: (error: Error) => void): this;

  abstract catch(onError: (error: Error) => void): this;

  abstract finally(onComplete: (error?: Error) => void): this;

  subscribe(observer: Partial<Observer<unknown>>): Unsubscribable {
    return this.request$.subscribe(observer);
  }
}

export abstract class IValueRequestState<T> extends IRequestState implements Subscribable<T> {
  abstract override readonly request$: Observable<T>;
  abstract override readonly result$: Observable<T>;
  abstract override readonly result: Signal<T | undefined>;

  override subscribe(observer: Partial<Observer<T>>): Unsubscribable {
    return this.request$.subscribe(observer);
  }

  then(onValue: (value: T) => void, onError?: (error: Error) => void): this {
    this.request$.pipe(first()).subscribe({
      next: v => onValue(v),
      error: e => onError?.(parseError(e))
    });
    return this;
  }

  catch(onError: (error: Error) => void): this {
    this.request$.subscribe({
      error: e => onError(parseError(e))
    });
    return this;
  }

  finally(onComplete: (error?: Error) => void): this {
    this.request$.subscribe({
      error: e => onComplete(parseError(e)),
      complete: () => onComplete()
    });
    return this;
  }

  abstract override cancel(error?: string|Error|(() => Error)): boolean;
}

export class LoadingRequestState<T> extends IValueRequestState<T> {
  private readonly _request$ = new Subject<T>();
  readonly request$ = this._request$.asObservable();
  readonly result$ = this.request$;
  readonly result = signal(undefined).asReadonly();

  private readonly _loading = signal(true);
  readonly loading: Signal<boolean> = this._loading.asReadonly();
  readonly error: Signal<undefined> = signal(undefined);
  readonly failed: Signal<false> = signal(false);

  cancel(): boolean {
    if (this._request$.closed) return false;
    this._request$.complete();
    this._loading.set(false);
    return false;
  }
}

export class EmptyRequestState<T> extends IValueRequestState<T> {
  readonly request$ = EMPTY;
  readonly result$ = this.request$;
  readonly result = signal(undefined).asReadonly();

  readonly loading: Signal<false> = signal(false);
  readonly error: Signal<undefined> = signal(undefined);
  readonly failed: Signal<false> = signal(false);

  cancel(): boolean {
    return false;
  }
}

export class ErrorRequestState<T> extends IValueRequestState<T> {

  readonly request$: Observable<never>;
  readonly result$ = EMPTY;
  readonly result = signal(undefined).asReadonly();

  readonly loading: Signal<boolean> = signal(false);
  readonly error: Signal<Error | undefined>;
  readonly failed: Signal<boolean> = signal(true);

  constructor(getError: () => Error) {
    super();

    this.error = signal(getError());
    this.request$ = throwError(getError);
  }

  cancel(): boolean {
    return false;
  }
}

export class StaticRequestState<T> extends IValueRequestState<T> {

  readonly request$: Observable<T>;
  readonly result$: Observable<T>;
  readonly result: Signal<T>;

  readonly loading: Signal<false> = signal(false);
  readonly error: Signal<undefined> = signal(undefined);
  readonly failed: Signal<false> = signal(false);

  constructor(private readonly value: T) {
    super();

    this.request$ = of(value);
    this.result$ = this.request$;
    this.result = signal(value);

  }

  cancel(): boolean {
    return false;
  }

  override then(next: (value: T) => void, _error?: (error: Error) => void): this {
    next(this.value);
    return this;
  }

  override catch(_onError: (error: Error) => void): this {
    return this;
  }

  override finally(onComplete: () => void): this {
    onComplete();
    return this;
  }
}

export class AsyncRequestState<T> extends IValueRequestState<T> {

  private readonly _request$ = new ReplaySubject<T>();
  readonly request$ = this._request$.asObservable();

  private readonly _result$ = new ReplaySubject<T>();
  readonly result$ = this._result$.asObservable();

  private readonly _result = signal<T | undefined>(undefined);
  readonly result = this._result.asReadonly();

  private readonly _loading = signal(true);
  readonly loading = this._loading.asReadonly();

  private readonly _error = signal<Error | undefined>(undefined);
  readonly error = this._error.asReadonly();
  readonly failed = computed(() => this._error() !== undefined);

  private readonly sub: Subscription;

  constructor(request: Promise<T> | Observable<T>) {
    super();

    const request$ = isObservable(request)
      ? request.pipe(take(1))
      : from(request);

    this.sub = request$.subscribe(this._request$);

    this.request$.subscribe({
      next: value => {
        this._result$.next(value);
        this._result.set(value);
      },
      error: error => {
        this._error.set(parseError(error));
        this._result$.complete();
        this._loading.set(false);
      },
      complete: () => {
        this._result$.complete();
        this._loading.set(false);
      }
    });
  }

  cancel(error?: string|Error|(() => Error)): boolean {
    if (this.sub.closed) return false;
    this.sub.unsubscribe();
    const fullError = isString(error) ? new CancelledError(error) : isFunction(error) ? error() : error;
    this._request$.error(fullError);
    return true;
  }
}

export class WritableRequestState<T> extends IValueRequestState<T> {

  private _completed = false;
  get completed() {return this._completed};

  private readonly _request$ = new ReplaySubject<T>();
  readonly request$ = this._request$.asObservable();

  private readonly _result$ = new ReplaySubject<T>();
  readonly result$ = this._result$.asObservable();

  private readonly _result = signal<T | undefined>(undefined);
  readonly result = this._result.asReadonly();

  private readonly _loading = signal(true);
  readonly loading = this._loading.asReadonly();

  private readonly _error = signal<Error | undefined>(undefined);
  readonly error = this._error.asReadonly();
  readonly failed = computed(() => this._error() !== undefined);

  private readonly _cancelled = signal(false);
  readonly cancelled = this._cancelled.asReadonly();
  private readonly _cancelled$ = new ReplaySubject<true>();
  readonly cancelled$ = this._cancelled$.asObservable();

  constructor(private readonly onCancel?: () => void) {
    super();
  }

  asReadonly(): IValueRequestState<T> {
    return this;
  }

  setError(error: unknown | Error): void {
    if (this.completed) return;

    this._completed = true;
    this._request$.error(error);
    this._result$.complete();
    this._loading.set(false);
    this._error.set(parseError(error));
  }

  setValue(value: T) {
    if (this.completed) return;

    this._completed = true;
    this._request$.next(value);
    this._request$.complete();
    this._loading.set(false);
    this._result.set(value);
  }

  cancel(error?: string|Error|(() => Error)) {
    if (this.completed) return false;

    const fullError = isString(error) ? new CancelledError(error) : isFunction(error) ? error() : error;
    this.setError(fullError);

    this._cancelled.set(true);
    this._cancelled$.next(true);
    this._cancelled$.complete();

    this.onCancel?.();
    return true;
  }
}

function valueRequestState<T>(data: T | Promise<T> | Observable<T>): IValueRequestState<T> {
  if (isObservable(data)) return new AsyncRequestState<T>(data);
  if (isPromise(data)) return new AsyncRequestState<T>(data);
  return new StaticRequestState<T>(data);
}

function errorRequestState(error: Error | (() => Error)): IRequestState;
function errorRequestState<T>(error: Error | (() => Error)): IValueRequestState<T>;
function errorRequestState<T>(error: Error | (() => Error)): IValueRequestState<T> {
  return new ErrorRequestState(error instanceof Error ? () => error : error);
}

function loadingRequestState(): IRequestState;
function loadingRequestState<T>(): IValueRequestState<T>;
function loadingRequestState(duration: number): IRequestState;
function loadingRequestState<T>(duration: number, value: T): IValueRequestState<T>;
function loadingRequestState<T>(duration?: number, value?: T): IRequestState | IValueRequestState<T> {
  if (duration === undefined) return new LoadingRequestState<T>();
  return valueRequestState(of(value).pipe(delay(duration)));
}

function emptyRequestState(): IRequestState;
function emptyRequestState<T>(): IValueRequestState<T>;
function emptyRequestState<T>(): IValueRequestState<T> {
  return new EmptyRequestState<T>();
}

function writableRequestState<T>(onCancel?: () => void): WritableRequestState<T> {
  return new WritableRequestState<T>(onCancel);
}

type constructor = <T>(data: T | Promise<T> | Observable<T>) => IValueRequestState<T>;

interface AltConstructors {
  writable<T>(onCancel?: () => void): WritableRequestState<T>;

  error(error: Error | (() => Error)): IRequestState;

  error<T>(error: Error | (() => Error)): IValueRequestState<T>;

  loading(): IRequestState;

  loading<T>(): IValueRequestState<T>;

  loading(duration: number): IRequestState;

  loading<T>(duration: number, value: T): IValueRequestState<T>;

  empty(): IRequestState;

  empty<T>(): IValueRequestState<T>;
}

const compiled = valueRequestState as constructor & AltConstructors

compiled.writable = writableRequestState;
compiled.error = errorRequestState;

export const requestState = compiled;

compiled.error(new Error());


export class RequestTracker {

  private readonly _request: WritableSignal<IRequestState>;
  readonly request: Signal<IRequestState>;

  set current(req: IRequestState) {
    this.set(req)
  }

  get current(): IRequestState {
    return untracked(this.request)
  }

  readonly loading = computed(() => this._request().loading());
  readonly error = computed(() => this._request().error());
  readonly failed = computed(() => this._request().failed());

  constructor(request?: IRequestState) {
    this._request = signal(request ?? requestState.empty());
    this.request = this._request.asReadonly();
  }

  set(req: IRequestState): void {
    this._request.set(req);
  }

  reset() {
    this._request.set(requestState.empty());
  }
}

export class ValueRequestTracker<T> extends RequestTracker {
  private readonly _valueRequest: WritableSignal<IValueRequestState<T>>;
  override request: Signal<IValueRequestState<T>>;

  override set current(req: IValueRequestState<T>) {
    this.set(req)
  }

  override get current(): IValueRequestState<T> {
    return untracked(this.request)
  }

  constructor(request?: IValueRequestState<T>) {
    super();
    this._valueRequest = signal(request ?? requestState.empty<T>());
    this.request = this._valueRequest.asReadonly();
  }

  override set(req: IValueRequestState<T>): void {
    super.set(req);
    this._valueRequest.set(req);
  }

  override reset() {
    super.reset();
    this.set(requestState.empty<T>());
  }
}

export function requestTracker(): RequestTracker;
export function requestTracker<T>(): ValueRequestTracker<T>;
export function requestTracker<T>(request: IValueRequestState<T>): ValueRequestTracker<T>;
export function requestTracker(request: IRequestState): RequestTracker;
export function requestTracker<T>(request?: IRequestState | IValueRequestState<T>): RequestTracker | ValueRequestTracker<T> {
  if (!request) return new ValueRequestTracker<T>()
  if (request instanceof IValueRequestState) return new ValueRequestTracker<T>(request);
  return new RequestTracker(request);
}
