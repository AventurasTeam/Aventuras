import BackgroundTasks
import Tauri
import UIKit
import UserNotifications
import os

struct StartArgs: Decodable {
  let title: String
  let subtitle: String
  let onExpire: Channel
  let notifyOnExpire: Bool
}

struct StopArgs: Decodable { let outcome: String? }

struct UpdateArgs: Decodable {
  let stage: String
  let notifyOnExpire: Bool?
}

// One continued-processing task at a time, matching one generation at a time in the app.
@available(iOS 26.0, *)
final class GenerationPlugin: Plugin {
  // Progress follows the pipeline's stages. Within a stage it creeps toward the ceiling, because
  // the system may expire a task whose progress stops moving.
  private static let totalUnits: Int64 = 10_000
  private static let creepTimeConstant = 45.0
  private static let stages: [String: (floor: Double, ceiling: Double, subtitle: String)] = [
    "preparing": (0, 10, "Preparing…"),
    "writing": (10, 70, "Writing the next scene…"),
    "world": (70, 90, "Updating the world…"),
    "finishing": (90, 99, "Finishing up…"),
  ]
  private static let outcomes: [String: (title: String, subtitle: String)] = [
    "done": ("Story ready", "Generation complete."),
    "failed": ("Generation failed", "Open Aventuras to retry."),
    "stopped": ("Generation stopped", "You stopped the generation."),
    "interrupted": ("Generation interrupted", "iOS paused Aventuras before it finished."),
    "cutShort": ("Story ready", "iOS paused Aventuras before the background updates finished."),
  ]

  private let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "app", category: "generation")
  private let audio = AudioKeepAlive()
  private var requestIdentifier: String?
  private var task: BGContinuedProcessingTask?
  private var onExpire: Channel?
  private var notifyOnExpire = false
  private var noticeFilter: ExpiryNoticeFilter?
  private var timer: DispatchSourceTimer?
  private var stage = "preparing"
  private var stageStartedAt = Date()

  private var identifierPrefix: String {
    "\(Bundle.main.bundleIdentifier ?? "app").generation"
  }

  @objc public func start(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(StartArgs.self)
    DispatchQueue.main.async { self.begin(args, invoke) }
  }

  @objc public func stop(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(StopArgs.self)
    DispatchQueue.main.async {
      self.finish(success: args.outcome != "failed", outcome: args.outcome ?? "done")
      invoke.resolve()
    }
  }

  @objc public func update(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UpdateArgs.self)
    DispatchQueue.main.async {
      if let notify = args.notifyOnExpire { self.notifyOnExpire = notify }
      self.enter(stage: args.stage)
      invoke.resolve()
    }
  }

  private func begin(_ args: StartArgs, _ invoke: Invoke) {
    finish(success: true, outcome: nil)
    installNoticeFilter()
    audio.start()
    stage = "preparing"
    stageStartedAt = Date()

    // Each run registers its own identifier, which the plist's wildcard has to cover.
    let identifier = "\(identifierPrefix).\(UUID().uuidString.prefix(8))"
    let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) {
      [weak self] task in
      guard let task = task as? BGContinuedProcessingTask else { return }
      DispatchQueue.main.async { self?.run(task) }
    }
    guard registered else {
      log.error("\(identifier) is not permitted by BGTaskSchedulerPermittedIdentifiers")
      audio.stop()
      invoke.reject("task identifier \(identifier) is not permitted")
      return
    }

    let request = BGContinuedProcessingTaskRequest(
      identifier: identifier, title: args.title, subtitle: args.subtitle)
    request.strategy = .fail
    requestIdentifier = identifier
    onExpire = args.onExpire
    notifyOnExpire = args.notifyOnExpire

    do {
      try BGTaskScheduler.shared.submit(request)
      invoke.resolve()
    } catch {
      log.error("submit failed: \(error.localizedDescription)")
      audio.stop()
      requestIdentifier = nil
      onExpire = nil
      invoke.reject("could not start background task: \(error.localizedDescription)")
    }
  }

  private func run(_ task: BGContinuedProcessingTask) {
    guard task.identifier == requestIdentifier else {
      task.setTaskCompleted(success: false)
      return
    }
    self.task = task
    task.progress.totalUnitCount = Self.totalUnits
    task.progress.completedUnitCount = 0
    enter(stage: stage)

    task.expirationHandler = { [weak self] in
      DispatchQueue.main.async {
        guard let self = self else { return }
        self.log.error("task expired")
        // In the last stage the story is saved; only the background updates were cut short.
        let storyReady = self.stage == "finishing"
        self.notifyExpired(storyReady: storyReady)
        try? self.onExpire?.send(["reason": "expired"])
        self.finish(success: storyReady, outcome: storyReady ? "cutShort" : "interrupted")
      }
    }

    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now() + 1, repeating: 1)
    timer.setEventHandler { [weak self] in self?.creep() }
    timer.resume()
    self.timer = timer
  }

  private func enter(stage name: String) {
    guard let stage = Self.stages[name] else { return }
    self.stage = name
    stageStartedAt = Date()
    guard let task = task else { return }
    let floor = Int64(stage.floor / 100 * Double(Self.totalUnits))
    // Entering "preparing" again means a new turn joined the task, so the ring starts over.
    if name == "preparing" || floor > task.progress.completedUnitCount {
      task.progress.completedUnitCount = floor
    }
    task.updateTitle("Generating story…", subtitle: stage.subtitle)
  }

  private func creep() {
    guard let task = task, let stage = Self.stages[stage] else { return }
    let sinceStage = Date().timeIntervalSince(stageStartedAt)
    let fraction = 0.95 * (1 - exp(-sinceStage / Self.creepTimeConstant))
    let percent = stage.floor + (stage.ceiling - stage.floor) * fraction
    let units = Int64(percent / 100 * Double(Self.totalUnits))
    if units > task.progress.completedUnitCount { task.progress.completedUnitCount = units }
  }

  // The notification plugin installs its delegate when the app starts, so wrap it here, once, at the
  // first generation. The center holds its delegate weakly, hence the stored reference.
  private func installNoticeFilter() {
    let center = UNUserNotificationCenter.current()
    if center.delegate is ExpiryNoticeFilter { return }
    let filter = ExpiryNoticeFilter(wrapping: center.delegate)
    noticeFilter = filter
    center.delegate = filter
  }

  // The WebView may be suspended before JS can react, so the notice is posted here. Not while the
  // app is active: the user is already looking at it.
  private func notifyExpired(storyReady: Bool) {
    guard notifyOnExpire, UIApplication.shared.applicationState != .active else { return }
    let content = UNMutableNotificationContent()
    if storyReady {
      content.title = "Story ready"
      content.body = "iOS paused Aventuras before the background updates finished."
    } else {
      content.title = "Story generation interrupted"
      content.body = "iOS paused Aventuras before it finished. Tap to return and retry."
    }
    let request = UNNotificationRequest(
      identifier: ExpiryNoticeFilter.identifier, content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request) { [weak self] error in
      if let error = error {
        self?.log.error("expiry notification failed: \(error.localizedDescription)")
      }
    }
  }

  private func finish(success: Bool, outcome: String?) {
    audio.stop()
    timer?.cancel()
    timer = nil
    if let task = task {
      if let outcome = outcome, let text = Self.outcomes[outcome] {
        if outcome == "done" { task.progress.completedUnitCount = Self.totalUnits }
        task.updateTitle(text.title, subtitle: text.subtitle)
      }
      task.setTaskCompleted(success: success)
    } else if let id = requestIdentifier {
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: id)
    }
    task = nil
    requestIdentifier = nil
    onExpire = nil
  }
}

@_cdecl("init_plugin_generation")
public func initPlugin() -> Plugin {
  if #available(iOS 26.0, *) { return GenerationPlugin() }
  return Plugin()
}
