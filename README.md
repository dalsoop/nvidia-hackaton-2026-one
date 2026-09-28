# cuAlign: a clear-aligner staging agent

cuAlign is an agent for dentists who design clear-aligner stages in their own clinic. The dentist states the prescription and conditions. The agent builds a target arrangement and a stage plan, checks them with calculation tools, and rebuilds the 3D plan when the conditions change. Only an approved plan is exported, as per-stage tooth STL files. Clinical decisions such as extraction and IPR, and the choice of the final plan, stay with the dentist. The output is a draft.

- About the app and how to run it: [apps/cualign-prototype/README.md](apps/cualign-prototype/README.md) ([Korean](apps/cualign-prototype/README.ko.md))
- How it uses NVIDIA technology (NeMo Agent Toolkit, Nemotron NIM, NeMo Guardrails, OpenShell, NVIDIA Skills catalog): [NVIDIA stack map](apps/cualign-prototype/docs/NVIDIA_STACK.md) (Korean)

This is the repository of Team 1 at the NVIDIA × FastCampus Korea Agentic AI Hackathon.

## Repository layout

Several apps can live in this one repository. Each app has its own folder under `apps/`, and its README explains how to run it.

- Structure: [ARCHITECTURE.md](ARCHITECTURE.md) (Korean)
- Working rules: [AGENTS.md](AGENTS.md) (Korean)
- Contributing: [CONTRIBUTING](.github/CONTRIBUTING.md) (Korean)
