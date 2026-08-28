export const MAINTENANCE_SHUTDOWN_ARGUMENT = '--shutdown-for-maintenance'

export function hasMaintenanceShutdownArgument(
  argumentsList: readonly string[],
): boolean {
  return argumentsList.some((argument) => argument === MAINTENANCE_SHUTDOWN_ARGUMENT)
}
