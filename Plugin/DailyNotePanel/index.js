const path = require('path');

/**
 * DailyNotePanel 路由胶水插件
 *
 * 作用：
 * - 通过 PluginManager 在主 app 上注册 DailyNotePanel 的前端页面路由
 * - 以及专供 DailyNotePanel 使用的一套 dailynote API 路由
 *
 * 设计要点：
 * - 不移动现有的 DailyNotePanel 前端目录和官方 routes/dailyNotesRoutes.js 文件
 * - 仅仅是“接线”：利用 projectBasePath 去 require / 挂载
 * - 第一阶段使用测试前缀：
 *   - 页面：      /DailyNotePanel2
 *   - 日记 API：  /dailynote_api2
 *   通过 plugin-manifest.json 的 PanelPathPrefix / ApiPathPrefix 可调整
 *
 * 重要：
 * - adminAuth 在 server.js 里是全局中间件，按路径前缀判断是否需要 BasicAuth。
 *   只要最终前缀仍然是 /DailyNotePanel* /dailynote_api*，就会被自动保护。
 *   本插件不重复实现认证逻辑。
 */

/**
 * 旧式 service 插件接口：
 * PluginManager.initializeServices(app, adminApiRouter, projectBasePath)
 * 会在检测到模块导出了 registerRoutes 时调用：
 *
 *   module.registerRoutes(app, adminApiRouter, pluginConfig, projectBasePath);
 *
 * 这里我们只用 app 和 projectBasePath，adminApiRouter 暂时用不到。
 *
 * @param {import('express').Express} app
 * @param {import('express').Router} adminApiRouter
 * @param {object} pluginConfig  来自 plugin-manifest.json 解析后的 config（含 DebugMode、PanelPathPrefix、ApiPathPrefix 等）
 * @param {string} projectBasePath VCP 主项目根目录（即包含 server.js 的那个目录）
 */
function registerRoutes(app, adminApiRouter, pluginConfig, projectBasePath) {
  const debug = !!pluginConfig.DebugMode;

  const panelPrefix = pluginConfig.PanelPathPrefix || '/AdminPanel/DailyNotePanel';
  const apiPrefix = pluginConfig.ApiPathPrefix || '/AdminPanel/dailynote_api';

  if (debug) {
    console.log(
      `[DailyNotePanelRouter] registerRoutes called with panelPrefix="${panelPrefix}", apiPrefix="${apiPrefix}", projectBasePath="${projectBasePath}"`
    );
  }

  // 1. 挂载 DailyNotePanel 前端静态资源
  // 前端文件已被移动到插件自身目录下：Plugin/DailyNotePanel/frontend
  // 这里通过 __dirname 定位到插件目录，再拼出 frontend 子目录
  const panelDir = path.join(__dirname, 'frontend');
  if (debug) {
    console.log(`[DailyNotePanelRouter] Serving static DailyNotePanel from: ${panelDir} at prefix: ${panelPrefix}`);
  }
  app.use(panelPrefix, require('express').static(panelDir));

  // 2. 挂载专供 DailyNotePanel 使用的一套 dailynote API
  const dailyNoteRootPath = process.env.KNOWLEDGEBASE_ROOT_PATH || path.join(projectBasePath, 'knowledge');
  if (debug) {
    console.log(`[DailyNotePanelRouter] Daily note root path: ${dailyNoteRootPath}`);
  }

  // 注意：这里严格复用官方 routes/dailyNotesRoutes.js，而不是复制实现
  const dailyNotesRoutesFactory = require(path.join(projectBasePath, 'routes', 'dailyNotesRoutes'));

  const dailyNotesRoutes = dailyNotesRoutesFactory(dailyNoteRootPath, !!pluginConfig.DebugMode);

  if (debug) {
    console.log(`[DailyNotePanelRouter] Mounting dailyNotesRoutes at: ${apiPrefix}`);
  }
  app.use(apiPrefix, dailyNotesRoutes);

  if (debug) {
    console.log('[DailyNotePanelRouter] Route registration completed.');
  }
}

module.exports = {
  registerRoutes,
};