import {Observable, OperatorFunction, startWith} from "rxjs";
import {future, Future, LoadingState} from "@juulsgaard/rxjs-tools";
import {map} from "rxjs/operators";

/**
 * Triggers a load for every value
 * Cancels previous load call
 * Emits Futures representing the load actions
 * <p>Note: Consider ensuring that values are distinct, so the same load call isn't triggered multiple times</p>
 * @param load
 */
export function switchFutureLoad<TPayload, TData>(
  load: (payload: TPayload) => LoadingState<TData>
): OperatorFunction<TPayload, Future<NonNullable<TData>>> {
  return (source) => {
    return new Observable(subscriber => {

      let loading: LoadingState<TData> | undefined;

      const sub = source.subscribe({
        next: payload => {
          const oldLoad = loading;

          loading = load(payload);
          const value$ = loading.result$.pipe(startWith(undefined));

          const futures = future(value$, loading.loading$, loading.error$);

          subscriber.next(futures);

          oldLoad?.cancel();
        },
        error: err => subscriber.error(err),
        complete: () => subscriber.complete()
      });

      return () => {
        sub.unsubscribe();
        loading?.cancel();
      }
    })
  }
}

/**
 * Maps an observable to a Future
 * @param value$ - Map the value to a value observable
 * @param loading$ - Map the value to a loading observable
 * @param error$ - Map the value to an error observable
 */
export function mapFuture<TPayload, TData>(
  value$: (payload: TPayload) => Observable<TData>,
  loading$?: (payload: TPayload) => Observable<boolean>,
  error$?: (payload: TPayload) => Observable<Error | boolean | undefined>,
): OperatorFunction<TPayload, Future<NonNullable<TData>>> {
  return (source) => source.pipe(
    map(payload => future(value$(payload), loading$?.(payload), error$?.(payload)))
  );
}
