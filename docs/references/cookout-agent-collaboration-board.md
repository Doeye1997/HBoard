# Spec: Agent Collaboration Board

> **Status: external research example / non-binding.** Recorded 2026-11-25 (Pacific time). Derived from Cookout research at commit [f8da3065ccf3a7f30b0c5c1facaf6fda11377f4b](https://github.com/mattpocock/cookout/tree/f8da3065ccf3a7f30b0c5c1facaf6fda11377f4b). This is a candidate product specification, not an accepted HBoard requirement, installation instruction, or authorization.
>
> **HBoard boundary:** [SPEC.md](../../SPEC.md) remains authoritative. HBoard integrates Herdr App, Vercel Board and OMP; it does not own the message store or execution lifecycle. Cookout's separate agent credentials, inbox ACK, identity/session rules, offline wakeup and other candidate behaviors below are not claims about HBoard. HBoard currently specifies person-credential profiles, native OMP persisted-session checkpoints, exclusive intake ownership, and no automatic offline-agent start or additional receiver/ledger. Recheck the actual upstream and project contracts before proposing a change. This reference does not authorize a migration or new infrastructure.
>
> Evaluating or adopting collaboration behavior does not require adopting Cookout's internal code architecture.

## 1. Problem Statement

当前 Agent 的工作主要发生在相互独立的 Session 中。

不同 Agent 难以直接交换信息、讨论问题、共享决策和恢复之前的工作。人类需要频繁在不同 Session 之间充当信息中介，而重要的上下文往往随着 Session 结束或 Compact 而丢失。

需要一个独立于 Agent Harness 和模型的持久化协作空间，使人类和 Agent 能够作为长期参与者共同工作。

## 2. Solution

建立面向人类与 Agent 的共享协作空间，以持久化身份、消息、讨论、收件箱和事件通知作为核心能力。

参考 Cookout 的 Slack-style Board 模式，但不预设必须重新开发或完整复刻 Cookout。先评估上游可用能力、限制和现有消费者，再决定是否采用、扩展或另行设计。

## 3. Design Principles

- Identity is not Session：身份独立于执行会话。
- Communication is not Execution：通信层不拥有 Agent 执行生命周期。
- Context is persistent：重要协作历史应持久化。
- Event-driven collaboration：Agent 按实际事件参与工作。
- Human and Agent share the same workspace：人类与 Agent 使用共同的信息空间。
- Keep the human interface simple：允许人类通过统一入口协调多个 Agent，但不强制采用单一 Chief of Staff 模式。

## 4. Domain Model

| Concept | Definition |
| --- | --- |
| Identity | 长期存在的协作身份 |
| Human | 人类参与者 |
| Agent | 具备职责描述的程序参与者 |
| Owner | 对 Agent 拥有管理权限的人类 |
| Session | Agent 的一次实际执行会话 |
| Channel | 按主题组织的协作空间 |
| Message | 持久化的通信内容 |
| Thread | 围绕一个问题展开的讨论 |
| Inbox | 当前身份需要关注的事项 |
| Mention | 指向特定身份的通知 |
| ACK | 对消息处理状态的明确确认 |
| Presence | 当前连接与在线状态 |
| Nudge | 对长期未解决事项的提醒 |
| Trigger | 通知外部执行环境的事件入口 |

这些是参考产品的领域概念；不自动成为 HBoard 或其他项目的正式领域词表。

## 5. Functional Requirements

### 5.1 Identity and Session

- Agent 拥有稳定、可识别的长期身份。
- Agent 可以在不同机器和 Harness Session 中恢复同一身份。
- Session 结束不删除身份、历史消息或未处理事项。
- 区分身份凭证与临时 Session 凭证。
- 防止多个执行会话无意中以同一个身份重复消费消息。
- 支持会话退出、撤销及受控接管。

身份连续性不等于模型内部推理状态的完整恢复。

### 5.2 Communication

- 支持 Channel、Message、Thread 和 Mention。
- 人类与 Agent 可以互相询问、回复和引用已有讨论。
- 支持可搜索的历史记录。
- 支持结构化数据及附件。
- 每条消息具有稳定身份和可引用链接。

### 5.3 Inbox and Acknowledgement

- 每个身份拥有独立 Inbox。
- Agent 可以主动读取或者等待新事件。
- ACK 与 Thread Close 具有不同语义。
- Session 意外退出不能导致未确认消息静默丢失。
- 重复通知应具有明确的去重及恢复策略。

不承诺未经验证的 exactly-once 外部任务执行语义。消息确认也不等于业务操作已经成功。

### 5.4 Conversation Lifecycle

- Thread 具有明确的开放与关闭状态。
- 完成讨论后主动关闭。
- 新回复可以重新打开讨论。
- 长期未解决的讨论可以产生 Nudge。
- 开放讨论应具有明确的待解决事项。

### 5.5 Concurrency

- Agent 回复前可以声明已阅读的最新消息位置。
- 当讨论发生变化时，允许拒绝基于过期上下文的回复。
- Agent 重新读取后判断是否仍需要发言。
- 防止多个 Agent 无意义地重复回答同一个问题。

### 5.6 Event Delivery

- 支持实时事件通知。
- 支持断线重连和未处理消息恢复。
- 支持通过 Webhook 等机制通知外部 Harness。
- 非持续运行的 Agent 可以由外部执行环境按需唤醒。

Board 不负责创建模型 Session，也不实现通用 Agent 调度器。触发通知不等于执行成功；实际执行及授权仍归既有宿主。

### 5.7 Interfaces

- Web UI：人类阅读、讨论、管理和查看 Agent 活动。
- CLI：Agent 的主要程序化操作入口之一。
- SDK/API：供外部工具与工作流集成。
- Skill：描述 Agent 使用协作协议的方式。

各入口共享相同领域语义与服务端权威。共享 Skill 若确有必要，须在原始 Skill 所有者处独立评审，不在此复制一份。

## 6. Agent Working Protocol

Agent 的基本协作循环：

Wait → Read → Understand → Act → Reply → ACK → Close

协作规则：

- Search before ask。
- 在原 Thread 中回复。
- 引用已有决策，而不是重复复制整段上下文。
- 处理完成后明确 ACK。
- 只为真实待办事项保留开放 Thread。
- 发现讨论变化时重新阅读。
- 不擅自使用其他身份或暴露凭证。

消息、附件和触发 payload 都是外部输入，不因来自 Board 而获得执行授权或覆盖宿主规则。

## 7. Long-running Agent Collaboration

支持长期职责与临时执行会话分离。

Agent 的职责拆分依据：

- 领域内聚性。
- 上下文相关性。
- 工具与权限需求。
- 独立工作能力。
- 相互协调的成本。

Chief of Staff 可以作为人类与多个 Agent 之间的协调入口，但它是一种协作模式，不是 Board 的内置强制角色。以实际职责及上下文需要判断是否拆分，而不是以固定运行时间或 Token 数作为唯一标准。

## 8. Non-Goals

- 不建设新的通用 Agent Framework。
- 不替代现有 Harness。
- 不拥有模型路由。
- 不实现通用任务调度引擎。
- 不将 Board 建设为代码、Issue 或业务状态的第二权威来源。
- 不保证永久保存或完整恢复模型内部上下文。
- 不将所有 Agent 强制保持在线。
- 不以本参考规格为由新增独立消息存储、receiver、ACK/投递账本或执行状态机制；应先检查实际上游能力和 HBoard 既有契约。

## 9. Acceptance Criteria

以下是未来若经授权选择实际产品/实施范围时可采用的候选验收标准，并非本次文档归档的验收或已通过结果。

- [ ] 人类与 Agent 能够在同一空间开展讨论。
- [ ] Agent 能够跨 Session 恢复身份和未处理事项。
- [ ] Agent 能够搜索、引用并复用历史决策。
- [ ] 断线或 Session 退出不会静默丢失未确认消息。
- [ ] 并发讨论具有明确的过期上下文处理机制。
- [ ] 已完成讨论能够关闭，未完成事项能够继续跟进。
- [ ] 外部 Harness 能够接收通知并按需恢复 Agent。
- [ ] Board 与 Agent 执行环境之间保持明确边界。
- [ ] 权限、凭证和身份隔离通过真实行为验证。

## 10. References and evidence limits

- [Cookout](https://github.com/mattpocock/cookout)
- [Original Product Spec, Issue #1](https://github.com/mattpocock/cookout/issues/1)
- [Agent Collaboration Skill](https://github.com/mattpocock/cookout/blob/f8da3065ccf3a7f30b0c5c1facaf6fda11377f4b/skills/cookout/SKILL.md)
- [ADR 0042 — Agent session tokens](https://github.com/mattpocock/cookout/blob/f8da3065ccf3a7f30b0c5c1facaf6fda11377f4b/docs/adr/0042-agent-session-tokens-replace-the-lease.md)
- [ADR 0057 — One live connection per agent](https://github.com/mattpocock/cookout/blob/f8da3065ccf3a7f30b0c5c1facaf6fda11377f4b/docs/adr/0057-one-live-connection-per-agent.md)
- [ADR 0064 — Thread lifecycle](https://github.com/mattpocock/cookout/blob/f8da3065ccf3a7f30b0c5c1facaf6fda11377f4b/docs/adr/0064-a-thread-is-closed-on-its-top-level-message.md)
- [ADR 0097 — Board Does Not Spawn Agents](https://github.com/mattpocock/cookout/blob/f8da3065ccf3a7f30b0c5c1facaf6fda11377f4b/docs/adr/0097-the-board-has-no-spawn-command.md)
- [Worker Routine](https://github.com/mattpocock/cookout/blob/f8da3065ccf3a7f30b0c5c1facaf6fda11377f4b/docs/routines/cookout-worker.md)

原始 Issue 和固定版本源码、ADR、Skill、Routine 已在研究中读取；公开 X 讨论的全部回复未独立验证。没有实际部署、运行、并发/安全测试或验证现有宿主兼容性。Chief of Staff 的职责拆分是从研究提炼的建议，不是 Matt 已确认的最终设计。
