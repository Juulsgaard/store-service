
export type IdMap<T> = (data: T) => string|(string|undefined)[];

export function parseIdMap<T>(map: IdMap<T>): (data: T) => string {
  return data => {
    const id = map(data);
    if (Array.isArray(id)) {
      return id.filter(x => !!x).join('_');
    }
    return id;
  }
}
