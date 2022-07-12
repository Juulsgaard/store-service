import {StoreCommand} from "../models/store-types";
import {StoreServiceContext} from "../configs/command-config";
import {QueueAction} from "../models/queue-action";

export class PlainCommand<TState, TData> extends StoreCommand<TState> {

  constructor(
    context: StoreServiceContext<TState>,
    private readonly reducer: (state: TState, data: TData) => TState
  ) {
    super(context);
  }

  emit(payload: TData) {
    this.context.applyCommand(new QueueAction<TState>(this, () => state => this.reducer(state, payload)));
  };

}
