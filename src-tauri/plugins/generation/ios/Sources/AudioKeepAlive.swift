import AVFoundation

// The page plays an inaudible loop, which is what keeps WebKit from suspending its content
// process. This is the app's own session for it: playback, mixing with other apps.
final class AudioKeepAlive {
  private var observer: NSObjectProtocol?
  private var wanted = false

  func start() {
    wanted = true
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
    try? session.setActive(true)
    observer = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification, object: session, queue: .main
    ) { [weak self] notification in
      self?.interrupted(notification)
    }
  }

  func stop() {
    guard wanted else { return }
    wanted = false
    if let observer = observer {
      NotificationCenter.default.removeObserver(observer)
      self.observer = nil
    }
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func interrupted(_ notification: Notification) {
    guard wanted,
      let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      AVAudioSession.InterruptionType(rawValue: raw) == .ended
    else { return }
    try? AVAudioSession.sharedInstance().setActive(true)
  }
}
