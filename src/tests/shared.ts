import {IStoreConfigService} from "../models";

export class NoopStoreConfig implements IStoreConfigService {
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
