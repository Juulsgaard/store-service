import {StoreService} from "../store-service";
import {IStoreConfigService} from "../models/store-config-service";
import {of} from "rxjs";

interface State {
  temp: string;
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

class TestService extends StoreService<State> {
  constructor() {
    super({temp: ''}, new StoreConfig());
  }

  action = this.command()
    .withAction((str: string) => of(str))
    .withReducer(str => ({temp: str}));
}

const store = new TestService();

test('Store', () => {
  expect(store.state).toStrictEqual({temp: ''});
  store.action.observe('Test');
  expect(store.state).toStrictEqual({temp: 'Test'});
  store.action.observe('Hello');
  expect(store.state).toStrictEqual({temp: 'Hello'});
})
