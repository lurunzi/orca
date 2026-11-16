# Runtime 同步文件操作与客户端轮询门禁

## 当前范围

Dashboard 当前获准部署源码固定为 fork 标签 `v0.1.0-mvp.3`，提交为 `9cd7142f4d0cdb65f7a475a91f981e6a15ca1431`。该版本存在两项门禁失败：`main-sync-fs-ratchet` 和 `recurring-timer-ratchet`，共涉及 7 个文件。

fork `main` 的提交 [32c9634f1f77e871d5100a8faf910cb397b6238d](https://github.com/lurunzi/orca/commit/32c9634f1f77e871d5100a8faf910cb397b6238d) 已处理这些门禁。部署冻结标签尚未包含该提交，是否将相关变更纳入后续部署批次仍待确认。

门禁统计源码调用点，并与文件级允许数量比较。调用点数量不能用于计算运行次数、耗时或故障概率。当前失败说明实现与基线没有对齐，实际性能影响还取决于调用频率、图片大小及存储速度。

## 复现与验证结果

在目标版本的 fork 根目录安装依赖后执行：

```powershell
pnpm check:main-sync-fs-ratchet
pnpm check:recurring-timer-ratchet
```

本次核验环境为 Windows、Node.js `v24.19.0`、pnpm `12.14.0`。

| 源码                                                        | 两项门禁结果 | 证据边界                                                                                                                                        |
| ----------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 部署冻结提交 `9cd7142f4d0cdb65f7a475a91f981e6a15ca1431`     | 两项均失败   | 复用此前该确切提交的推送前检查记录；与前一冻结提交 `4d56bc0c9193ce4185996b3ef939a598e25ca3e8` 相比，7 个文件和两份基线的 Git blob ID 均未变化。 |
| fork `main` 提交 `32c9634f1f77e871d5100a8faf910cb397b6238d` | 两项均通过   | 本轮在 Windows 直接执行两项门禁取得结果。只验证静态门禁，未执行 Linux 镜像或并发性能验收。                                                      |

冻结版本此前通过的 mobile-web 构建、30 项定向回归和 Node/CLI/Web 类型检查，不能替代这两项门禁，也不能证明 Linux 实机性能已达标。

## 同步文件操作

[同步文件操作检查](../../config/scripts/static-analysis/ratchets/runtime-lifecycle/check-main-sync-fs-ratchet.mjs)扫描生产代码中的同步文件操作，并与[文件级基线](../../config/main-sync-fs-baseline.txt)比较。冻结版本中的以下 3 个文件没有对应允许条目，共命中 6 个源码调用点。

表内源码链接固定到部署冻结提交，便于核对尚未采用后续处理时的实现。

| 功能与位置                                                                                                                                                                                      | 调用点                                                                 | 触发条件与可见影响                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Cursor ACP 历史解析](https://github.com/lurunzi/orca/blob/9cd7142f4d0cdb65f7a475a91f981e6a15ca1431/src/main/ai-vault/session-scanner-cursor-acp-parser.ts#L45-L56)                             | 1 个 `existsSync`                                                      | 解析 ACP 历史时判断数据库是否存在。慢存储可能拖慢历史扫描、搜索及列表刷新。缓存复用可减少重复解析。                                              |
| [Antigravity hook 状态检查](https://github.com/lurunzi/orca/blob/9cd7142f4d0cdb65f7a475a91f981e6a15ca1431/src/main/antigravity/hook-service.ts#L44-L49)                                         | 1 个 `statSync`                                                        | 检查已配置的托管脚本是否可用。部分安装、设置更新和状态查询会触发；Windows 还需要检查事件包装脚本。源码只有一个调用点，一次状态检查可能调用多次。 |
| [Claude 读图快照保存](https://github.com/lurunzi/orca/blob/9cd7142f4d0cdb65f7a475a91f981e6a15ca1431/src/main/native-chat/agent-session-attachments/agent-session-attachment-store.ts#L177-L193) | 4 个同步调用：`existsSync`、`mkdirSync`、`writeFileSync`、`renameSync` | 成功读图后首次保存快照时执行，重复图片可复用已有文件。大图、多图或慢盘可能延迟工具结果入日志，以及同一 Runtime 的其他请求。                      |

### 执行位置与影响范围

Cursor ACP 正常历史扫描由[独立 scanner 子进程](../../src/main/ai-vault/scan-service/session-scanner-service-spawn.ts#L39-L52)执行。同步存在性检查直接占用扫描进程的线程，父 Runtime 等待查询结果，其事件循环不会因此被直接阻塞。同一扫描进程处理的其他历史任务仍可能等待。

Antigravity 状态检查可由 [Runtime 设置更新后的 hook 协调](../../src/main/runtime/client/settings/runtime-client-settings.ts#L267-L286)间接触发，满足相关安装和配置条件时，在处理请求的 Runtime 线程执行。它属于安装与状态检查路径，不会在每次模型请求或工具调用时执行。

Claude 快照写入发生在[工具结果入日志之前](../../src/main/claude/claude-message-journaling.ts#L184-L199)。headless Runtime 也会[装配附件存储](../../src/main/runtime/agent-session/structured-agent-session-attachment-wiring.ts#L43-L56)，因此这条同步写入路径可在 Docker 实例中执行，执行者是宿主 Runtime，而非 Claude CLI 子进程。

后两处同步等待可能延迟同一 Runtime 中的会话或 RPC；严重时，调用方可能遇到响应超时。其他容器的事件循环不会被直接阻塞。共享磁盘竞争是否会间接影响其他实例，需要实测。

图片快照必须先保存，再由日志引用。改变写入方式时需要保留这个顺序，否则可能出现日志已引用、图片尚未落地的状态。

## 客户端轮询

[周期定时器检查](../../config/scripts/static-analysis/ratchets/runtime-lifecycle/check-recurring-timer-ratchet.mjs)统计生产代码中的 `setInterval`，并与[文件级基线](../../config/recurring-timer-baseline.txt)比较。冻结版本的以下 4 个文件各有 1 个调用点，没有对应允许条目。

| 功能与位置                                                                                                                                                                                                          | 周期     | 冻结版本已有的保护与剩余开销                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [Cursor 外部会话自动发现](https://github.com/lurunzi/orca/blob/9cd7142f4d0cdb65f7a475a91f981e6a15ca1431/src/renderer/src/components/native-chat/CursorTranscriptDiscoveryGate.tsx#L64-L125)                         | 60 秒    | 已有页面隐藏时跳过回调、请求防重和卸载清理。前台仍会周期查询历史，数据较多时增加扫描负载。                                       |
| [终端聊天模型选项识别](https://github.com/lurunzi/orca/blob/9cd7142f4d0cdb65f7a475a91f981e6a15ca1431/src/renderer/src/components/native-chat/session/options/terminal/use-native-chat-session-options.ts#L129-L207) | 1 秒     | 在 Claude/Antigravity 启动阶段探测模型信息，找到结果或约 1 分钟后停止，已有并发保护。期间会增加终端屏幕读取。                    |
| [Cursor 历史会话恢复状态](https://github.com/lurunzi/orca/blob/9cd7142f4d0cdb65f7a475a91f981e6a15ca1431/src/renderer/src/components/native-chat/use-cursor-transcript-resume.ts#L41-L76)                            | 60 秒    | 上层按会话可见性启用，卸载会清理。内部没有请求防重，查询耗时超过周期时存在重叠风险；恢复输入区的可用状态随查询更新。             |
| [聊天输入建议](https://github.com/lurunzi/orca/blob/9cd7142f4d0cdb65f7a475a91f981e6a15ca1431/src/renderer/src/components/native-chat/use-native-chat-prompt-suggestion.ts#L21-L38)                                  | 500 毫秒 | 读取终端已有提示，结构化聊天不走这条轮询，上层也有可见性控制。增加的是客户端读取、解析和状态更新开销，不会每半秒向模型发送请求。 |

四处代码都有卸载清理。门禁仅凭调用点计数，无法确认定时器泄漏，也不会自动评估这些手写保护是否充分。

这些定时器属于 Orca 客户端渲染层。仅部署 headless 容器不会在服务器进程中注册它们；客户端发起的历史查询、终端快照读取等操作仍可能把负载传到 Runtime。

## 来源与当前处理

上述 7 处与已合入的原版上游提交 `dedec1407402fb7d5711d45fac84106e1b57f802` 对比，均属于 fork 的定制差异。Cursor ACP 解析中的同步检查来自 fork 提交 [5bbb1c49311c7d14440ece88811f5517ea3421db](https://github.com/lurunzi/orca/commit/5bbb1c49311c7d14440ece88811f5517ea3421db)；图片同步快照来自 [3f44a10d8fcad54e142f7c369894ef9264d9b5a9](https://github.com/lurunzi/orca/commit/3f44a10d8fcad54e142f7c369894ef9264d9b5a9)。

Antigravity 同步检查和 4 个定时器在本地最早可见的 fork 整合提交 `2e8b1cc272379ee70dbedeef02a84e8bde11904e` 中已有。本地是浅克隆，这个边界提交不能视为它们的首次引入提交。本项目分支独有的非合并提交未新增这 7 处代码。

当前 fork `main` 的处理分为两类：

- 四处轮询接入[窗口可见性定时器](../../src/renderer/src/lib/window-activity/window-visibility-interval.ts)，Cursor ACP 的文件存在性检查改用 gated 异步 stat。
- Antigravity 状态检查和图片快照继续使用同步操作，补充理由并登记基线。前者需要保持现有同步状态接口，且仅检查少量脚本；后者需要保证图片先于日志引用落地。

登记基线使这些已解释的调用符合门禁要求，同步 I/O 的实际开销仍然存在。该提交还包含其他 lint、文件清理和测试收集变更，采用前需审查整个提交或明确选取的范围。

## 后续版本的验证要求

是否将上述处理纳入部署版本、采用整个提交还是选取相关变更，均待确认。原冻结标签保持不动，后续采用时建立独立验证批次。

- 在后续确切提交上运行两项门禁，复核同步操作例外的范围与理由。
- 验证隐藏时暂停轮询、恢复可见后的刷新，以及历史自动发现、恢复会话和模型选项识别仍可用。
- 验证历史扫描可读取有数据库和未发送消息的空 ACP 会话。
- 验证图片快照先于日志引用保存，重复图片可复用，原图删除后历史图片仍可查看。
- 如需确认性能影响，在实际 Linux 存储上测量读图快照和历史查询耗时，并观察同一 Runtime 的并发请求延迟。

目前缺少 Linux 镜像及真实并发负载下的耗时数据。两项静态门禁通过不能证明运行时没有卡顿；现有失败记录也没有证明已发生数据损坏或权限故障。
