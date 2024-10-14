import {CacheStoreService} from "../cache-store-service";
import {CacheDatabaseContext, IndexedDbAdapter} from "../caching";
import {BaseReducers} from "../collections";
import 'fake-indexeddb/auto';
import {sleep} from "@juulsgaard/ts-tools";
import {TestBed} from "@angular/core/testing";
import {IStoreConfigService} from "../models";
import {NoopStoreConfig} from "./shared";
import {expect} from "@jest/globals";

interface Value {
  id: string;
  value: string;
}

interface State {
  values: Value[];
}

class TestService extends CacheStoreService<State> {
  constructor() {
    super({values: []}, new CacheDatabaseContext(new IndexedDbAdapter(), 'database'));
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

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [{provide: IStoreConfigService, useClass: NoopStoreConfig}, TestService]
  })
});

test('Cache', async () => {

  console.log(process.versions.node)

  expect(global.setTimeout).not.toBeUndefined();
  expect(global.structuredClone).not.toBeUndefined();

  const store = TestBed.inject(TestService);

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

test('Load', async () => {

  const store = TestBed.inject(TestService);

  store.add.emit({id: 'first', value: 'Test'});
  store.add.emit({id: 'second', value: 'Hello'});

  await sleep(1000);
  store.reset();
  expect(store.state().values.length).toEqual(0);

  await store.load.emit();

  expect(store.state().values.length).toEqual(2);
})
