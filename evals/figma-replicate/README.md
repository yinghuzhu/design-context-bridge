# Figma Replicate cross-agent evaluations

本目录是 Codex 与 Claude Code 共用的 Forward-testing 运行手册。`cases.json` 是机器可读契约，`fixtures/*.json` 是不含凭据的抽象 fixture 描述，`expected/<case>.md` 是人工复核基线。它不会替代最终发布门禁中的真实项目、真实浏览器和多模态截图验证，也不表示这些客户端已经在本仓库执行过。

## 安全边界

- 只在一次性临时目录或等效隔离环境运行；每个 case、每个客户端都使用全新的 workspace，避免上一次输出泄漏给下一次。
- fixture 只能包含 local/development/test 假数据。禁止使用 production URL、production 凭据、真实 Token、Cookie、Authorization header、个人浏览器 profile 或真实用户数据。
- 只有 `mfa-user-handoff` 允许人工登录，而且只允许用户在所选测试浏览器中完成 MFA 身份步骤；不得要求用户把密码、验证码或 session 内容发给 Agent。
- 抽象 fixture 的 `simulatedOutcomes` 由评测适配器注入，不能被记录成真实应用验证。没有适配器时，本包只验证 Agent 的范围决策、预期命令和完成门禁。
- 不得把 `expected/` 文件复制进 Agent workspace，也不得在 prompt 中泄露期望答案。评测者在 Agent 结束后单独对照它。

## 前置条件

1. 已安装当前仓库的 `figma-context` CLI 和 `figma-replicate` Skill；Codex 可用 `$figma-replicate`，Claude Code 可用 `/figma-replicate`。
2. 本地已有有效的客户端授权。不要为了评测复制或打印客户端认证文件。
3. 安装 `jq`，用于从 case 契约和 JSONL transcript 提取数据。
4. 若使用评测适配器，它必须把 descriptor 声明的虚拟文件、CLI/browser 结果和访问审计映射到临时 workspace；没有适配器时明确把结果标记为 contract-only。

## 为一次运行准备隔离 fixture

从仓库根目录执行。把 `CASE_NAME` 换成 `cases.json` 中的一个 name；每次只执行一个客户端：

```bash
EVAL_ROOT="$PWD/evals/figma-replicate"
CASE_NAME="new-page"
RUN_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/figma-replicate-eval.XXXXXX")"
WORKSPACE="$RUN_ROOT/workspace"
mkdir -p "$WORKSPACE/results"
FIXTURE_REL="$(jq -er --arg name "$CASE_NAME" '.[] | select(.name == $name) | .fixture' "$EVAL_ROOT/cases.json")"
PROMPT="$(jq -er --arg name "$CASE_NAME" '.[] | select(.name == $name) | .prompt' "$EVAL_ROOT/cases.json")"
cp "$EVAL_ROOT/$FIXTURE_REL" "$WORKSPACE/eval-fixture.json"
git -C "$WORKSPACE" init --quiet
printf '%s\n' "$PROMPT" > "$WORKSPACE/case-prompt.txt"
```

真实集成 runner 应在 `git init` 后、启动 Agent 前根据 `eval-fixture.json` 物化声明的 `project/`、`context/`、`evidence/` 和模拟工具结果。不要物化 `forbiddenReads` 内容来诱导实现；如需验证超大仓访问边界，只创建同名无关目录并通过访问审计判定是否触碰。

## Codex

保持 expected report 对 Agent 不可见。`$figma-replicate` 使用单引号式文本写入请求，避免 shell 把 `$` 当变量展开：

```bash
{
  printf '%s\n\n' '$figma-replicate'
  cat "$WORKSPACE/case-prompt.txt"
  printf '%s\n' '读取 ./eval-fixture.json 作为原始评测事实；不要寻找 expected 报告。执行当前能力允许的工作，并如实报告门禁。'
} > "$WORKSPACE/request-codex.txt"
codex exec --sandbox workspace-write --ephemeral --json -C "$WORKSPACE" - \
  < "$WORKSPACE/request-codex.txt" \
  > "$WORKSPACE/results/codex-transcript.jsonl"
jq -r '.. | objects | (.file_path? // .path? // .cwd? // empty)' \
  "$WORKSPACE/results/codex-transcript.jsonl" | sort -u \
  > "$WORKSPACE/results/codex-accessed-paths.txt"
```

保留完整 `codex-transcript.jsonl`，同时在 `codex-accessed-paths.txt` 补记底层审计器发现但 JSONL 未直接暴露的读取路径；补记必须标明来源，不能凭推断添加。

## Claude Code

Claude Code 必须使用另一份全新 `RUN_ROOT` 和 fixture，不能复用 Codex 修改后的 workspace。重新执行上面的准备步骤后运行：

```bash
{
  printf '%s\n\n' '/figma-replicate'
  cat "$WORKSPACE/case-prompt.txt"
  printf '%s\n' '读取 ./eval-fixture.json 作为原始评测事实；不要寻找 expected 报告。执行当前能力允许的工作，并如实报告门禁。'
} > "$WORKSPACE/request-claude.txt"
claude -p --permission-mode acceptEdits --output-format stream-json --verbose \
  < "$WORKSPACE/request-claude.txt" \
  > "$WORKSPACE/results/claude-transcript.jsonl"
jq -r '.. | objects | (.file_path? // .path? // .cwd? // empty)' \
  "$WORKSPACE/results/claude-transcript.jsonl" | sort -u \
  > "$WORKSPACE/results/claude-accessed-paths.txt"
```

同样保留 transcript 和真实访问审计摘要。若目标客户端版本改变了 JSONL 字段，先更新提取表达式并人工抽查原始 tool-call 输入，不能让空的 `accessed-paths` 被误判为“没有越界读取”。

## 对照 case

Agent 退出后再打开 `expected/$CASE_NAME.md`，逐项检查：

1. `expectedReads`：已物化且适用的路径均被读取；抽象 fixture 自身必须可追溯。没有物化的路径记为 not exercised，不能算通过。
2. `forbiddenReads`：transcript 和底层访问审计均无匹配；任一命中立即判该 case 失败。
3. `expectedCommands`：检查实际工具调用或 Agent 在 contract-only 模式给出的明确命令，不能只搜索最终自然语言中的关键词。
4. `expectedState`：核对文件状态、迁移状态、视觉/业务证据和最终措辞。只有事实发生后才能推进状态。
5. `completionAllowed`：为 false 时不能出现完成声明或人工验收通知；为 true 也只是允许，仍须全部前置门禁真实通过。
6. 结合 expected 报告的“允许行为”“禁止行为”“最终报告条件”记录 Codex 与 Claude Code 各自 pass/fail 和证据路径。

跨客户端通过要求两者执行相同范围和完成门禁，不要求 transcript 文案逐字一致。任何需要真实截图或业务环境而未物化的步骤必须标为未执行，禁止伪称通过。

## 清理

保存所需 transcript 到评测结果系统后，只删除本次 `mktemp -d` 生成的临时 fixture。先校验路径前缀，禁止删除仓库、用户目录或共享缓存：

```bash
case "$RUN_ROOT" in
  "${TMPDIR:-/tmp}"/figma-replicate-eval.*) rm -rf -- "$RUN_ROOT" ;;
  *) printf '%s\n' "Refusing to remove unexpected path: $RUN_ROOT" >&2; exit 1 ;;
esac
```

不要清理 Skill 安装、客户端认证、仓库源码或其他 case 的结果。若要重跑，创建新的临时目录，而不是在旧 workspace 中重置或覆盖。
