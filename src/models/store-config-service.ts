/**
 * An injectable providing configuration options for Stores
 */
export interface IStoreConfigService {

  displaySuccess(message: string): void;
  displayError(message: string|undefined, error: Error): void;
  readonly isProduction: boolean;

}
