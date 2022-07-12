import {distinctUntilChanged, EMPTY, from, Observable} from "rxjs";
import {catchError, concatMap, filter, map, pairwise} from "rxjs/operators";
import {arrToMap} from "@consensus-labs/ts-tools";
import {CacheChunkContext} from "./caching-interface";

interface Changes<TChunk> {
  added: {id: string, data: TChunk}[];
  updated: {id: string, data: TChunk}[];
  removed: {id: string}[];
}

export class CacheChunk<TChunk> {
  private ignoreValueChange?: string;

  constructor(private chunks$: Observable<TChunk[]>, private context: CacheChunkContext<TChunk>, private getId: (chunk: TChunk) => string) {
    this.chunks$.pipe(
      distinctUntilChanged(),
      map(x => arrToMap(x, getId)),
      pairwise(),
      map(([oldMap, newMap]) => this.mapChanges(oldMap, newMap)),
      filter(x => !!x.added.length || !!x.updated.length || !!x.removed.length),
      concatMap(x => from(this.applyChanges(x))),
      catchError(() => EMPTY)
    ).subscribe();
  }

  private mapChanges(oldMap: Map<string, TChunk>, newMap: Map<string, TChunk>): Changes<TChunk> {

    const changes: Changes<TChunk> = {
      added: [],
      updated: [],
      removed: []
    };

    for (let [id, oldValue] of oldMap) {

      const newValue = newMap.get(id);

      if (!newValue) {
        if (this.ignoreValueChange === id) continue;
        changes.removed.push({id});
        continue;
      }

      if (oldValue === newValue) continue;
      if (this.ignoreValueChange === id) continue;

      changes.updated.push({id, data: newValue});
    }

    for (let [id, newValue] of newMap) {
      if (oldMap.has(id)) continue;
      if (this.ignoreValueChange === id) continue;
      changes.added.push({id, data: newValue});
    }

    this.ignoreValueChange = undefined;
    return changes;
  }

  private async applyChanges(changes: Changes<TChunk>) {
    const trx = await this.context.startTransaction();

    try {

      for (let {id, data} of changes.added) {
        await trx.addValue(id, data);
      }

      for (let {id, data} of changes.updated) {
        await trx.updateValue(id, data);
      }

      for (let {id} of changes.removed) {
        await trx.deleteValue(id);
      }

      await trx.commit();
    } finally {
      await trx.dispose();
    }
  }

  loadItem(id: string, maxAge?: number): Observable<TChunk|undefined> {
    // Ignore the next time this value is updated in the store
    // This is to skip the change resulting from this cache load
    this.ignoreValueChange = id;

    const trx = this.context.startTransaction();

    return from(trx.then(x => x.readValue(id).then(val => {
      if (val === undefined) return undefined;
      if (maxAge) {
        const age = Date.now() - val.createdAt.getTime();
        if (age > maxAge) return undefined;
      }
      return val.data;
    })));
  }
}
