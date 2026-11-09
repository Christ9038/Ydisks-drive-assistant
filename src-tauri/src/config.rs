//! 全局常量与配置。
//!
//! 集中存放后端 API 地址、各网盘登录入口、迅雷 SDK 常量，
//! 以及注入到登录/验证窗口的内联脚本。避免业务模块硬编码魔法值。

/// Ydisks 控制台 API 默认地址。
pub const DEFAULT_CONSOLE_API_BASE: &str = "https://console.ydisks.com";

/// 后台返回的「短链额度不足」错误码。
pub const QUOTA_LIMITED_CODE: i32 = 1101;

/// 登录完成时向前端广播的事件名。
pub const PROVIDER_LOGIN_EVENT: &str = "provider-login-complete";

/// 迅雷二次验证完成事件：二次验证窗口验证成功后广播给前端，携带 CreditKey，供前端自动继续登录。
pub const XUNLEI_REVIEW_COMPLETE_EVENT: &str = "xunlei-review-complete";

/// 迅雷二次验证完成时注入脚本导航到的哨兵路径（同源 i.xunlei.com），后端 `on_navigation` 据此捕获 CreditKey。
pub const XUNLEI_REVIEW_DONE_PATH: &str = "/xlcaptcha/__ydisks_done__";

/// 夸克网盘登录页地址。
pub const QUARK_LOGIN_URL: &str = "https://pan.quark.cn/";

/// 百度网盘登录页地址。
pub const BAIDU_LOGIN_URL: &str = "https://pan.baidu.com/";

// === 迅雷 SDK 常量 ===

pub const XUNLEI_CLIENT_ID: &str = "Xp6vsxz_7IYVw2BB";
pub const XUNLEI_CLIENT_SECRET: &str = "Xp6vsy4tN9toTVdMSpomVdXpRmES";
pub const XUNLEI_CLIENT_VERSION: &str = "8.31.0.9726";
pub const XUNLEI_PACKAGE_NAME: &str = "com.xunlei.downloadprovider";
pub const XUNLEI_WEB_USER_AGENT: &str = "ANDROID-com.xunlei.downloadprovider/8.31.0.9726 netWorkType/5G appid/40 deviceName/Xiaomi_M2004j7ac deviceModel/M2004J7AC OSVersion/12 protocolVersion/301 platformVersion/10 sdkVersion/512000 Oauth2Client/0.9 (Linux 4_14_186-perf-gddfs8vbb238b) (JAVA 0)";
pub const XUNLEI_CORE_USER_AGENT: &str = "android-ok-http-client/xl-acc-sdk/version-5.0.12.512000";
/// 夸克/百度登录窗口使用的桌面 Chrome UA（WKWebView 默认 UA 会让部分站点降级页面）。
pub const LOGIN_DESKTOP_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
pub const XUNLEI_REVIEW_USER_AGENT: &str = "Mozilla/5.0 (Linux; Android 12; M2004J7AC Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36";
pub const XUNLEI_API_BASE: &str = "https://api-pan.xunlei.com/drive/v1";
pub const XUNLEI_APP_ID: &str = "40";
pub const XUNLEI_APP_KEY: &str = "34a062aaa22f906fca4fefe9fb3a3021";
pub const XUNLEI_SIGN_PROVIDER: &str = "access_end_point_token";

/// 迅雷验证码签名算法池。
pub const XUNLEI_CAPTCHA_ALGORITHMS: &[&str] = &[
    "9uJNVj/wLmdwKrJaVj/omlQ",
    "Oz64Lp0GigmChHMf/6TNfxx7O9PyopcczMsnf",
    "Eb+L7Ce+Ej48u",
    "jKY0",
    "ASr0zCl6v8W4aidjPK5KHd1Lq3t+vBFf41dqv5+fnOd",
    "wQlozdg6r1qxh0eRmt3QgNXOvSZO6q/GXK",
    "gmirk+ciAvIgA/cxUUCema47jr/YToixTT+Q6O",
    "5IiCoM9B1/788ntB",
    "P07JH0h6qoM6TSUAK2aL9T5s2QBVeY9JWvalf",
    "+oK0AN",
];

/// 注入到迅雷短信验证窗口的初始化脚本，用于启动 XlCaptcha 并回显 CreditKey。
pub const XUNLEI_REVIEW_INIT_SCRIPT: &str = r#"
(function () {
  window.env = window.env || 'android';
  window.__ydisksXunleiReviewStarted = false;

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function showYdisksPanel(title, message, creditKey) {
    var body = document.body;
    if (!body) return;
    body.style.display = 'block';
    var old = document.getElementById('ydisks-xunlei-review-result');
    if (old) old.remove();
    var panel = document.createElement('div');
    panel.id = 'ydisks-xunlei-review-result';
    panel.style.cssText = 'position:fixed;left:16px;right:16px;top:16px;z-index:999999;background:#fff;border:1px solid #d9d9d9;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#1f2329;';
    panel.innerHTML =
      '<div style="font-weight:700;font-size:18px;margin-bottom:8px;">' + escapeHtml(title) + '</div>' +
      '<div style="font-size:14px;line-height:1.6;color:#5f6673;margin-bottom:10px;">' + escapeHtml(message) + '</div>' +
      (creditKey ? '<textarea readonly style="box-sizing:border-box;width:100%;height:92px;border:1px solid #d9d9d9;border-radius:4px;padding:8px;font-size:13px;">' + escapeHtml(creditKey) + '</textarea>' : '');
    body.insertBefore(panel, body.firstChild);
  }

  function initCaptcha() {
    if (window.__ydisksXunleiReviewStarted) return;
    if (!window.XlCaptcha || typeof window.XlCaptcha.init !== 'function') return;
    window.__ydisksXunleiReviewStarted = true;
    try {
      window.XlCaptcha.init({
        IFRAME_BOX_ID: 'captch-wrap',
        PANEL_THEME: 'embed',
        CLOSEABLE: true,
        VERTIFY_SUCC_FUNC: function (result) {
          var creditKey = result && (result.creditkey || result.creditKey || result.credit_key);
          document.title = '迅雷验证完成';
          showYdisksPanel('迅雷验证完成', creditKey ? '验证成功，正在自动返回 Ydisks 助手继续登录……' : '验证完成，但页面没有返回 CreditKey。', creditKey || JSON.stringify(result || {}));
          // 把 CreditKey 通过哨兵 URL 回传给 Tauri 后端（on_navigation 捕获），触发自动继续登录。
          if (creditKey) {
            try {
              window.location.href = 'https://i.xunlei.com/xlcaptcha/__ydisks_done__?creditkey=' + encodeURIComponent(creditKey);
            } catch (e) { /* 导航失败时用户仍可手动复制 CreditKey */ }
          }
        }
      });
    } catch (error) {
      window.__ydisksXunleiReviewStarted = false;
      showYdisksPanel('迅雷验证页初始化失败', error && error.message ? error.message : String(error), '');
    }
  }

  var timer = window.setInterval(initCaptcha, 200);
  window.addEventListener('load', function () {
    initCaptcha();
    window.setTimeout(function () {
      window.clearInterval(timer);
      if (!window.__ydisksXunleiReviewStarted) {
        showYdisksPanel('迅雷验证页未初始化', '页面脚本没有暴露 XlCaptcha，无法启动短信验证面板。', '');
      }
    }, 8000);
  });
})();
"#;
