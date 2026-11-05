# 设计验收：通过

日期：2026-11-05；验收对象为 0.1.0 的真实 Electron 界面。参考为 PRD v05 设计图，并以用户后续确认的浅色主题、编辑器、工作空间及新建会话要求为准。

原图 1487×1058，真实窗口内容区 1440×1024。对照将参考等比缩放至实际内容区尺寸，左右拼接；系统标题栏与演示终端内容不作为像素匹配目标。

![参考与实际界面对照](test-results/design-comparison.png)

![导航与终端局部对照](test-results/design-focus.png)

检查结果：左侧工作空间与会话、中间 CLI、右侧文件树和预览的层级与主次保持一致；灰白基础表面、紫色主操作/选中态、细分隔线、圆角和底部状态区域符合方向。真实信息密度高于示例，加入了搜索、真实进程状态、文件标签与编辑操作。标题和正文清晰，预览正文已调整为 14px；收缩右栏后终端自适应，不截断主要操作。统一使用 Phosphor 图标，品牌采用终端符号。实际 CLI 内容直接来自终端，跟随基础主题，因此浅色图不使用早期示例的固定黑色终端。

字体、间距、颜色、图像与文案均完成可视检查：正文和等宽终端层级明确；分栏可拖动且无重叠；背景图仅作用图片层；预览内容与终端文字保持不透明；操作使用中文，CLI 保留官方原文。原图品牌字形和真实组件字体存在差异，为实现选择，不承诺逐像素复制位图。

真实截图：[浅灰](test-results/app-light.png)、[黑夜](test-results/app-dark.png)、[右侧收缩](test-results/app-right-collapsed.png)。交互依据最终打包应用回归：主题、编辑草稿保留、分屏与右侧收缩均通过。当前观察未发现阻断本机交付的布局或可读性问题；其他屏幕缩放比例和 Windows 未验证。

## 0.1.2 交互复核：通过

[展开菜单](test-results/menu-expanded-fixed.png)与[会话删除入口](test-results/session-delete-fixed.png)来自实际 Electron 窗口、本地协议模拟会话。检查确认新增按钮未挤出导航，删除操作使用独立按钮；菜单选中态与朝上箭头由截图及计算样式断言验证。菜单外内容区/标题空白区、重复点击、Esc 收起均通过最终包回归。首版设计方向不变。

## 0.1.4 文件布局复核：通过

[上下调整后的布局](test-results/preview-resized.png)、[内容放大](test-results/preview-maximized.png)来自实际 Electron 窗口，已完成可视检查。分隔条位于文件树与文件标签之间，放大/还原位于内容工具栏；放大后内容完整覆盖中间及右侧，左侧导航保持可见，无悬浮终端或布局重叠。自动化检查覆盖边界尺寸、原位编辑器实例、草稿与 PTY 保留、还原原宽度与分栏、收起/关闭的退出行为，最终包 7 项通过。

## 0.1.5 Git 与文件树复核：通过

[黑夜文件树着色](test-results/file-tree-colored-dark.png)、[图形化 Git 黑夜](test-results/git-graphical-dark.png)、[图形化 Git 浅灰](test-results/git-graphical-light.png)、[红绿行差异](test-results/git-diff-dark.png)。均为实际 Electron 界面和本地专用测试仓库，已可视检查布局与颜色。文件列表用短名称、次级路径、状态标签和行数替代整段文本；颜色同时配文字，冲突独立分组。目录状态汇总、文件类型图标、干净/非仓库/二进制场景均有独立表达。最终包 8 项专项与现有编辑/布局回归通过，无渲染错误。

## 0.1.7 终端与导航复核：通过

[原 HUD 的真实 CLI](test-results/hud-native.png)、[终端控件](test-results/terminal-controls.png)、[左侧图标栏与草稿保留](test-results/navigation-collapsed.png)、[额度底栏](test-results/weekly-quota-footer.png)来自实际应用窗口。已检查图标栏保留活动入口、边缘展开按钮可见、标题栏字号/复制/回到底部不遮挡标题，原 HUD 保持自身内容与配色。最小宽度下保留额度及账号切换；按需隐藏次要时间与状态。最终包 43 项交互检查通过，真实 HUD 和终端剪贴板/滚动另有证据。

## 0.1.8 应用图标复核：通过

原始图标已检查，紫色圆角底、白色终端符号与叠层卡片在小尺寸下可辨识。[实际浅灰界面](test-results/workspace-light.png)已可视检查：品牌图片替换占位符，名称、折叠按钮、导航和窗口布局正常。打包应用自动化确认图片 naturalWidth 为 128；原生 ICNS 与源文件内容一致。Dock/Finder 的系统缓存刷新不属于该界面截图证据。

## 0.1.9 终端字体复核：通过

[实际字体与中文混排](test-results/bundled-font-terminal.png)已可视检查，JetBrains Mono 的数字/字母/标点、粗体、斜体与中文均清晰。常规终端排版保持等宽字符格，未开启编程连字。字体设置包含“JetBrains Mono（内置 · 推荐）”，可与系统选项切换；混排截屏及 xterm 实际测量验证共同确认字体生效。

## 0.1.10 最近删除复核：通过

[实际最近删除界面](test-results/recently-deleted.png)已经可视检查。左侧入口与账号、历史、设置同级；主区域按工作空间/会话分层，组名、数量、展开箭头清晰，子行有目录、删除时间、剩余期限和恢复按钮。Shell 提示恢复范围；空清单有明确说明。恢复中按钮禁用并显示进度，错误由提示反馈且保留条目。专项覆盖组折叠和跨空间恢复，恢复替换的新标签在提交前隐藏，提交后只留一个入口。


## 0.2.0 账号卡片与导航过渡复核

基于已选方案一比对 [设计与最终实现](docs/screenshots/account-cards-comparison-final.png) 和 [卡片细节](docs/screenshots/account-cards-focus-final.png)。三列层级、首屏四卡、官方剩余额度、自定义模型无订阅条与底部操作保持方案结构。隔离测试使用演示账号和额度，背景图关闭；截图不包含原生窗口交通灯，不伪造系统装饰。终端图标替换概念图的通用 AI 字样，时间与导航内容按测试状态变化。

发现并修复两项 P2：首版卡片字体偏小，已增加主要名称与指标字号；新增文件夹容器被旧通用 span 样式拉伸并在窄栏隐藏，已用精确选择器固定 18px 宽并保留显示。[修复前](docs/screenshots/account-cards-folder-before.png) 与最终截图已核对，标签恢复左对齐。[实际工作状态](docs/screenshots/working-session-border.png) 的左侧和中间标签无布局位移，自动化验证边框像素移动、空闲复原及 reduced-motion 静态行为。图标旋转复用同一 SVG 节点，文件夹交叉淡入和窄栏可用性检查通过。

浅灰、深色、960px 最小窗口截图与交互测试通过；文字和工具图标存在轻微密度差异，不影响所选卡片结构及操作。永久删除有原生确认，恢复与切换失败保留来源。无阻断视觉问题。

final result: passed


## 0.2.1 添加连接与焦点样式

已核对 [筛选框焦点](docs/screenshots/connection-focus-fixed.png)：单个外框完整包裹图标和文字，内层 select 不再单独描边。[自定义供应商表单](docs/screenshots/custom-provider-form.png) 的字段、模型选择和主次操作清晰，密钥为密码输入，文本区已统一主题；去除重复页脚后，1024 高窗口完整显示表单。低高度窗口保留滚动。新增配置不把本地检查表述为真实推理成功。

final result: passed
