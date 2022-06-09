
import {of} from "rxjs";
import {StoreCommand} from "../models/store-types";
import {StoreServiceContext} from "../configs/command-config";

export class PlainCommand<TState, TData> extends StoreCommand<TState> {

  /** @internal */
  constructor(
    context: StoreServiceContext<TState>,
    private readonly reducer: (state: TState, data: TData) => TState
  ) {
    super(context);
  }

  emit(payload: TData) {
    this.context.applyCommand(of(state => this.reducer(state, payload)));
  };

}
