# Sample scans

`poseidon-000097/`, `poseidon-000131/`, `poseidon-000001/` are upper-arch cases from the Poseidon3D dataset:

Tibor Kubik and Michal Spanel, "Addressing Challenging Teeth Segmentation Cases in 3D Dental Surface Orthodontic
Scans", Bioengineering 11(10):1014, 2024, https://doi.org/10.3390/bioengineering11101014.
Data: https://zenodo.org/records/15608906. License: CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/).

Changes: split into one STL per tooth by the dataset's face labels, renumbered to Universal 2..15, rotated so the
occlusal plane is z=0 with crowns towards -z, gingiva trimmed to a band around the crowns and decimated
(`scripts/import_poseidon.py`). The anonymised public dataset contains no patient identity. Each folder's
`SOURCE.txt` records the case and the renumbering.

The prescriptions shown with the samples are a dentist's reading of these scans (`evals/real_scans/dentist_labels.yaml`),
not part of the dataset.
