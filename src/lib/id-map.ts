
export type IdMap<T> = (data: T) => Identifier;
export type Identifier = string|(string|undefined)[];

export function parseIdMap<T>(map: IdMap<T>): (data: T) => string {
  return data => parseIdentifier(map(data));
}

export function parseIdentifier(id: Identifier) {
  if (Array.isArray(id)) {
    return id.filter(x => !!x).join('_');
  }
  return id;
}
