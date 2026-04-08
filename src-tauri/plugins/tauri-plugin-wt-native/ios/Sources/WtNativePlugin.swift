import Foundation
import SwiftRs
import Tauri
import UIKit
import WebKit

struct AdvertiseArgs: Decodable {
  let instance: String
  let port: Int
  let serviceType: String
  let rids: [String]
}

struct BrowseArgs: Decodable {
  let serviceType: String
  let onFound: Channel
}

struct FoundPayload: Encodable {
  let instance: String
  let addrs: [String]
  let rids: [String]
  var gone: Bool = false
}

struct KeepAliveArgs: Decodable {
  let active: Bool
  let sessions: Int
}

/// Bonjour via NetService: it can publish a port Rust already bound, which
/// NWListener cannot. Service type is "_name._tcp" with a trailing domain.
class WtNativePlugin: Plugin, NetServiceBrowserDelegate, NetServiceDelegate {
  private var published: NetService?
  private var browser: NetServiceBrowser?
  private var resolving: [String: NetService] = [:]
  private var channel: Channel?
  private var bgTask: UIBackgroundTaskIdentifier = .invalid

  private func bonjourType(_ t: String) -> String {
    // "_watchtower-sync._tcp.local." -> "_watchtower-sync._tcp."
    var s = t
    if s.hasSuffix(".local.") { s = String(s.dropLast(6)) }
    return s
  }

  @objc public func advertise(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AdvertiseArgs.self)
    DispatchQueue.main.async {
      let txt: [String: Data] = [
        "v": Data("1".utf8),
        "r": Data(args.rids.joined(separator: ",").utf8),
      ]
      // Re-publishing under a second name failed with -72008 on iOS, so an
      // existing announcement just gets its TXT record updated in place.
      if let svc = self.published, svc.port == Int(args.port) {
        svc.setTXTRecord(NetService.data(fromTXTRecord: txt))
        invoke.resolve()
        return
      }
      self.published?.stop()
      let svc = NetService(
        domain: "local.", type: self.bonjourType(args.serviceType),
        name: args.instance, port: Int32(args.port))
      svc.setTXTRecord(NetService.data(fromTXTRecord: txt))
      svc.delegate = self
      svc.publish()
      self.published = svc
      invoke.resolve()
    }
  }

  @objc public func stop_advertise(_ invoke: Invoke) {
    DispatchQueue.main.async {
      self.published?.stop()
      self.published = nil
      invoke.resolve()
    }
  }

  @objc public func browse(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(BrowseArgs.self)
    DispatchQueue.main.async {
      self.browser?.stop()
      self.channel = args.onFound
      let b = NetServiceBrowser()
      b.delegate = self
      b.searchForServices(ofType: self.bonjourType(args.serviceType), inDomain: "local.")
      self.browser = b
      invoke.resolve()
    }
  }

  @objc public func stop_browse(_ invoke: Invoke) {
    DispatchQueue.main.async {
      self.browser?.stop()
      self.browser = nil
      self.resolving.removeAll()
      self.channel = nil
      invoke.resolve()
    }
  }

  // Secrets live in the iOS Keychain through the Rust `keyring` crate.
  @objc public func secret_set(_ invoke: Invoke) { invoke.resolve() }
  @objc public func secret_get(_ invoke: Invoke) { invoke.resolve(["value": NSNull()]) }
  @objc public func secret_delete(_ invoke: Invoke) { invoke.resolve() }

  /// iOS cannot hold sockets in the background; this only buys the usual
  /// ~30 s grace period so a quick app switch does not drop sessions.
  @objc public func keepalive(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(KeepAliveArgs.self)
    DispatchQueue.main.async {
      if args.active && args.sessions > 0 {
        if self.bgTask == .invalid {
          self.bgTask = UIApplication.shared.beginBackgroundTask(withName: "watchtower-sessions") {
            UIApplication.shared.endBackgroundTask(self.bgTask)
            self.bgTask = .invalid
          }
        }
      } else if self.bgTask != .invalid {
        UIApplication.shared.endBackgroundTask(self.bgTask)
        self.bgTask = .invalid
      }
      invoke.resolve()
    }
  }

  // MARK: NetServiceBrowserDelegate

  func netServiceBrowser(
    _ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool
  ) {
    if service.name == published?.name { return }
    resolving[service.name] = service
    service.delegate = self
    service.resolve(withTimeout: 5)
  }

  func netServiceBrowser(
    _ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool
  ) {
    resolving.removeValue(forKey: service.name)
    if let channel = channel {
      try? channel.send(FoundPayload(instance: service.name, addrs: [], rids: [], gone: true))
    }
  }

  // MARK: NetServiceDelegate

  func netServiceDidResolveAddress(_ sender: NetService) {
    guard sender !== published, let channel = channel else { return }
    var addrs: [String] = []
    for data in sender.addresses ?? [] {
      data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
        guard let sa = raw.baseAddress?.assumingMemoryBound(to: sockaddr.self) else { return }
        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        if getnameinfo(sa, socklen_t(data.count), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
          let ip = String(cString: host)
          // Skip link-local IPv6 with scope ids; they are not dialable from here.
          if ip.contains("%") { return }
          addrs.append(sa.pointee.sa_family == sa_family_t(AF_INET6) ? "[\(ip)]:\(sender.port)" : "\(ip):\(sender.port)")
        }
      }
    }
    var rids: [String] = []
    if let txt = sender.txtRecordData() {
      let d = NetService.dictionary(fromTXTRecord: txt)
      if let r = d["r"], let s = String(data: r, encoding: .utf8) {
        rids = s.split(separator: ",").map(String.init)
      }
    }
    try? channel.send(FoundPayload(instance: sender.name, addrs: addrs, rids: rids))
  }

  func netService(_ sender: NetService, didNotPublish errorDict: [String: NSNumber]) {
    NSLog("watchtower: Bonjour publish failed: \(errorDict)")
  }

  func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
    resolving.removeValue(forKey: sender.name)
  }
}

@_cdecl("init_plugin_wt_native")
func initPlugin() -> Plugin {
  return WtNativePlugin()
}
