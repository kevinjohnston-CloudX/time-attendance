import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CloudTimeBridgeViewController()
        window?.backgroundColor = .systemBackground
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Same as CXT's (CXTBridgeViewController). iOS 26 blurs a band over the top
/// and bottom edges of a scroll view; on the web view it reads as a white or
/// grey smear across the status bar, in light and dark. The page draws its own
/// bars, so the effect is turned off.
class CloudTimeBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        view.backgroundColor = .systemBackground
        guard let webView = webView else { return }
        if #available(iOS 26.0, *) {
            webView.scrollView.topEdgeEffect.isHidden = true
            webView.scrollView.bottomEdgeEffect.isHidden = true
        }
        bridge?.registerPluginInstance(BadgeScreenPlugin())
    }
}

/// Full brightness while the badge is on screen, and the person's own level
/// back on every way out. iOS keeps whatever level an app sets, even after the
/// app leaves, and the page may not get to run when the phone locks or the app
/// is closed, so the putting back happens here.
///
/// The level saved is the one from before the first raise, kept on disk until
/// it is put back: a second raise never saves the full level as the original,
/// and a level left behind by a crash is put back at the next start.
@objc(BadgeScreenPlugin)
class BadgeScreenPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "BadgeScreenPlugin"
    let jsName = "BadgeScreen"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "raise", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]

    private static let savedKey = "cloudtime.badge.brightness.original"
    /// The badge page is open and wants full brightness while the app is in front.
    private var wanted = false
    private var watching = false

    override func load() {
        // Left behind by a crash. Only put back while the screen is still at
        // our full level; anything else is the person's own choice since.
        if UserDefaults.standard.object(forKey: Self.savedKey) != nil, UIScreen.main.brightness < 0.99 {
            UserDefaults.standard.removeObject(forKey: Self.savedKey)
        }
        putBack()
        watch()
    }

    private func watch() {
        if watching { return }
        watching = true
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(leaving), name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(leaving), name: UIApplication.willTerminateNotification, object: nil)
        center.addObserver(self, selector: #selector(back), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc func raise(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.watch()
            self.wanted = true
            self.lift()
            call.resolve()
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.wanted = false
            self.putBack()
            call.resolve()
        }
    }

    /// Locking, the app switcher, another app, or closing it.
    @objc private func leaving() { putBack() }

    /// Back in front with the badge still open: save the level as it is now,
    /// which the person may have changed while away, and raise again.
    @objc private func back() { if wanted { lift() } }

    private func lift() {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: Self.savedKey) == nil {
            defaults.set(Double(UIScreen.main.brightness), forKey: Self.savedKey)
        }
        UIScreen.main.brightness = 1
    }

    private func putBack() {
        let defaults = UserDefaults.standard
        guard let original = defaults.object(forKey: Self.savedKey) as? Double else { return }
        UIScreen.main.brightness = CGFloat(original)
        defaults.removeObject(forKey: Self.savedKey)
    }
}
