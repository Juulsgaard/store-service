import {IStoreConfigService} from "../models/store-config-service";
import {firstValueFrom, of} from "rxjs";
import {CacheStoreService} from "../cache-store-service";
import {IndexedDbAdapter} from "../caching/adapters/indexed-db-adapter";
import {BaseReducers} from "../collections/reducers";
import 'fake-indexeddb/auto';
import {sleep} from "@consensus-labs/ts-tools";

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

}

class TestService extends CacheStoreService<State> {
  constructor() {
    super({values: []}, 'default', new StoreConfig(), new IndexedDbAdapter());
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

  cached = this.cache('test', 1)
    .withChunks(x => x.values)
    .withId(x => x.id);
}

const store = new TestService();

test('Cache', async () => {

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
})
