import {IStoreConfigService} from "../models/store-config-service";
import {CacheStoreService} from "../cache-store-service";
import {IndexedDbAdapter} from "../caching/adapters/indexed-db-adapter";
import {BaseReducers} from "../collections/reducers";
import 'fake-indexeddb/auto';
import {sleep} from "@juulsgaard/ts-tools";
import {CacheDatabaseContext} from "../caching/caching-interface";

var navigator = {
  onLine: true
};

interface Value {
  id: string;
  value: string;
}

interface State {
  values: Value[];
}

class StoreConfig implements IStoreConfigService {
  readonly isProduction = true;
  readonly disableCache = false;

  displayError(message: string, error: Error): void {
  }

  displaySuccess(message: string): void {
  }

  errorIsCritical(error: any): boolean {
    return false;
  }

  logActionRetry(command: string, attempt: number, nextDelay: number): void {
  }

}

class TestService extends CacheStoreService<State> {
  constructor() {
    super({values: []}, new StoreConfig(), new CacheDatabaseContext(new IndexedDbAdapter(), 'database'));
  }

  add = this.command()
    .withPayload<Value>()
    .targetList('values')
    .withReducer(BaseReducers.addition());

  update = this.command()
    .withPayload<Value>()
    .targetList('values')
    .withReducer(BaseReducers.updateById());

  remove = this.command()
    .withPayload<string>()
    .targetList('values')
    .withReducer(BaseReducers.deleteById());

  // Define the cache
  cached = this.cache('test', 1)
    .withChunks(x => x.values)
    .withId(x => x.id);

  // Command for loading entire cache
  load = this.cacheCommand(this.cached)
    .fromAll()
    .withReducer(values => ({values}))
    .noFallback();

  // Command for loading single cache value
  loadVal = this.cacheCommand(this.cached)
    .fromSingle()
    .targetList('values')
    .withReducer(BaseReducers.setById())
    .noFallback();
}


test('Cache', async () => {

  const store = new TestService();

  store.add.emit({id: 'first', value: 'Test'});
  store.add.emit({id: 'second', value: 'Hello'});

  await sleep(1000);
  const secondValue = await store.cached.readItem('second');
  expect(secondValue?.data.value).toEqual('Hello');

  const firstValue = await store.cached.readItem('first');
  expect(firstValue?.data.value).toEqual('Test');

  const allValues = await store.cached.readAll();
  expect(allValues.length).toEqual(2);

  store.remove.emit('first');
  store.update.emit({id: 'second', value: 'NewVal'});

  await sleep(1000);
  const removed = await store.cached.readItem('first');
  expect(removed).toBeUndefined();

  const updated = await store.cached.readItem('second');
  expect(updated?.data.value).toEqual('NewVal');

  store.dispose();
})

test('Load', async () => {

  const store = new TestService();

  store.add.emit({id: 'first', value: 'Test'});
  store.add.emit({id: 'second', value: 'Hello'});

  await sleep(1000);
  store.reset();
  expect(store.state.values.length).toEqual(0);

  await store.load.emitAsync();

  expect(store.state.values.length).toEqual(2);

  store.dispose();
})
