import { ILoadingState } from "@consensus-labs/rxjs-tools";
import {concatMap, MonoTypeOperatorFunction, Observable, Subscription} from "rxjs";

/**
 * Triggers a load for every value
 * Cancels previous load call
 * <p>Note: Consider ensuring that values are distinct, so the same load call isn't triggered multiple times</p>
 * @param load
 * @param onError - Handle errors that occur during load; Doesn't trigger when request is cancelled by operator
 */
export function switchLoad<T>(load: (data: T) => ILoadingState, onError?: (err: any, data: T) => void): MonoTypeOperatorFunction<T> {
  return (source) => {
    return new Observable(subscriber => {

      let loading: ILoadingState | undefined;
      let errorSub: Subscription | undefined;

      const sub = source.subscribe({
        next: value => {
          // Unsub from errors before cancel, to not capture cancel error
          errorSub?.unsubscribe();

          loading?.cancel();
          loading = load(value);

          if (onError) {
            errorSub = loading.error$.subscribe(e => onError(e, value));
          }

          subscriber.next(value);
        },
        error: err => subscriber.error(err),
        complete: () => subscriber.complete()
      });

      return () => {
        sub.unsubscribe();
        errorSub?.unsubscribe();
        loading?.cancel();
      }
    })
  }
}

/**
 * Triggers a load for every value
 * Load call are queued and won't execute before the previous completes
 * <p>Note: Consider ensuring that values are distinct, so the same load call isn't triggered multiple times</p>
 * @param load
 * @param onError - Handle errors that occur during load; Doesn't trigger when request is cancelled by operator
 */
export function queuedLoad<T>(load: (data: T) => ILoadingState, onError?: (err: any) => void): MonoTypeOperatorFunction<T> {
  return (source) => {

    return source.pipe(
      // Load one at a time
      concatMap(value => new Observable<T>(subscriber => {

        const loading = load(value);
        const errorSub = onError ? loading.error$.subscribe(e => onError(e)) : undefined;

        subscriber.next(value);

        const sub = loading.subscribe({
          error: () => subscriber.complete(),
          complete: () => subscriber.complete(),
        });

        return () => {
          sub.unsubscribe();
          errorSub?.unsubscribe();
          loading?.cancel();
        }
      }))
    );
  }
}
