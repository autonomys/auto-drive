/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'db-migrate' {
  interface Options {
    cwd?: string // Current working directory
    noPlugins?: boolean // Flag to disable plugins
    plugins?: Record<string, any> // Custom plugins
    [key: string]: any // Additional options
  }

  /**
   * Gets an instance of the module.
   * @param isModule - Indicates if the instance is a module.
   * @param options - Configuration options.
   * @param callback - Optional callback function.
   * @returns A new instance of the module.
   */
  export function getInstance(
    isModule: boolean,
    options?: Options,
    callback?: (...args: any[]) => void,
  ): any
}
