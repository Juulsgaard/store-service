
export type KeysOfType<T, TProp> = { [P in keyof T]-?: T[P] extends TProp ? P : never }[keyof T];
export type ArrayType<T> = T extends (infer A)[] ? A : never;
export type Conditional<T, TBase, TTrue, TFalse = never> = T extends TBase ? TTrue : TFalse;

export interface WithId {
  id: string;
}
