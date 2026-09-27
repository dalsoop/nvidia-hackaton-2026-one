<!-- Drafted on 2026-09-26 in the format of the NVIDIA skills catalog skill skill-card-generator (github.com/NVIDIA/skills, commit d8519c5, CC-BY-4.0 AND Apache-2.0), following workspace/skills/cualign-clinical-rules/skill-card.md, from SKILL.md, docs/nemoclaw.md and src/cualign/server/mcp_server.py. Not yet reviewed by the cuAlign team and not yet scanned with SkillSpector. -->
## Description: <br>
Front-desk skill for an OpenClaw agent in a NemoClaw sandbox. It asks the cuAlign MCP server for clear-aligner staging plans. It reports them to a Korean-speaking dentist as drafts. It does not compute, approve or export anything itself. <br>

This skill is for research and development only. <br>

## Third-Party Community Consideration
This skill is not owned or developed by NVIDIA. This skill has been developed and built to a third-party's requirements for this application and use case; see link to Non-NVIDIA [cuAlign Agent Card](https://github.com/dalsoop/nvidia-hackaton-2026-one/blob/main/apps/cualign-prototype/README.md). <br>

### License/Terms of Use: <br>
## Use Case: <br>
A dentist talks to OpenClaw. The skill picks the case and settles the conditions with at most one question. It calls `cualign_plan` once. It reports the strategy, stage count, months, rule result, the reviewer memo verbatim and the cuAlign UI link. Planning and rule checks stay with cuAlign's NAT agent. Approval and STL export stay with the dentist in the cuAlign UI, and the NemoClaw sandbox policy denies those two MCP tools. <br>

### Deployment Geography for Use: <br>
Republic of Korea (Korean-speaking dentists; the UI and the hackathon submission are in Korean) <br>

## Requirements / Dependencies: <br>
**Requires API Key or External Credential:** [Yes] <br>
**Credential Type(s):** [Bearer token for the cuAlign MCP server, held by the OpenShell provider store; NVIDIA API key for the OpenClaw model] <br>

Do not include secrets in prompts/logs/output; use least-privilege credentials; rotate keys as appropriate. See skill body for more details. <br>

## Known Risks and Mitigations: <br>
Risk: The agent could present a draft as final or try to approve or export a plan. <br>
Mitigation: The skill forbids it. The MCP server's approve tool never approves, and its export tool requires the dentist's approval. `nemoclaw <sandbox> mcp add --deny-tool` blocks both tools at the OpenShell MCP proxy. <br>
Risk: Review before execution as proposals could introduce incorrect or misleading guidance into skills. <br>
Mitigation: Review and scan skill before deployment. <br>

## Reference(s): <br>
- [NemoClaw: Add an MCP Server](https://github.com/NVIDIA/NemoClaw/blob/main/docs/manage-sandboxes/add-mcp-server.mdx) <br>
- [docs/nemoclaw.md (architecture, policy and setup)](../../../docs/nemoclaw.md) <br>
- [workspace/skills/cualign-clinical-rules (the rules the cuAlign agent applies)](../cualign-clinical-rules/SKILL.md) <br>

## Skill Output: <br>
**Output Type(s):** [Analysis] <br>
**Output Format:** [Korean summary (strategy · stage count · months · rule result · quoted reviewer memo · UI link) ending with «이 계획은 초안입니다. 최종 판단과 승인은 의사가 cuAlign 화면에서 합니다.»] <br>
**Output Parameters:** [1D] <br>
**Other Properties Related to Output:** [Draft-only; no patient identifiers or scan files pass through the skill] <br>

## Evaluation Tasks: <br>
Offline tests of the MCP server it calls (tests/test_mcp_server.py, and the real-worker test in tests/test_rails_middleware.py). On 2026-09-27, the skill at commit 4f7bbd2 was installed on a NemoClaw desk on Brev (Linux). This is the version before the English rewrite. The list, plan and approval requests ran once each there ("Brev 배포 확인" in docs/nemoclaw.md). <br>

## Evaluation Results: <br>
The 4f7bbd2 version passed all three requests on 2026-09-27. The English rewrite (c21744d) and later versions did not run on the desk yet. Run the three requests again on the desk for these versions. <br>

## Testing Completed: <br>
**[ ] Agent Red-Teaming** <br>
**[ ] Network Security** <br>
**[ ] Product Security** <br>

## Skill Version(s): <br>
0.1.0 (source: pyproject.toml) <br>
