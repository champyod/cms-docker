'use client';

function deviceNotificationsAvailable(): boolean {
  return typeof Notification !== 'undefined';
}

/**
 * Asks for the device-notification grant once, never as a prompt of its own.
 *
 * Why the grant is requested on first use and not before an alert: a browser prompt belongs to a user
 * gesture, and the alerts this carries arrive at moments nobody clicked for.
 */
export function requestDeviceNotifications(): void {
  if (!deviceNotificationsAvailable() || Notification.permission !== 'default') return;
  void Notification.requestPermission();
}

/**
 * Posts the one OS notification a panel that is not on screen uses to reach its operator.
 *
 * Why the failure is dropped: the constructor throws when the page may not show one — an insecure
 * context, a grant revoked between the check and the call. The panel's own record still holds the
 * event, so a refused notification costs the cue outside the panel and nothing else.
 */
export function notifyDevice(title: string, detail: string): void {
  if (!deviceNotificationsAvailable() || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body: detail });
  } catch {
    return;
  }
}
