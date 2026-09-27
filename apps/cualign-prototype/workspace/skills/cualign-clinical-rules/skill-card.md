<!-- Drafted with the NVIDIA skills catalog skill skill-card-generator (github.com/NVIDIA/skills, commit d8519c5, CC-BY-4.0 AND Apache-2.0) on 2026-09-25 from SKILL.md, README.md, SECURITY.md, docs/clinical-sources.md and workspace/skills/skillspector-report*.md; reviewed by the cuAlign team (#39). -->
## Description: <br>
Validate and stage clear-aligner treatment plans against published clinical limits using the cuAlign tool set, producing draft-only output that never diagnoses or prescribes. <br>

This skill is for research and development only. <br>

## Third-Party Community Consideration
This skill is not owned or developed by NVIDIA. This skill has been developed and built to a third-party's requirements for this application and use case; see link to Non-NVIDIA [cuAlign Agent Card](https://github.com/dalsoop/nvidia-hackaton-2026-one/blob/main/apps/cualign-prototype/README.md). <br>

### License/Terms of Use: <br>
## Use Case: <br>
Developers and dentists on the cuAlign team use it to turn a dentist's natural-language constraints into a staged clear-aligner plan. Example constraints are no extraction, within 12 months, and lock tooth 13. The plan is validated against the published movement, IPR, arch-expansion and stage-count limits. When a rule fails, the skill chooses or switches a space-gaining strategy. The result is a draft the dentist reviews; the skill never diagnoses, prescribes or approves a plan. <br>

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
**Output Format:** [Korean Markdown summary (strategy · aligner count · months · violations by type · tool order) ending with «이 계획은 초안입니다. 최종 판단은 의사가 합니다.»; tool results are JSON; an approved plan exports as a ZIP of per-stage STL files] <br>
**Output Parameters:** [1D] <br>
**Other Properties Related to Output:** [Draft-only. Rule failures and reviewer failures block approval. Only the dentist can approve in the UI. Patient meshes stay local; only computed plan summaries reach the reviewer model.] <br>

## Evaluation Tasks: <br>
SkillSpector static and semantic security scans of the skill directory on 2026-09-22 (two reports in workspace/skills/, one markdown component of 62 lines, same result). The reports are a snapshot of the skill on that date. They are not a safety certification of the current file or of the service (docs/NVIDIA_STACK.md, SECURITY.md). <br>

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


