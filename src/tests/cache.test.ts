import {IStoreConfigService} from "../models/store-config-service";
import {of} from "rxjs";
import {CacheStoreService} from "../cache-store-service";
import {IndexedDbAdapter} from "../caching/adapters/indexed-db-adapter";
import {BaseReducers} from "../collections/reducers";

interface State {
  strings: string[];
}

class StoreConfig implements IStoreConfigService {
  readonly isProduction = true;
  readonly disableCache = false;

  displayError(message: string, error: Error): void {
  }

  displaySuccess(message: string): void {
  }

}

class TestService extends CacheStoreService<State> {
  constructor() {
    super({strings: []}, 'default', new StoreConfig(), new IndexedDbAdapter());
  }

  addStr = this.command()
    .withAction((str: string) => of(str))
    .targetList('strings')
    .withReducer(BaseReducers.addition());

  cached = this.cache('test', 1)
    .withChunks(x => x.strings)
    .withId(x => x);
}

const store = new TestService();

test('Cache', () => {
  expect(store.state.strings.length).toEqual(0);
  store.addStr.emit('First');
  expect(store.state.strings.length).toEqual(1);
  store.addStr.observe('Second');
  expect(store.state.strings.length).toEqual(2);
})
