/**
 * @file types.ts
 * @description Types and interfaces for background service and daemon managers.
 */

/**
 * Valid action verbs for background service operations.
 */
export type ServiceAction =
  | 'install'
  | 'uninstall'
  | 'start'
  | 'stop'
  | 'restart'
  | 'status'
  | 'logs';

/**
 * Execution details resolved for generating background service scripts.
 */
export interface ServiceExecDetails {
  execCmd: string;
  nodePath: string;
  scriptPath: string;
  workDir: string;
  user: string;
}

/**
 * Common contract for platform-specific service providers.
 */
export interface PlatformServiceProvider {
  handleAction(action: ServiceAction | string): Promise<void>;
}
