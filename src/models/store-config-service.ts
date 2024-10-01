/**
 * An injectable providing configuration options for Stores
 */
export abstract class IStoreConfigService {

  abstract displaySuccess(message: string): void;
  abstract displayError(message: string|undefined, error: Error): void;
  abstract readonly isProduction: boolean;
  abstract readonly disableCache: boolean;

  /**
   * A method to filter out critical errors.
   * Critical errors will not retry when encountered in a command
   * <p>INFO: An example could be to filter our 401 errors for API calls</p>
   * @param error
   */
  abstract errorIsCritical(error: any): boolean;

  abstract logActionRetry(command: string, attempt: number, nextDelay: number): void;
}
