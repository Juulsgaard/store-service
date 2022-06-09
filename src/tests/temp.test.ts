import {StoreService} from "../store-service";
import {IStoreConfigService} from "../models/store-config-service";

interface State {
  temp: string;
}

class StoreConfig implements IStoreConfigService {
  readonly isProduction = false;

  displayError(error: Error): void {
  }

  displaySuccess(message: string): void {
  }

}

class TestService extends StoreService<State> {
  constructor() {
    super({temp: ''}, new StoreConfig());
  }
}

const store = new TestService();

test('Store', () => {
  expect(store.state).toStrictEqual({temp: ''});
})
