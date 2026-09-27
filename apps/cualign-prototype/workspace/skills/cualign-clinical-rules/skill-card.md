<!-- Drafted with the NVIDIA skills catalog skill skill-card-generator (github.com/NVIDIA/skills, commit d8519c5, CC-BY-4.0 AND Apache-2.0) on 2026-09-25 from SKILL.md, README.md, SECURITY.md, docs/clinical-sources.md and workspace/skills/skillspector-report*.md; reviewed by the cuAlign team (#39). -->
## Description: <br>
Skill for the NAT planner of cuAlign. It validates clear-aligner staging plans against published clinical limits with the cuAlign tools. It gives draft plans only. It does not diagnose or prescribe. <br>

This skill is for research and development only. <br>

## Third-Party Community Consideration
This skill is not owned or developed by NVIDIA. This skill has been developed and built to a third-party's requirements for this application and use case; see link to Non-NVIDIA [cuAlign Agent Card](https://github.com/dalsoop/nvidia-hackaton-2026-one/blob/main/apps/cualign-prototype/README.md). <br>

### License/Terms of Use: <br>
## Use Case: <br>
A dentist gives conditions in natural language, for example no extraction, 12 months or less, or lock tooth 13. The cuAlign team uses this skill to change these conditions into a staged clear-aligner plan. The tools check the plan against the published limits for movement, IPR, arch expansion and stage count. When a rule fails, the skill selects a space-gaining strategy or changes to a different strategy. The result is a draft that the dentist examines. The skill does not diagnose, prescribe or approve a plan. <br>

### Deployment Geography for Use: <br>
Republic of Korea (Korean-speaking dentists; the UI and the hackathon submission are in Korean) <br>

## Requirements / Dependencies: <br>
**Requires API Key or External Credential:** [Yes] <br>
**Credential Type(s):** [API key] <br>  

Do not include secrets in prompts/logs/output; use least-privilege credentials; rotate keys as appropriate. See skill body for more details. <br>

## Known Risks and Mitigations: <br>
Risk: Review before execution as proposals could introduce incorrect or misleading guidance into skills. <br>
Mitigation: Review and scan skill before deployment. <br>

## Reference(s): <br>
- [Applied Sciences 2024 staging review (MDPI)](https://www.mdpi.com/2076-3417/14/15/6690) <br>
- [IJOS 2025 expert consensus (Nature)](https://www.nature.com/articles/s41368-025-00350-2) <br>
- [Align Technology 2016 one-week aligner wear announcement](https://investor.aligntech.com/news-releases/news-release-details/align-technology-introduces-one-week-aligner-wear-invisalignr) <br>
- [docs/clinical-sources.md (PoC limit values and how far each source was checked)](../../../docs/clinical-sources.md) <br>


## Skill Output: <br>
**Output Type(s):** [Analysis, Files] <br>
**Output Format:** [Korean Markdown summary: strategy, aligner count, months, violations by type and tool order. The last line is «이 계획은 초안입니다. 최종 판단은 의사가 합니다.» The tools give JSON. An approved plan exports as a ZIP of STL files, one file for each stage.] <br>
**Output Parameters:** [1D] <br>
**Other Properties Related to Output:** [Draft only. A rule failure or a reviewer failure blocks approval. Only the dentist can approve, in the UI. Patient meshes stay on the local computer. Only the calculated plan summaries go to the reviewer model.] <br>

## Evaluation Tasks: <br>
SkillSpector static and semantic security scans of the skill folder on 2026-09-22. The two reports are in workspace/skills/. Each scan found one markdown component of 62 lines, and the two results are the same. The reports show the skill on that date. They do not certify the safety of the current file or of the service (docs/NVIDIA_STACK.md, SECURITY.md). <br>

## Evaluation Results: <br>
| Metric | Value |
|---|---|
| Score | 0/100 |
| Severity | LOW |
| Recommendation | SAFE |
| Issues | 0 |

## Testing Completed: <br>
**[ ] Agent Red-Teaming** <br>
**[ ] Network Security** <br>
**[ ] Product Security** <br>

## Skill Version(s): <br>
0.1.0 (source: pyproject.toml; git SHA e3d0e39, committed 2026-09-25) <br>


