import "jest-preset-angular/setup-jest";
import 'fake-indexeddb/auto';

globalThis.navigator = {...globalThis.navigator ?? {}, onLine: true};

//TODO: Temp fix since structuredClone is missing for unknown reasons
globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
