/**
 * An injectable providing configuration options for Stores
 */
export interface IStoreConfigService {

  displaySuccess(message: string): void;
  displayError(message: string|undefined, error: Error): void;
  readonly isProduction: boolean;
  readonly disableCache: boolean;

  /**
   * A method to filter out critical errors.
   * Critical errors will not retry when encountered in a command
   * <p>INFO: An example could be to filter our 401 errors for API calls</p>
   * @param error
   */
  errorIsCritical(error: any): boolean;
}
