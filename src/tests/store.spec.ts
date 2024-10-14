import {StoreService} from "../store-service";
import {ActionCancelledError, IStoreConfigService} from "../models";
import {delay, of} from "rxjs";
import {TestBed} from "@angular/core/testing";
import {NoopStoreConfig} from "./shared";
import {expect} from "@jest/globals";

interface State {
  temp: string;
}

class TestService extends StoreService<State> {
  constructor() {
    super({temp: ''});
  }

  syncAction = this.command()
    .withPayload<string>()
    .withReducer(str => ({temp: str}));

  asyncAction = this.command()
    .withAction((str: string) => of(str).pipe(delay(100)))
    .withReducer(str => ({temp: str}));

  initialAction = this.command()
    .withAction((str: string) => of(str).pipe(delay(100)))
    .isInitial()
    .withReducer(str => ({temp: str}));

  initialScopedAction = this.command()
    .withAction((str: string) => of(str).pipe(delay(100)))
    .isInitial(x => x)
    .withReducer(str => ({temp: str}));

  noConcurrentAction = this.command()
    .withAction((str: string) => of(str).pipe(delay(100)))
    .cancelConcurrent()
    .withReducer(str => ({temp: str}));

  noConcurrentScopedAction = this.command()
    .withAction((str: string) => of(str).pipe(delay(100)))
    .cancelConcurrent(x => x)
    .withReducer(str => ({temp: str}));
}

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [{provide: IStoreConfigService, useClass: NoopStoreConfig}, TestService]
  })
});

test('Sync Action', () => {
  const store = TestBed.inject(TestService);

  expect(store.state()).toStrictEqual({temp: ''});

  store.syncAction.emit('Modified');
  expect(store.state()).toStrictEqual({temp: 'Modified'});
});

test('Async Action', async () => {
  const store = TestBed.inject(TestService);

  expect(store.state()).toStrictEqual({temp: ''});

  const req = store.asyncAction.emit('Modified');
  expect(store.asyncAction.loading()).toBe(true);

  await req;
  expect(store.state()).toStrictEqual({temp: 'Modified'});
});

test('Initial Load Action', async () => {
  const store = TestBed.inject(TestService);
  await store.initialAction.emit('Modified');

  const fails = store.initialAction.emit('Fails').asPromise();
  await expect(fails).rejects.toBeInstanceOf(ActionCancelledError);
});

test('Initial Scoped Load Action', async () => {
  const store = TestBed.inject(TestService);
  await store.initialScopedAction.emit('Scope');
  await store.initialScopedAction.emit('Scope 2');

  const fails = store.initialScopedAction.emit('Scope').asPromise();
  await expect(fails).rejects.toBeInstanceOf(ActionCancelledError);
});

test('No Concurrent Action', async () => {
  const store = TestBed.inject(TestService);
  store.noConcurrentAction.emit('Modified');

  const fails = store.noConcurrentAction.emit('Fails').asPromise();
  await expect(fails).rejects.toBeInstanceOf(ActionCancelledError);
});

test('No Concurrent Scoped Action', async () => {
  const store = TestBed.inject(TestService);
  store.noConcurrentScopedAction.emit('Scope');
  store.noConcurrentScopedAction.emit('Scope 2');

  const fails = store.noConcurrentScopedAction.emit('Scope').asPromise();
  await expect(fails).rejects.toBeInstanceOf(ActionCancelledError);
});
