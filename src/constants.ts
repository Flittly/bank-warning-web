export const ANALYSIS_CONFIG_DEFAULT = {
  "bench-id": "tiff/Mzs/2012/standard/201210/201210.tif",
  "ref-id": "tiff/Mzs/2023/standard/202304/202304.tif",
  "dem-id": "tiff/Mzs/2023/standard/202304/202304.tif",
  "current-timepoint": "2024-01-15",
  "comparison-timepoint": "2020-01-15",
  "segment": "Mzs",
  "year": "2023",
  "set": "standard",
  "water-qs": "45000",
  "tidal-level": "zc",
  "hs": 0.5,
  "hc": 2,
  "protection-level": "systemic",
  "control-level": "strict",
  "risk-thresholds": {
    "Zb": [20, 30, 40],
    "Sa": [0.2, 0.3, 0.5],
    "Ln": [0.04, 0.12, 0.2],
    "PQ": [0.5, 1, 2.3],
    "Ky": [1.7, 1.35, 1],
    "Zd": [0.1, 0.15, 0.3],
    "Dsed": [0.7, 1, 1.5],
    "all": [0.25, 0.5, 0.75]
  },
  "wNM": [0.43, 0.32, 0.25],
  "wRE": [0.48, 0.16, 0.36],
  "wGE": [0.6, 0.2, 0.2],
  "wRL": [0.32, 0.43, 0.25]
} as const;

export type AnalysisConfig = typeof ANALYSIS_CONFIG_DEFAULT;

export default ANALYSIS_CONFIG_DEFAULT;
