import UserNotifications

// Sits in front of the delegate tauri-plugin-notification installs. That delegate force-unwraps
// its own lookup for every notification it is handed, so it crashes on the one the plugin posts
// itself when the task expires, whether it is shown or tapped. Everything else is forwarded.
final class ExpiryNoticeFilter: NSObject, UNUserNotificationCenterDelegate {
  static let identifier = "generation-expired"

  private let original: UNUserNotificationCenterDelegate?

  init(wrapping original: UNUserNotificationCenterDelegate?) {
    self.original = original
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    if notification.request.identifier == Self.identifier {
      completionHandler([.banner, .list, .sound])
      return
    }
    let forwarded: Void? = original?.userNotificationCenter?(
      center, willPresent: notification, withCompletionHandler: completionHandler)
    if case .none = forwarded { completionHandler([]) }
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    // Tapping it opens the app, which is all it needs to do.
    if response.notification.request.identifier == Self.identifier {
      completionHandler()
      return
    }
    let forwarded: Void? = original?.userNotificationCenter?(
      center, didReceive: response, withCompletionHandler: completionHandler)
    if case .none = forwarded { completionHandler() }
  }
}
