import {CommandAction} from "../models/store-types";
import {from, isObservable, Observable, of, retry, switchMap, throwError, timer} from "rxjs";
import {map} from "rxjs/operators";

export function retryAction<TData>(
  action: () => TData | Promise<TData> | Observable<TData>,
  retries: number[],
  isCritical: (error: any) => boolean
): () => Observable<TData> {
  return () => {
    return of(action).pipe(
      map(x => x()),
      switchMap(x => {
        if (isObservable(x)) return x;
        if (x instanceof Promise) return from(x);
        return of(x);
      }),
      retry({
        delay: (error: any, i: number) => {
          if (isCritical(error)) return throwError(() => error);
          const delay = retries[i];
          if (delay === undefined) return throwError(() => error);
          return timer(delay);
        }
      })
    );
  };
}
