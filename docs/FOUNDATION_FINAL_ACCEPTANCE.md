# FOUNDATION_FINAL_ACCEPTANCE.md

**REOS — Foundation Final Hardening · 验收报告**
日期：2026-08-24 · 依据：`REOS_FOUNDATION_FINAL_HARDENING_SPEC_FOR_OX.md`（§44 要求的 A–G 结构）

---

## A. Fixed Issues（逐项对应 Spec）

| Spec | 项目 | 状态 |
|---|---|---|
| §3 | Low Confidence 门禁前移到一切匹配之前；已有同 Property+Type Case 不可绕过 | ✅ `workflows/inbound.ts` 步骤 5，NEEDS_REVIEW 兜底 Case，零自动化 |
| §4 | Case Matcher 重做：多因子评分 + 独立 matchConfidence + reason 列表 | ✅ `domain/matching.ts`（scoreCaseMatch）+ `workflows/matching.ts`（matchCaseForMessage）；≥0.90 LINK / 0.70–0.89 SUGGEST（人工复核）/ <0.70 不链接 |
| §5 | AI/Context 失败安全降级：邮件保留、无虚构关系、AI_FAILED Activity + 技术性 Audit | ✅ inbound.ts catch → openReviewCase(READY_FOR_REVIEW)；故障注入测试通过 |
| §6 | Communication Party 模型：senderType(CONTACT/USER/SYSTEM/EXTERNAL) + senderContactId/senderUserId/senderData/recipientData | ✅ schema/enums + communication.ts migration |
| §7 | Raw Email Simulation：From/To/Subject/Body 文本输入，系统自行完成识别；Advanced Test Overrides 仅调试折叠区 | ✅ inbox 页新表单 + `workflows/ingest.ts` 单一入口；E2E 全部走 raw 路径 |
| §8 | Source Identity 字段：source/sourceAccountId/externalMessageId/externalConversationId/sourceCreatedAt/lastSyncedAt + 唯一约束防重 | ✅ unique index `communications_source_message_uidx(source, sourceAccountId, externalMessageId)` |
| §9 | 入站英文自动中文翻译：Original 不可变，translatedContentZh 另存；失败不影响主流程可 Retry | ✅ translateInbound fire-and-forget + UI Retry 按钮 + `[中译]` 展示断言 |
| §10 | AI Reply Subject 使用 originalMessage.subject（"Re: <原主题>"） | ✅ gateway.generateReply 契约修正 |
| §11 | 四维分类持久化：businessDomain/caseType/actionRequired/classificationConfidence/classifiedAt/classificationSource 存于 Communication | ✅ workflow 步骤 4 写入；人工改分类走 RECLASSIFIED 审计 |
| §12 | Inbox Tabs 由 actionRequired + workflow status 驱动，不再从 AIAction/Approval 存在性反推 | ✅ inbox/page.tsx TAB 过滤重写 |
| §13 | Case/Task 状态闭环：NEW→AI_PROCESSING→READY_FOR_REVIEW→…→WAITING→FOLLOW_UP_DUE→COMPLETED | ✅ domain/workflowClosure.ts + approval 执行后置 WAITING + completeTask 收口；集成测试覆盖 |
| §14 | Approval 数据库变更事务化：approve/edit/reject/execute 均 db.transaction 包含状态+审计 | ✅ workflows/approval.ts 四处 transaction |
| §15 | Outbox 幂等执行：action_executions 表唯一 executionKey；重复调用返回既有结果绝不二次发送 | ✅ executeApproved claim→send→EXECUTED；§37 测试证明 replay 无第二次发送 |
| §16 | Confidence ≠ Risk 拆分：riskLevel(LOW/MEDIUM/HIGH/CRITICAL) 独立字段；Bulk Approve 需 risk=LOW ∧ confidence≥阈值 ∧ 类型在 allowlist | ✅ domain/risk.ts bulkApproveDecision；approvals 页批量按钮接入 |
| §17 | 永久禁止 Bulk Approve 类型清单（Offer Acceptance/Rent Adjustment/Trust Money 等） | ✅ NEVER_BULK_APPROVE_TYPES，即使 confidence=100% 也需人工 |
| §18–§19 | PM 镜像实体：Tenancy/Lease/MaintenanceJob/Inspection 最小实体；MaintenanceJob ≠ Case（cases.maintenance_job_id 弱关联） | ✅ schema/pm.ts + migration 0002/0003 |
| §20 | ExternalEntityMapping 统一映射表（source+externalEntityType+externalId 唯一） | ✅ migration 0002 |
| §21 | 外部数据不 Hard Delete：sourceStatus/sourceDeletedAt/syncStatus 字段就绪 | ✅ pm.ts 各实体含 source 元数据 |
| §22 | Source-owned vs REOS-owned 分离策略文档化 | ✅ domain/ownership.ts SOURCE_OWNERSHIP 矩阵（代码即文档） |
| §23 | Property/Contact 历史角色：unique 约束调整为支持 validFrom/validTo 多段历史 | ✅ propertyContacts 支持同一 contact 同角色多时期 |
| §24–§25 | Sync 元数据（syncStatus SYNCED/PENDING/STALE/ERROR/ARCHIVED + lastSyncedAt）与 Stale Policy Interface 就位 | ✅ 字段全量落库；policy interface 于 ownership/confidence 模块预留 |
| §26 | INFORMATION_ONLY/NO_ACTION 且无可靠已有 Case 时仅归档，不制造 Case 垃圾 | ✅ inbound informational 分支 |
| §27 | Contact Matching Pipeline：normalise→exact→unique? auto / ambiguous→review / unknown→EXTERNAL，不自动造 Contact | ✅ workflflows/matching.ts matchContactByEmail + SENDER_AMBIGUOUS hold |
| §28 | Property Matching Pipeline：租约关系优先 → 会话线程 → 地址文本；输出 confidence+reason；不确定即 review | ✅ matchProperty 三级证据链 + PROPERTY_UNRESOLVED hold |
| §29 | @reos/domain 收口：confidence/risk/bulk-allowlist/case-matching/ownership/workflowClosure 纯业务规则已迁入，无 DB 依赖 | ✅ 6 个纯模块，单测直接覆盖 |
| §30 | 统一 Audit writer | ✅ packages/audit recordAudit()（correlationId/caseId/metadata 一致化），workflow 全面改用；渐进迁移符合 Spec |
| §31 | CorrelationId 全链路：ingest→classify→match→task→approval→outbox→send→audit 同 ID | ✅ corr_ UUID 贯穿所有 Activity/Audit/execution 行 |

## B. Architecture Changes

1. **Source of Truth 矩阵落地**（Spec §1–§2）：PropertyMe=PM 主数据、Grow=Sales、Outlook=Email、REOS=运营智能层。REOS 不再复制 PM 主数据，只持有镜像（pm.ts）+ 工作层对象（Case/Task/Approval）。矩阵以常量形式固化于 `domain/ownership.ts`。
2. **Case Matcher**：分类置信度与匹配置信度完全独立，双门禁缺一不可（`automationAllowed()`）。评分因子含会话线程、PM 外部实体主题签名覆盖率、参与者、相似度等 9 因子。
3. **Outbox**：外部效果一律经 `action_executions`（唯一 executionKey），Mock Connector 与未来 Outlook Connector 共享相同语义——审批通过的执行天然幂等。
4. **Risk vs Confidence**：risk 描述业务后果、confidence 描述判断把握。批量批准 = allowlist ∧ LOW ∧ ≥0.90 三条件。

## C. Database Changes

- `0002_puzzling_demogoblin.sql`：新增枚举 execution_status / risk_level / sender_type / source_system / sync_status / tenancy_status / lease_status / maintenance_job_status / inspection_status；新表 **action_executions**（execution_key 唯一）、**external_entity_mappings**（source+type+external_id 唯一）、**tenancies / leases / maintenance_jobs / inspections**（各含 source 元数据与唯一外部标识）
- `0003_clever_punisher.sql`：cases 增加 maintenance_job_id（弱关联 PM MaintenanceJob）
- Communications：新增 source 身份字段组 + `communications_source_message_uidx` 唯一索引；senderType/party 字段
- Property Contacts：validFrom/validTo 历史区间约束调整

## D. Test Evidence

| Gate | 结果 |
|---|---|
| lint | 9/9 package 通过（0 error / 0 warning） |
| typecheck | 8/8 package 通过（tsc --noEmit 零错误） |
| vitest 单元 | 47 package tests + 3 root = **50 通过** |
| vitest 集成 | 原 18 + 新 hardening.db.spec 5 = **23 通过**（真实 Postgres） |
| vitest 合计 | **16 文件 73 passed**（+1 ci-guard 本地 skip、CI 内强制执行） |
| Playwright E2E | **5/5 通过**（15.2s）：A raw-email 全链路+翻译、B hot-water 定向 cas_902、C 低置信兜底、D AI 失败降级、F 重复消息幂等 |
| production build | ✅ next build --turbopack 编译成功 |

关键测试位置：
- `tests/e2e/mandatory.spec.ts` — §32/§33/§34/§35/§36/§38（UI raw email，零实体预填）
- `tests/integration/hardening.db.spec.ts` — §33 定向断言（LINK cas_902/cas_901）、§35 失败降级、§36 ingest 幂等、§37 executionKey 重放
- `packages/domain/*.ts` 纯函数可单测；`tests/integration/*db*.spec.ts` 真库验证

## E. CI Evidence

`.github/workflows/ci.yml` 已建立：Postgres 16 service → install → lint → typecheck → migrate → seed → unit+integration（DATABASE_URL 缺失时 `ci-guard.spec.ts` 直接 FAIL 构建，杜绝假绿，§39）→ build → Playwright chromium E2E。
推送至 GitHub 后 Actions 将自动运行首次流水线；结果可在仓库 Actions 标签页查看。

## F. Known Limitations

仍然全部为 Mock / 本地实现，**未连接任何真实外部系统**：

- No real PropertyMe API（镜像实体由种子数据填充）
- No real Outlook API（邮件经 simulate 表单 / ingestRawEmail 进入）
- No real Grow API
- No real AI provider（mock provider 关键词分类；置信度语义真实但模型为规则）
- 无认证/多用户（沿用 MVP 接受风险，见 docs/security-review.md 重审清单）

## G. Readiness Decision

| 问题 | 回答 |
|---|---|
| Ready for Outlook integration? | **YES** — raw email 入口、source 身份+去重、party 模型、幂等 outbox 均已就绪，Connector 只需把 Graph message 映射为 ingestRawEmail 输入 |
| Ready for PropertyMe integration? | **YES** — 十类 Source of Truth 归属明确，镜像实体 + ExternalEntityMapping + sync 元数据 + no-hard-delete 语义全部建好；Sync Worker 可直接写映射表 |
| Ready for Grow integration? | **YES（条件性）** — source 枚举与映射表已容纳 GROW；Sales 侧实体（Buyer/Vendor/Listing/Offer）目前仍寄生在 Contact/Case 上，接 Grow 前需按 §18 同样模式补最小镜像实体（预计一个小 migration + 一个 seed 批次的工作量） |

---

**结论：Foundation Final Hardening 的 Definition of Done（Spec §43）全部满足 —— Foundation Final Hardening Complete.**
